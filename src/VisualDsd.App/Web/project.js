import { dsdFields, dsdOverrides, readDsdOptions, readDsdWorkspace } from './dsd-workspace.js';
import { readExports } from './exports.js';
import { MAX_CODE_BYTES, MAX_DOCUMENTS, byteLength, optionDefaults, requestFor, modelForRun, modelForNode } from './model.js';
import { readDatasets, readObservations } from './observations.js';
import { splitRHat } from './posterior.js';
import { readSynthesis } from './synthesis.js';
import { readLogicState, readLogicCase, readLogicReport } from './logic.js';
import { readSequenceWorkspace } from './sequences.js';
import { featureLocation } from './genbank.js';
import { readSystemsWorkspace } from './systems.js';

export const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
const fail = message => { throw new Error(`Invalid project: ${message}`); };
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : fail('expected an object.');
const text = (value, maximum = MAX_CODE_BYTES) => typeof value === 'string' && value.length <= maximum ? value : fail('invalid text field.');
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : fail('nonfinite or missing numeric value.');
const integer = (value, low, high) => Number.isInteger(value) && value >= low && value <= high ? value : fail('integer outside its allowed range.');
const array = (value, maximum) => Array.isArray(value) && value.length <= maximum ? value : fail('missing or oversized list.');
const nullableText = value => value === null || value === undefined ? null : text(value);
const seed = value => value === null || value === undefined ? null : integer(value, -2147483648, 2147483647);
const choice = (value, choices) => choices.includes(value) ? value : fail('unknown setting.');

function readDocument(raw) {
  object(raw);
  const id = text(raw.id, 80), name = text(raw.name, 120), code = text(raw.code);
  if (!id || byteLength(code) > MAX_CODE_BYTES) fail('invalid model identifier or source size.');
  const options = {};
  for (const key of Object.keys(optionDefaults)) options[key] = (['language', 'nodeId', 'systemId', 'phaseX', 'phaseY', 'phaseTrajectories'].includes(key)||key.startsWith('dsd')) && raw.options[key] === undefined ? optionDefaults[key] : text(object(raw.options)[key], key.endsWith('Id') ? 128 : 100);
  choice(options.language, ['dsd', 'crn']); choice(options.dialect, ['auto', 'current', 'legacy']); choice(options.compilation, ['source', 'default', 'detailed', 'finite', 'infinite']); choice(options.simulator, ['source', 'oslo', 'ssa', 'lna', 'cme', 'pde', 'sundials', 'cmesundials', 'mc']);
  dsdOverrides(options);
  const databases = {};
  const sourceDatabases = raw.databases === undefined ? {} : object(raw.databases);
  for (const key of ['toeholds', 'specificities']) if (sourceDatabases[key] !== undefined) {
    const entry = object(sourceDatabases[key]); databases[key] = { name: text(entry.name, 120), code: text(entry.code) };
    if (byteLength(entry.code) > MAX_CODE_BYTES) fail('sequence database exceeds 256 KiB.');
  }
  const logic=readLogicState(raw.logic);
  if(logic?.batch)logic.batch.request=normaliseRequest(logic.batch.request);
  if(logic?.study){logic.study.request=normaliseRequest(logic.study.request);for(const batch of logic.study.batches)batch.request=normaliseRequest(batch.request);}
  return { id, name, code, options, databases, data: readDatasets(raw.data), ...(logic?{logic}:{}), ...(raw.courseReport?{courseReport:readLogicReport(raw.courseReport)}:{}), revision: 0, exampleId: raw.exampleId == null ? null : text(raw.exampleId, 100) };
}

