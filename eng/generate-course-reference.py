"""Optional developer tool. Requires SciPy 1.17.1, never an app dependency."""
import json
from pathlib import Path
import scipy
from scipy.integrate import solve_ivp

assert scipy.__version__ == '1.17.1'
models = [
    ('conversion', 'baseline', 20, ['A', 'B'], [20, 0],
     lambda t, y: [-.25*y[0], .25*y[0]]),
    ('expression', 'baseline', 300, ['Off', 'On', 'M', 'P'], [1, 0, 0, 0],
     lambda t, y: [-.04*y[0]+.08*y[1], .04*y[0]-.08*y[1], .5*y[1]-.1*y[2], .4*y[2]-.02*y[3]])
]
for condition, binding in [('open', 0), ('closed', .02)]:
    models.append(('autoregulation', condition, 150, ['G', 'R', 'P'], [1, 0, 0],
                   lambda t, y, k=binding: [-k*y[0]*y[2]+.2*y[1], k*y[0]*y[2]-.2*y[1],
                                           .5*y[0]-k*y[0]*y[2]+.2*y[1]-.05*y[2]]))
cases = []
for lesson, condition, end, names, initial, rhs in models:
    times = [end*i/1000 for i in range(1001)]
    result = solve_ivp(rhs, [0, end], initial, method='DOP853', rtol=1e-12, atol=1e-13, t_eval=times)
    assert result.success
    cases.append(dict(lessonId=lesson, conditionId=condition, times=times,
                      series=[dict(name=name, values=result.y[i].tolist()) for i, name in enumerate(names)]))
reference = dict(scipy=scipy.__version__, method='DOP853', rtol=1e-12, atol=1e-13,
                 origin='Independently specified ODEs for authored teaching CRNs; no fitted or experimental data.')
path = Path(__file__).resolve().parents[1] / 'tests/Ui/fixtures/systems-reference.json'
path.write_text(json.dumps(dict(reference=reference, cases=cases), separators=(',', ':'))+'\n', encoding='utf-8')
