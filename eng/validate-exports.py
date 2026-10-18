"""Independent scientific-file validation. Development/CI only; never an app dependency."""
import argparse
import json
import math
import shutil
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--app', required=True)
parser.add_argument('--octave', action='store_true', help='Require real MATLAB-compatible execution through octave-cli')
parser.add_argument('--structural-only', action='store_true', help='Local fallback without libSBML; CI never uses this option')
args = parser.parse_args()
if not args.structural_only:
    import libsbml
    assert libsbml.getLibSBMLDottedVersion() == '5.21.2', libsbml.getLibSBMLDottedVersion()
app = Path(args.app).resolve()
dotnet = Path('.tooling/dotnet/dotnet.exe').resolve()
command = ([str(dotnet) if dotnet.exists() else 'dotnet', str(app)] if app.suffix == '.dll' else [str(app)])
root = Path('artifacts/export-validation').resolve()
root.mkdir(parents=True, exist_ok=True)
S = '{http://www.sbml.org/sbml/level3/version2/core}'
M = '{http://www.w3.org/1998/Math/MathML}'

def run(operation, code, options=()):
    result = subprocess.run(command + [operation, '-', '--language', 'crn', '--timeout-seconds', '60', *options], input=code, text=True, encoding='utf-8', capture_output=True, timeout=90)
    assert result.returncode == 0, result.stderr + result.stdout[:1000]
    response = json.loads(result.stdout)
    assert response['success'], response['diagnostics']
    return response['model']

def compile_math(node):
    tag = node.tag.removeprefix(M)
    children = list(node)
    if tag == 'ci':
        name = node.text.strip()
        return lambda t, values: values[name]
    if tag == 'csymbol':
        assert node.attrib['definitionURL'] == 'http://www.sbml.org/sbml/symbols/time'
        return lambda t, values: t
    if tag == 'cn':
        number = float(node.text) * (10 ** float(children[0].tail) if children else 1)
        assert math.isfinite(number)
        return lambda t, values: number
    if tag in ('true', 'false'):
        return lambda t, values: tag == 'true'
    if tag == 'piecewise':
        pieces = [(compile_math(piece[0]), compile_math(piece[1]) if len(piece) == 2 else None) for piece in children]
        return lambda t, values: next(expr(t, values) for expr, condition in pieces if condition is None or condition(t, values))
    assert tag == 'apply', tag
    operator = children[0].tag.removeprefix(M)
    functions = [compile_math(child) for child in children[1:]]
    def evaluate(t, values):
        x = [function(t, values) for function in functions]
        if operator == 'plus': return sum(x)
        if operator == 'times': return math.prod(x)
        if operator == 'minus': return -x[0] if len(x) == 1 else x[0] - x[1]
        if operator == 'divide': return x[0] / x[1]
        if operator == 'power': return x[0] ** x[1]
        if operator == 'abs': return abs(x[0])
        if operator == 'ln': return math.log(x[0])
        if operator == 'floor': return math.floor(x[0])
        if operator == 'ceiling': return math.ceil(x[0])
        if operator == 'lt': return x[0] < x[1]
        if operator == 'leq': return x[0] <= x[1]
        if operator == 'eq': return x[0] == x[1]
        if operator == 'geq': return x[0] >= x[1]
        if operator == 'gt': return x[0] > x[1]
        if operator == 'not': return not x[0]
        if operator == 'and': return all(x)
        if operator == 'or': return any(x)
        raise ValueError(operator)
    return evaluate

def sbml_check(content, trajectory):
    if not args.structural_only:
        document = libsbml.readSBMLFromString(content)
        document.checkConsistency()
        errors = [document.getError(i).getMessage() for i in range(document.getNumErrors()) if document.getError(i).getSeverity() >= libsbml.LIBSBML_SEV_ERROR]
        assert not errors, errors
        assert document.getLevel() == 3 and document.getVersion() == 2
    model = ET.fromstring(content).find(S + 'model')
    species = model.findall('.//' + S + 'species')
    names = [s.attrib['name'] for s in species]
    ids = [s.attrib['id'] for s in species]
    values = [float(s.attrib['initialConcentration']) for s in species]
    constants = [s.attrib['boundaryCondition'] == 'true' for s in species]
    reactions = []
    for reaction in model.findall('.//' + S + 'reaction'):
        stoich = [0.0] * len(species)
        for side, sign in [('listOfReactants', -1), ('listOfProducts', 1)]:
            for ref in reaction.findall(S + side + '/' + S + 'speciesReference'):
                stoich[ids.index(ref.attrib['species'])] += sign * float(ref.attrib['stoichiometry'])
        flux = compile_math(reaction.find(S + 'kineticLaw/' + M + 'math')[0])
        reactions.append((stoich, flux))
    def rhs(t, y):
        env = dict(zip(ids, y), c=1)
        fluxes = [function(t, env) for _, function in reactions]
        return [0 if constants[i] else sum(stoich[i] * flux for (stoich, _), flux in zip(reactions, fluxes)) for i in range(len(y))]
    end = trajectory['times'][-1]
    # Fixed-step RK4 is independent of both .NET ODE solvers and Octave's adaptive solver.
    count = max(4000, math.ceil(end / .0005))
    h = end / count
    for step in range(count):
        t = step * h
        k1 = rhs(t, values)
        k2 = rhs(t+h/2, [y+h*k/2 for y,k in zip(values,k1)])
        k3 = rhs(t+h/2, [y+h*k/2 for y,k in zip(values,k2)])
        k4 = rhs(t+h, [y+h*k for y,k in zip(values,k3)])
        values = [y+h*(a+2*b+2*c+d)/6 for y,a,b,c,d in zip(values,k1,k2,k3,k4)]
    checked = 0
    for column in trajectory['series']:
        if column['name'] in names:
            actual = values[names.index(column['name'])]
            expected = column['values'][-1]
            assert abs(actual - expected) <= .002 * max(1, abs(expected)), (column['name'], actual, expected)
            checked += 1
    assert checked, names