export function normaliseRequest(raw) {
  object(raw);
  const options = { ...optionDefaults };
  for (const key of ['language', 'dialect', 'compilation', 'simulator']) if (raw[key] !== undefined) options[key] = text(raw[key], 30);
  choice(options.language, ['dsd', 'crn']); choice(options.dialect, ['auto', 'current', 'legacy']); choice(options.compilation, ['source', 'default', 'detailed', 'finite', 'infinite']); choice(options.simulator, ['source', 'oslo', 'ssa', 'lna', 'cme', 'pde', 'sundials', 'cmesundials', 'mc']);
  for (const key of ['initial', 'final', 'points', 'seed', 'timeoutSeconds']) if (raw[key] !== undefined && raw[key] !== null) options[key] = String(finite(raw[key]));
  if (raw.nodeId != null) options.nodeId = text(raw.nodeId, 128);
  if (raw.systemId != null) options.systemId = raw.systemId === '' ? '$top' : text(raw.systemId, 128);
  if(raw.dsdOptions!=null){const overrides=readDsdOptions(raw.dsdOptions);if(options.language==='crn')fail('DSD options require DSD input.');for(const field of dsdFields)if(overrides[field.name]!=null)options[field.id]=String(overrides[field.name]);}
  for(const key of ['phaseX','phaseY'])if(raw[key]!=null)options[key]=text(raw[key],128);
  if(raw.phaseTrajectories!=null)options.phaseTrajectories=String(integer(raw.phaseTrajectories,0,16));
  const databases = {};
  for (const key of ['toeholds', 'specificities']) if (raw[key] !== undefined && raw[key] !== null) { const code = text(raw[key]); if (byteLength(code) > MAX_CODE_BYTES) fail('sequence database exceeds 256 KiB.'); databases[key] = { name: 'Custom database', code }; }
  const request=requestFor({ code: text(raw.code), options, databases, data: readDatasets(raw.data) }, choice(raw.operation, ['parse', 'expand', 'simulate', 'infer', 'analyze', 'synthesize', 'export']));
  if(raw.logicCase!=null){
    if(request.operation!=='simulate'||!['oslo','sundials','ssa'].includes(request.simulator)||request.simulator==='ssa'&&(request.seed==null||!Number.isInteger(request.seed)||request.seed<0)||request.initial==null||request.final==null||request.points==null||request.points>500||request.timeoutSeconds>120)fail('invalid logic simulation budget.');
    request.logicCase=readLogicCase(raw.logicCase);
  }
  return request;
}

export function resultIsCurrent(model, snapshot) {
  try { return JSON.stringify(requestFor(model, snapshot.request.operation)) === JSON.stringify(normaliseRequest(snapshot.request)); }
  catch { return false; }
}

function readSettings(raw) {
  const settings = object(raw);
  return { simulator: text(settings.simulator, 50), initial: finite(settings.initial), final: finite(settings.final), points: integer(settings.points, -2147483648, 2147483647), seed: seed(settings.seed), timeUnit: text(settings.timeUnit, 100), concentrationUnit: text(settings.concentrationUnit, 100) };
}

function readNetwork(source, isJit, operation) {
  object(source);
  const species = array(source.species, 10000).map(item => {
    object(item); if (typeof item.constant !== 'boolean') fail('invalid species flag.');
    const valueKind = item.valueKind ?? (isJit && operation === 'simulate' ? item.time == null ? 'finalPopulation' : 'scheduledInput' : 'initial');
    const result = { id: text(item.id, 512), name: text(item.name), structure: text(item.structure), svg: text(item.svg, 8 * 1024 * 1024), initial: text(item.initial), constant: item.constant, time: nullableText(item.time), valueKind: choice(valueKind, ['initial', 'finalPopulation', 'scheduledInput', 'spatial', 'timedInput', 'initialContribution']) };
    if (item.sourceId !== undefined) result.sourceId = nullableText(item.sourceId);
    if (item.spatialInitial !== undefined) result.spatialInitial = item.spatialInitial == null ? null : text(item.spatialInitial, 8 * 1024 * 1024);
    if (result.spatialInitial != null && result.valueKind !== 'spatial') fail('spatial initial definition on a scalar species.');
    return result;
  });
  const ids = new Set(species.map(item => item.id)); if (ids.size !== species.length) fail('duplicate species identifiers.');
  for (const item of species) if (item.sourceId && (!ids.has(item.sourceId) || species.find(source => source.id === item.sourceId)?.sourceId || item.sourceId === item.id)) fail('invalid initial-condition species reference.');
  const participants = items => array(items, 10000).map(item => { object(item); if (!ids.has(item.speciesId)) fail('reaction refers to an unknown species.'); return { speciesId: item.speciesId, multiplicity: integer(item.multiplicity, 1, 2147483647) }; });
  const rate = item => { object(item); return { kind: choice(item.kind, ['massAction', 'functional']), expression: text(item.expression) }; };
  const reactions = array(source.reactions, 50000).map(item => { object(item); return { reactants: participants(item.reactants), products: participants(item.products), catalysts: participants(item.catalysts), rate: rate(item.rate), reverseRate: item.reverseRate == null ? null : rate(item.reverseRate) }; });
  return { species, reactions };
}

function readInference(raw, runs) {
  object(raw);
  const retainedSamples = integer(raw.retainedSamples, 2, 2000);
  const likelihood = array(raw.logLikelihood, 2000).map(finite);
  if (likelihood.length !== retainedSamples) fail('posterior sample count mismatch.');
  const readParameters = (items,count) => array(items,100).map(parameter => {
    object(parameter); const samples = array(parameter.samples,2000).map(finite);
    if(samples.length!==count || finite(parameter.variance)<0 || finite(parameter.lower95)>finite(parameter.upper95)) fail('invalid posterior parameter summary.');
    const result={name:text(parameter.name,512),kind:choice(parameter.kind,['model','noise']),mle:finite(parameter.mle),mean:finite(parameter.mean),variance:parameter.variance,median:finite(parameter.median),lower95:parameter.lower95,upper95:parameter.upper95,samples};
    if(parameter.splitRHat!==undefined) {result.splitRHat=parameter.splitRHat===null?null:finite(parameter.splitRHat);if(result.splitRHat!==null && result.splitRHat<0)fail('invalid split R-hat.');}
    return result;
  });
  const parameters=readParameters(raw.parameters,retainedSamples);
  if(!parameters.length || new Set(parameters.map(p=>p.name)).size!==parameters.length)fail('missing or duplicated inferred parameters.');
  const observations=array(raw.observations,32).map(readObservations);
  if(observations.length!==runs.length || observations.some((table,i)=>table.times.length!==runs[i].times.length || table.times.some((time,row)=>time!==runs[i].times[row]) || table.series.length!==runs[i].series.length || table.series.some((column,j)=>column.name!==runs[i].series[j].name)))fail('fit observations do not match the predicted tables.');
  const dataPoints=integer(raw.dataPoints,1,20000);
  if(dataPoints!==observations.reduce((sum,table)=>sum+table.times.length*table.series.length,0))fail('observation count mismatch.');
  const burnIn=integer(raw.burnIn,0,20000),iterations=integer(raw.iterations,2,20000),thin=integer(raw.thin,1,20000),perChain=Math.floor(iterations/thin);
  if(burnIn+iterations>20000 || perChain<2 || perChain>500)fail('invalid MCMC iteration counts.');
  const result={seed:integer(raw.seed,0,4294967295),burnIn,iterations,thin,retainedSamples,dataPoints,maxLogLikelihood:finite(raw.maxLogLikelihood),parameters,logLikelihood:likelihood,observations};
  if(raw.lowerBound!==undefined)result.lowerBound=raw.lowerBound===null?null:finite(raw.lowerBound);
  if(raw.chains!=null){
    const chains=array(raw.chains,4).map(c=>{
      object(c);if(typeof c.included!=='boolean')fail('invalid chain inclusion flag.');
      const ll=array(c.logLikelihood,500).map(finite),prior=array(c.logPrior,500).map(finite),stamps=array(c.iterations,500).map(v=>integer(v,0,20000));
      if(ll.length!==perChain || prior.length!==perChain || stamps.length!==perChain)fail('incomplete chain samples.');
      const p=readParameters(c.parameters,perChain);
      if(p.length!==parameters.length || p.some((v,i)=>v.name!==parameters[i].name || v.kind!==parameters[i].kind))fail('chain parameters disagree.');
      return {seed:integer(c.seed,0,4294967295),included:c.included,maxLogLikelihood:finite(c.maxLogLikelihood),parameters:p,logLikelihood:ll,iterations:stamps,logPrior:prior};
    });
    if(!chains.length || new Set(chains.map(c=>c.seed)).size!==chains.length || chains.some(c=>c.included!==(result.lowerBound==null || c.maxLogLikelihood>result.lowerBound)))fail('invalid chain selection.');
    const included=chains.filter(c=>c.included);
    if(!included.length || perChain*included.length!==retainedSamples || (burnIn+iterations)*chains.length>20000 || !included.some(c=>c.seed===result.seed && c.maxLogLikelihood===result.maxLogLikelihood) || result.maxLogLikelihood!==Math.max(...included.map(c=>c.maxLogLikelihood)))fail('invalid pooled chain metadata.');
    if(included.flatMap(c=>c.logLikelihood).some((v,i)=>v!==likelihood[i]))fail('pooled likelihood does not preserve chain boundaries.');
    for(const [i,p]of parameters.entries()){
      if(included.flatMap(c=>c.parameters[i].samples).some((v,j)=>v!==p.samples[j]))fail('pooled posterior is inconsistent with chains.');
      const expected=splitRHat(included.map(c=>c.parameters[i].samples));
      if((p.splitRHat??null)!==expected && (expected===null || p.splitRHat==null || Math.abs(p.splitRHat-expected)>1e-9*Math.max(1,expected)))fail('split R-hat disagrees with chain samples.');
    }
    result.chains=chains;
  }else{
    if(raw.chains!==undefined)result.chains=null;
    if(perChain!==retainedSamples)fail('legacy posterior sample count mismatch.');
  }
  if(raw.priors!==undefined){
    result.priors=raw.priors===null?null:array(raw.priors,256).map(p=>{object(p);if(typeof p.variable!=='boolean')fail('invalid prior flag.');return{name:text(p.name,512),initial:finite(p.initial),distribution:text(p.distribution,2048),interval:choice(p.interval,['Fixed','Real','Log']),variable:p.variable};});
    if(result.priors && new Set(result.priors.map(p=>p.name)).size!==result.priors.length)fail('duplicated effective priors.');
  }
  return result;
}