def octave_check(directory, item, trajectory, closure=False):
    if not args.octave: return
    octave = shutil.which('octave-cli')
    assert octave, 'octave-cli is required'
    filename = item['fileName']
    (directory / filename).write_text(item['content'], encoding='utf-8')
    out = directory / (Path(filename).stem + '.json')
    script = "sol=" + Path(filename).stem + "();fid=fopen('" + out.as_posix().replace("'", "''") + "','w');fprintf(fid,'%s',jsonencode(sol));fclose(fid);"
    result = subprocess.run([octave, '--quiet', '--no-gui', '--eval', script], cwd=directory, text=True, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stderr
    output = json.loads(out.read_text())
    assert len(output['times']) == len(trajectory['times'])
    assert max(abs(a-b) for a,b in zip(output['times'],trajectory['times'])) < 1e-9
    columns = output['plots']
    if trajectory['series'] and not isinstance(columns[0], list): columns = [[value] for value in columns]
    assert len(columns[0]) == len(trajectory['series'])
    for j, series in enumerate(trajectory['series']):
        errors = [abs(row[j]-value)/max(1,abs(value)) for row,value in zip(columns,series['values'])]
        assert max(errors) < .003, (filename, series['name'], max(errors))
        if closure and series.get('standardDeviation') is not None:
            deviations=output['standardDeviation']
            if not isinstance(deviations[0],list): deviations=[[v] for v in deviations]
            assert max(abs(row[j]-value)/max(1,abs(value)) for row,value in zip(deviations,series['standardDeviation'])) < .003

settings = 'directive simulator deterministic\ndirective deterministic {reltolerance=1e-9;abstolerance=1e-11}\ndirective simulation {final=1;points=40;plots=[A;B]}\n'
fixtures = [
    ('decay', settings+'directive units {time=min;concentration=uM}\n| 10 A | A ->{0.5} B', ()),
    ('repeated', settings+'| 10 A | A + A ->{0.1} B', ()),
    ('constant-catalyst', settings+'| constant 2 C | 3 A | 4 B | C ~ A <->{0.2}{0.3} B', ()),
    ('functional', settings+'directive parameters [k=0.5]\ndirective rates [loss=k*[A]+[time]*0.01]\n| 10 A | A ->[[loss]] B', ()),
    ('lifted', settings+'directive parameters [k=0.5]\nsystem slow = {| 10 A | A ->{k} B}\nsystem fast = {directive parameters [k=1] | 20 A | A ->{k} B}\nnode first {systems=[slow]}\nnode second {systems=[fast]}', ('--node','second','--system','fast')),
    ('sweep', settings.replace('plots=[A;B]', 'plots=[A;B];sweeps=[doses]')+'directive parameters [N=10]\ndirective sweeps [doses=[N=[2;5]]]\n| N A | A ->{0.5} B', ()),
    ('conditional', settings+'| 0 A | 0 B | ->[if [time]<0.5 then 1 else 2] A | ->[round([time]*4)+([time]%0.3)] B', ()),
]
count = 0
for name, code, options in fixtures:
    exported=run('export',code,options)
    simulated=run('simulate',code,options)
    files=exported['exports']
    for run_index, trajectory in enumerate(simulated['simulations'],1):
        directory=root/(name+'-'+str(run_index));directory.mkdir(exist_ok=True)
        chosen=[item for item in files if item['fileName'].startswith(f'run-{run_index:03d}-') or item['fileName'].startswith(f'crn_export_run_{run_index:03d}')]
        assert len(chosen)==6
        assert all(item['diagnostic'] is None for item in chosen), chosen
        for item in chosen:
            (directory/item['fileName']).write_text(item['content'],encoding='utf-8')
            if item['id']=='sbml': sbml_check(item['content'],trajectory)
            if item['id']=='matlab': octave_check(directory,item,trajectory)
            if item['contentType']=='image/svg+xml': assert ET.fromstring(item['content']).tag=='{http://www.w3.org/2000/svg}svg'
        count+=1
for log in (False,True):
    code=settings.replace('plots=[A;B]','plots=[A]')+'directive simulator mc\ndirective moments {order=2;plots=[<A>;<A^2>];initial_minimum=1e-8;log_evaluation='+str(log).lower()+'}\n| 0 A | ->{2} A | A ->{0.1}'
    exported=run('export',code)
    simulated=run('simulate',code)
    directory=root/('closure-'+str(log));directory.mkdir(exist_ok=True)
    item=next(item for item in exported['exports'] if item['id']=='closure-matlab')
    assert item['diagnostic'] is None, item
    octave_check(directory,item,simulated['simulations'][0],True)
    count+=1
label='XML structure and independent numerical checks' if args.structural_only else 'libSBML 5.21.2 consistency and independent numerical checks'
print(f'{count} scientific export cases passed: {label}'+('; real Octave trajectories and closure uncertainties' if args.octave else '; Octave execution not requested')+'.')