function readSpatial(raw, run, budget) {
  object(raw);
  const dimensions = integer(raw.dimensions, 1, 2), boundary = choice(raw.boundary, ['Periodic', 'ZeroFlux']);
  const x = array(raw.x, dimensions === 1 ? 512 : 128).map(finite), y = array(raw.y, 128).map(finite);
  if (x.length < 4 || x[0] !== 0 || x.some((value, i) => i && value <= x[i - 1]) || (dimensions === 1 ? y.length !== 0 : y.length !== x.length || y.some((value, i) => value !== x[i]))) fail('invalid spatial coordinates.');
  if (x.some((value, i) => Math.abs(value - i * x.at(-1) / (x.length - 1)) > 1e-10 * x.at(-1))) fail('spatial grid must be uniform.');
  const dt = finite(raw.dt); if (dt <= 0 || !run.times.length || run.times.length > 5001) fail('invalid spatial time step or frames.');
  const cells = x.length * (y.length || 1);
  const series = array(raw.series, 10000).map((column, i) => {
    object(column); const name = text(column.name);
    if (name !== run.series[i]?.name) fail('spatial series do not match grid mean series.');
    const frames = array(column.frames, 5001).map(frame => {
      budget.cells += cells;
      if (budget.cells > 200000) fail('spatial output exceeds 200000 cell values.');
      const values = array(frame, cells).map(finite); if (values.length !== cells) fail('invalid spatial frame shape.'); return values;
    });
    if (frames.length !== run.times.length) fail('spatial frame count mismatch.');
    return { name, frames };
  });
  if (!series.length || series.length !== run.series.length) fail('invalid spatial series count.');
  return { dimensions, boundary, x, y, dt, series };
}

function readStateSpace(raw, network, budget) {
  object(raw);
  const speciesIds = array(raw.speciesIds, 128).map(value => text(value, 512));
  if (new Set(speciesIds).size !== speciesIds.length || speciesIds.some(id => !network.species.some(species => species.id === id))) fail('invalid state-space species identifiers.');
  const states = array(raw.states, 1000).map(row => { const values = array(row, 128).map(value => integer(value, 0, 1000000)); if (values.length !== speciesIds.length) fail('state population count mismatch.'); return values; });
  budget.states += states.length; if (!states.length || budget.states > 5000 || new Set(states.map(row => row.join(','))).size !== states.length) fail('empty, oversized or duplicated state space.');
  const initialState = integer(raw.initialState, 0, states.length - 1), pairs = new Set();
  const transitions = array(raw.transitions, 20000).map(edge => {
    object(edge); const source = integer(edge.source, 0, states.length - 1), target = integer(edge.target, 0, states.length - 1), rate = finite(edge.rate), pair = `${source}:${target}`;
    if (rate <= 0 || source === target || pairs.has(pair)) fail('invalid or duplicated state transition.'); pairs.add(pair);
    return { source, target, rate };
  });
  budget.edges += transitions.length; if (budget.edges > 20000) fail('too many state transitions.');
  const graph = { speciesIds, initialState, states, transitions };
  // All returned states must be reachable from the recorded initial state.
  const reached = new Set([initialState]), queue = [initialState], outgoing = new Map();
  for (const edge of transitions) { if (!outgoing.has(edge.source)) outgoing.set(edge.source, []); outgoing.get(edge.source).push(edge.target); }
  for (let i = 0; i < queue.length; i++) for (const next of outgoing.get(queue[i]) || []) if (!reached.has(next)) { reached.add(next); queue.push(next); }
  if (reached.size !== states.length) fail('state graph includes unreachable states.');
  return graph;
}

function readProbabilities(raw, run, network, budget) {
  object(raw);
  const speciesIds = array(raw.speciesIds, 256).map(id => text(id, 512));
  if (!speciesIds.length || new Set(speciesIds).size !== speciesIds.length || speciesIds.some(id => !network.species.some(sp => sp.id === id))) fail('invalid probability species.');
  const states = array(raw.states, 4096).map(row => {
    const values = array(row, 256).map(n => integer(n, 0, 1000000));
    if (values.length !== speciesIds.length) fail('probability state width mismatch.');
    return values;
  });
  budget.probabilityStates += states.length * speciesIds.length;
  if (!states.length || budget.probabilityStates > 200000 || new Set(states.map(row => row.join(','))).size !== states.length) fail('empty, oversized or duplicated probability states.');
  const mass = array(raw.mass, 1000000).map(row => {
    const values = array(row, 4096).map(finite);
    budget.probabilities += values.length;
    if (values.length !== states.length || budget.probabilities > 200000 || values.some(p => p < 0 || p > 1) || Math.abs(values.reduce((sum, p) => sum + p, 0) - 1) > 1e-8) fail('invalid or oversized probability mass.');
    return values;
  });
  if (!run.times.length || mass.length !== run.times.length) fail('probability time count mismatch.');
  const maximumMassError = finite(raw.maximumMassError);
  if (maximumMassError < 0 || maximumMassError > 1e-5) fail('invalid probability residual.');
  // The same joint distribution must reproduce the exported single-species moments.
  for (const series of run.series) {
    const column = speciesIds.indexOf(series.name); if (column < 0) continue; // Compound plot moments are calculated by the engine from the joint distribution.
    for (let t = 0; t < mass.length; t++) {
      const mean = mass[t].reduce((sum, p, i) => sum + p * states[i][column], 0);
      const variance = mass[t].reduce((sum, p, i) => sum + p * (states[i][column] - mean) ** 2, 0);
      if (Math.abs(mean - series.values[t]) > 1e-8 * Math.max(1, Math.abs(mean)) || !series.standardDeviation || Math.abs(Math.sqrt(variance) - series.standardDeviation[t]) > 1e-8 * Math.max(1, Math.sqrt(variance))) fail('probabilities disagree with their mean or uncertainty.');
    }
  }
  return { speciesIds, states, mass, maximumMassError };
}

export function readProgram(raw) {
  object(raw); const source = text(raw.source);
  if (byteLength(source) > MAX_CODE_BYTES) fail('CRN source exceeds 256 KiB.');
  let systems = 0, mappings = 0;
  const nodes = array(raw.nodes, 32).map(node => {
    object(node); const items = array(node.systems, 65).map(system => {
      object(system); systems++;
      return { id: text(system.id, 128), speciesCount: integer(system.speciesCount, 0, 10000), reactionCount: integer(system.reactionCount, 0, 50000) };
    });
    if (!items.length || !items.some(item => item.id === '') || new Set(items.map(item => item.id)).size !== items.length) fail('duplicate or missing CRN systems.');
    return { id: text(node.id, 128), systems: items };
  });
  if (!nodes.length || systems > 256 || new Set(nodes.map(node => node.id)).size !== nodes.length) fail('duplicate, missing or oversized model nodes.');
  const location = raw => {
    object(raw); const nodeId = text(raw.nodeId, 128), systemId = text(raw.systemId, 128);
    if (!nodes.find(node => node.id === nodeId)?.systems.some(system => system.id === systemId)) fail('unknown model location.');
    return { nodeId, systemId };
  };
  const edges = array(raw.edges, 128).map(edge => {
    object(edge);
    const parameters = array(edge.parameters, 1024).map(parameter => {
      object(parameter); mappings++;
      return { sourceParameter: text(parameter.sourceParameter, 128), targetParameter: text(parameter.targetParameter, 128), kind: choice(parameter.kind, ['Fixed', 'Normal', 'LogNormal', 'TruncatedNormal']) };
    });
    return { source: location(edge.source), target: location(edge.target), parameters };
  });
  if (mappings > 1024) fail('too many parameter mappings.');
  const pending = new Set(nodes.map(node => node.id));
  while (pending.size) {
    const roots = [...pending].filter(id => edges.every(edge => edge.target.nodeId !== id || !pending.has(edge.source.nodeId)));
    if (!roots.length) fail('cyclic model links.');
    roots.forEach(id => pending.delete(id));
  }
  const selected = location({ nodeId: raw.selectedNodeId, systemId: raw.selectedSystemId });
  return { source, nodes, edges, selectedNodeId: selected.nodeId, selectedSystemId: selected.systemId };
}

export function readResponse(raw, nested=false) {
  object(raw);
  if (raw.success !== true) fail('only completed successful results can be restored.');
  const operation = choice(raw.operation, ['parse', 'expand', 'simulate', 'infer', 'analyze', 'synthesize', 'export']), dialect = choice(raw.dialect, ['current', 'legacy']);
  const source = object(raw.model), settings = readSettings(source.settings);
  if (typeof source.isJit !== 'boolean') fail('invalid JIT flag.');
  const { species, reactions } = readNetwork(source, source.isJit, operation);
  let samples = 0; const budget = { cells: 0, states: 0, edges: 0, probabilities: 0, probabilityStates: 0 };
  const simulations = array(source.simulations, 256).map(run => {
    object(run);
    const times = array(run.times, 1000000).map(finite);
    if (times.some((value, index) => index && value < times[index - 1])) fail('simulation times are not ordered.');
    const series = array(run.series, 10000).map(column => {
      object(column); const values = array(column.values, 1000000).map(finite); samples += values.length;
      if (values.length !== times.length || samples > 1000000) fail('invalid or oversized simulation table.');
      const result = { name: text(column.name), values };
      if (column.standardDeviation !== undefined) {
        result.standardDeviation = column.standardDeviation === null ? null : array(column.standardDeviation, 1000000).map(finite);
        if (result.standardDeviation && (result.standardDeviation.length !== times.length || result.standardDeviation.some(value => value < 0))) fail('invalid standard deviations.');
      }
      return result;
    });
    const result = { name: text(run.name), sweep: text(run.sweep), assignment: text(run.assignment), times, series, seed: seed(run.seed) };
    if (run.settings !== undefined) {
      result.settings = run.settings === null ? null : readSettings(run.settings);
      if (result.settings && result.settings.seed !== result.seed) fail('run settings disagree with its seed.');
    }
    if (run.network !== undefined) result.network = run.network === null ? null : readNetwork(run.network, source.isJit, operation);
    if (run.spatial !== undefined) result.spatial = run.spatial === null ? null : readSpatial(run.spatial, result, budget);
    if (run.stateSpace !== undefined) result.stateSpace = run.stateSpace === null ? null : readStateSpace(run.stateSpace, result.network || { species }, budget);
    const simulator = result.settings?.simulator || settings.simulator;
    if (run.probabilities !== undefined) result.probabilities = run.probabilities === null ? null : readProbabilities(run.probabilities, result, result.network || { species }, budget);
    if (result.probabilities && (operation !== 'simulate' || !['cme', 'cmesundials'].includes(simulator))) fail('probability output does not match its simulator.');
    if (Boolean(result.spatial) !== (operation === 'simulate' && simulator === 'pde')) fail('spatial output does not match its simulator.');
    if (Boolean(result.stateSpace) !== (operation === 'analyze') || (result.stateSpace && (times.length || series.length))) fail('state-space output does not match its operation.');
    return result;
  });
  if (operation === 'analyze' && !simulations.length) fail('missing state-space runs.');
  const model = { kind: choice(source.kind, ['classic', 'rules', 'crn']), compilation: choice(source.compilation, ['source', 'default', 'detailed', 'finite', 'infinite']), isJit: source.isJit, settings, species, reactions, simulations };
  if (source.crnCode !== undefined) model.crnCode = nullableText(source.crnCode);
  if (source.program !== undefined) model.program = source.program === null ? null : readProgram(source.program);
  if (model.kind === 'crn' && (!model.program || model.isJit || model.compilation !== 'source')) fail('invalid CRN program metadata.');
  if (source.inference !== undefined) model.inference = source.inference === null ? null : readInference(source.inference, simulations);
  if ((operation === 'infer') !== Boolean(model.inference)) fail('inference metadata does not match the operation.');
  if(source.inferenceNodes!==undefined){
    model.inferenceNodes=source.inferenceNodes===null?null:array(source.inferenceNodes,8).map(node=>{
      object(node);const nodeId=text(node.nodeId,128);
      if(operation!=='infer' || !model.program?.nodes.some(n=>n.id===nodeId))fail('unknown fitted model node.');
      const parsed=readResponse({success:true,operation,dialect,diagnostics:[],model:{...source,settings:node.settings,species:object(node.network).species,reactions:node.network.reactions,simulations:node.simulations,inference:node.inference,inferenceNodes:undefined}},true).model;
      return {nodeId,settings:parsed.settings,network:{species:parsed.species,reactions:parsed.reactions},simulations:parsed.simulations,inference:parsed.inference};
    });
    if(model.inferenceNodes){
      const nodes=model.inferenceNodes;
      if(nodes.length!==model.program.nodes.length || new Set(nodes.map(n=>n.nodeId)).size!==nodes.length || nodes.reduce((s,n)=>s+n.inference.dataPoints,0)>20000 || nodes.reduce((s,n)=>s+(n.inference.burnIn+n.inference.iterations)*(n.inference.chains?.length||1),0)>20000)fail('invalid fitted model graph size or work.');
      if(model.program.edges.some(edge=>nodes.findIndex(n=>n.nodeId===edge.source.nodeId)>=nodes.findIndex(n=>n.nodeId===edge.target.nodeId)))fail('fitted graph is not in dependency order.');
      const chosen=nodes.find(n=>n.nodeId===model.program.selectedNodeId);
      for(const [a,b]of [[chosen?.settings,model.settings],[chosen?.network.species,model.species],[chosen?.network.reactions,model.reactions],[chosen?.simulations,model.simulations],[chosen?.inference,model.inference]])if(JSON.stringify(a)!==JSON.stringify(b))fail('selected fitted model differs from its graph entry.');
    }
  }
  if(!nested && operation==='infer' && model.program?.nodes.length>1 && !model.inferenceNodes?.length)fail('missing linked inference results.');

  if(source.synthesis!=null)model.synthesis=readSynthesis(source.synthesis,species.map(s=>s.id));
  if((operation==='synthesize')!==Boolean(model.synthesis))fail('synthesis metadata does not match its operation.');
  if(source.exports!=null)model.exports=readExports(source.exports);
  if((operation==='export')!==Boolean(model.exports))fail('export metadata does not match its operation.');
  if(source.dsd!=null){if(model.kind==='crn')fail('CRN results cannot contain DSD metadata.');model.dsd=readDsdWorkspace(source.dsd);if(model.dsd.options.jit!==model.isJit)fail('DSD JIT metadata differs from the result.');}
  return { success: true, operation, dialect, diagnostics: [], model };
}

function readSavedResult(raw, model) {
  object(raw); const request = normaliseRequest(raw.request), response = readResponse(raw.response);
  if (request.operation !== response.operation || (request.dialect !== 'auto' && request.dialect !== response.dialect)) fail('result does not match its request metadata.');
  if (!['simulate', 'infer', 'analyze', 'synthesize', 'export'].includes(response.operation) && response.model.simulations.length) fail('unexpected simulation data.');
  if (request.language === 'crn') {
    const program = response.model.program;
    if (response.model.kind !== 'crn' || program?.source !== request.code || (request.nodeId != null && program.selectedNodeId !== request.nodeId) || (request.systemId != null && program.selectedSystemId !== request.systemId)) fail('CRN result does not match its source or selection.');
  } else if (response.model.kind === 'crn') fail('a DSD request cannot contain a CRN result.');
  if(request.dsdOptions && Object.entries(request.dsdOptions).some(([key,value])=>response.model.dsd?.options[key]!==value))fail('DSD result differs from its requested settings.');
  const snapshot = { name: text(raw.name, 120), engineVersion: text(raw.engineVersion || 'unknown', 50), request };
  const networkFocus = text(raw.networkFocus ?? '', 512);
  const fitNodeId=text(raw.fitNodeId??response.model.program?.selectedNodeId??'',128);
  if(response.model.inferenceNodes?.length && !response.model.inferenceNodes.some(n=>n.nodeId===fitNodeId))fail('unknown selected inference node.');
  const selected=modelForNode(response.model,fitNodeId);
  const runIndex = integer(raw.runIndex ?? 0, 0, Math.max(0, selected.simulations.length - 1));
  if (networkFocus && !modelForRun(selected, runIndex).species.some(species => species.id === networkFocus)) fail('network focus refers to an unknown species.');
  const run = selected.simulations[runIndex];
  const fitParameter=text(raw.fitParameter??'',512),fitPair=text(raw.fitPair??'',512);
  if([fitParameter,fitPair].some(name=>name && !selected.inference?.parameters.some(p=>p.name===name)))fail('unknown selected posterior parameter.');
  const spatialSeries = integer(raw.spatialSeries ?? 0, 0, Math.max(0, (run?.spatial?.series.length || 0) - 1));
  const spatialFrame = integer(raw.spatialFrame ?? 0, 0, Math.max(0, (run?.times.length || 0) - 1));
  const stateIndex = integer(raw.stateIndex ?? 0, 0, Math.max(0, (run?.stateSpace?.states.length || 0) - 1));
  const probabilitySpecies = integer(raw.probabilitySpecies ?? 0, 0, Math.max(0, (run?.probabilities?.speciesIds.length || 0) - 1));
  const probabilityFrame = integer(raw.probabilityFrame ?? 0, 0, Math.max(0, (run?.times.length || 0) - 1));
  if (raw.probabilityLog !== undefined && typeof raw.probabilityLog !== 'boolean') fail('invalid probability palette.');
  return { response, snapshot, fitNodeId, fitParameter, fitPair, spatialSeries, spatialFrame, stateIndex, probabilitySpecies, probabilityFrame, probabilityLog: raw.probabilityLog ?? false, revision: resultIsCurrent(model, snapshot) ? 0 : -1, runIndex, tab: choice(raw.tab ?? 'plot', ['plot', 'species', 'reactions', 'data', 'network', 'fit', 'synthesis', 'exports', 'dsd', 'spatial', 'states', 'program', 'probabilities']), networkFocus };
}

export function parseProject(input) {
  if (typeof input !== 'string' || byteLength(input) > MAX_PROJECT_BYTES) fail('file exceeds 16 MiB.');
  let raw; try { raw = JSON.parse(input); } catch { fail('file is not valid JSON.'); }
  object(raw);
  if (raw.format !== 'visual-dsd-project' || raw.version !== 1) fail('unsupported project format or version.');
  const documents = array(raw.documents, MAX_DOCUMENTS).map(readDocument);
  if (!documents.length || new Set(documents.map(model => model.id)).size !== documents.length) fail('missing models or duplicate identifiers.');
  if (!documents.some(model => model.id === raw.activeId)) fail('active model is missing.');
  const views = new Map();
  for (let index = 0; index < documents.length; index++) if (raw.documents[index].result != null) views.set(documents[index].id, readSavedResult(raw.documents[index].result, documents[index]));
  const sequences=readSequenceWorkspace(raw.sequences);
  for(const record of sequences.records)for(const feature of record.genbank?.features??[])featureLocation(feature.location,record.sequence.length,record.genbank.topology);
  return { documents, activeId: raw.activeId, views, sequences, systems: readSystemsWorkspace(raw.systems) };
}

export function serialiseProject(documents, activeId, views, engineVersion, sequences, systems) {
  const raw = { format: 'visual-dsd-project', version: 1, engineVersion, savedAt: new Date().toISOString(), activeId, documents: documents.map(model => {
    const entry = { id: model.id, name: model.name, code: model.code, options: model.options, databases: model.databases, data: readDatasets(model.data), exampleId: model.exampleId };
    if(model.logic)entry.logic=readLogicState(model.logic);
    if(model.courseReport)entry.courseReport=readLogicReport(model.courseReport);
    const view = views.get(model.id);
    if (view?.response) entry.result = { ...view.snapshot, engineVersion: view.snapshot?.engineVersion || engineVersion, response: view.response, fitNodeId: view.fitNodeId, fitParameter: view.fitParameter, fitPair: view.fitPair, runIndex: view.runIndex, tab: view.tab, networkFocus: view.networkFocus || '', spatialSeries: view.spatialSeries || 0, spatialFrame: view.spatialFrame || 0, stateIndex: view.stateIndex || 0, probabilitySpecies: view.probabilitySpecies || 0, probabilityFrame: view.probabilityFrame || 0, probabilityLog: Boolean(view.probabilityLog) };
    return entry;
  }) };
  if(sequences!==undefined)raw.sequences=readSequenceWorkspace(sequences);
  if(systems!==undefined)raw.systems=readSystemsWorkspace(systems);
  const json = JSON.stringify(raw);
  parseProject(json);
  return json;
}
