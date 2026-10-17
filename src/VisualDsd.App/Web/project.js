import { MAX_CODE_BYTES, MAX_DOCUMENTS, byteLength, optionDefaults, requestFor, modelForRun } from './model.js';
import { readDatasets, readObservations } from './observations.js';

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
  for (const key of Object.keys(optionDefaults)) options[key] = text(object(raw.options)[key], 100);
  choice(options.dialect, ['auto', 'current', 'legacy']); choice(options.compilation, ['source', 'default', 'detailed', 'finite', 'infinite']); choice(options.simulator, ['source', 'oslo', 'ssa', 'lna', 'cme', 'pde']);
  const databases = {};
  const sourceDatabases = raw.databases === undefined ? {} : object(raw.databases);
  for (const key of ['toeholds', 'specificities']) if (sourceDatabases[key] !== undefined) {
    const entry = object(sourceDatabases[key]); databases[key] = { name: text(entry.name, 120), code: text(entry.code) };
    if (byteLength(entry.code) > MAX_CODE_BYTES) fail('sequence database exceeds 256 KiB.');
  }
  return { id, name, code, options, databases, data: readDatasets(raw.data), revision: 0, exampleId: raw.exampleId == null ? null : text(raw.exampleId, 100) };
}

export function normaliseRequest(raw) {
  object(raw);
  const options = { ...optionDefaults };
  for (const key of ['dialect', 'compilation', 'simulator']) if (raw[key] !== undefined) options[key] = text(raw[key], 30);
  choice(options.dialect, ['auto', 'current', 'legacy']); choice(options.compilation, ['source', 'default', 'detailed', 'finite', 'infinite']); choice(options.simulator, ['source', 'oslo', 'ssa', 'lna', 'cme', 'pde']);
  for (const key of ['initial', 'final', 'points', 'seed', 'timeoutSeconds']) if (raw[key] !== undefined && raw[key] !== null) options[key] = String(finite(raw[key]));
  const databases = {};
  for (const key of ['toeholds', 'specificities']) if (raw[key] !== undefined && raw[key] !== null) { const code = text(raw[key]); if (byteLength(code) > MAX_CODE_BYTES) fail('sequence database exceeds 256 KiB.'); databases[key] = { name: 'Custom database', code }; }
  return requestFor({ code: text(raw.code), options, databases, data: readDatasets(raw.data) }, choice(raw.operation, ['parse', 'expand', 'simulate', 'infer', 'analyze']));
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
    return { id: text(item.id, 512), name: text(item.name), structure: text(item.structure), svg: text(item.svg, 8 * 1024 * 1024), initial: text(item.initial), constant: item.constant, time: nullableText(item.time), valueKind: choice(valueKind, ['initial', 'finalPopulation', 'scheduledInput']) };
  });
  const ids = new Set(species.map(item => item.id)); if (ids.size !== species.length) fail('duplicate species identifiers.');
  const participants = items => array(items, 10000).map(item => { object(item); if (!ids.has(item.speciesId)) fail('reaction refers to an unknown species.'); return { speciesId: item.speciesId, multiplicity: integer(item.multiplicity, 1, 2147483647) }; });
  const rate = item => { object(item); return { kind: choice(item.kind, ['massAction', 'functional']), expression: text(item.expression) }; };
  const reactions = array(source.reactions, 50000).map(item => { object(item); return { reactants: participants(item.reactants), products: participants(item.products), catalysts: participants(item.catalysts), rate: rate(item.rate), reverseRate: item.reverseRate == null ? null : rate(item.reverseRate) }; });
  return { species, reactions };
}

function readInference(raw, runs) {
  object(raw);
  const retainedSamples = integer(raw.retainedSamples, 2, 500);
  const likelihood = array(raw.logLikelihood, 500).map(finite);
  if (likelihood.length !== retainedSamples) fail('posterior sample count mismatch.');
  const parameters = array(raw.parameters, 100).map(parameter => {
    object(parameter); const samples = array(parameter.samples, 500).map(finite);
    if (samples.length !== retainedSamples || finite(parameter.variance) < 0 || finite(parameter.lower95) > finite(parameter.upper95)) fail('invalid posterior parameter summary.');
    return { name: text(parameter.name, 512), kind: choice(parameter.kind, ['model', 'noise']), mle: finite(parameter.mle), mean: finite(parameter.mean), variance: parameter.variance, median: finite(parameter.median), lower95: parameter.lower95, upper95: parameter.upper95, samples };
  });
  if (!parameters.length || new Set(parameters.map(p => p.name)).size !== parameters.length) fail('missing or duplicated inferred parameters.');
  const observations = array(raw.observations, 32).map(readObservations);
  if (observations.length !== runs.length || observations.some((table, i) => table.times.length !== runs[i].times.length || table.times.some((time, row) => time !== runs[i].times[row]) || table.series.length !== runs[i].series.length || table.series.some((column, j) => column.name !== runs[i].series[j].name))) fail('fit observations do not match the predicted tables.');
  const dataPoints = integer(raw.dataPoints, 1, 20000);
  if (dataPoints !== observations.reduce((sum, table) => sum + table.times.length * table.series.length, 0)) fail('observation count mismatch.');
  const burnIn = integer(raw.burnIn, 0, 20000), iterations = integer(raw.iterations, 2, 20000), thin = integer(raw.thin, 1, 20000);
  if (burnIn + iterations > 20000 || Math.floor(iterations / thin) !== retainedSamples) fail('invalid MCMC iteration counts.');
  return { seed: integer(raw.seed, 0, 4294967295), burnIn, iterations, thin, retainedSamples, dataPoints, maxLogLikelihood: finite(raw.maxLogLikelihood), parameters, logLikelihood: likelihood, observations };
}

function readSpatial(raw, run, budget) {
  object(raw);
  const dimensions = integer(raw.dimensions, 1, 2), boundary = choice(raw.boundary, ['Periodic', 'ZeroFlux']);
  const x = array(raw.x, dimensions === 1 ? 128 : 64).map(finite), y = array(raw.y, 64).map(finite);
  if (x.length < 4 || x[0] !== 0 || x.some((value, i) => i && value <= x[i - 1]) || (dimensions === 1 ? y.length !== 0 : y.length !== x.length || y.some((value, i) => value !== x[i]))) fail('invalid spatial coordinates.');
  if (x.some((value, i) => Math.abs(value - i * x.at(-1) / (x.length - 1)) > 1e-10 * x.at(-1))) fail('spatial grid must be uniform.');
  const dt = finite(raw.dt); if (dt <= 0 || !run.times.length || run.times.length > 501) fail('invalid spatial time step or frames.');
  const cells = x.length * (y.length || 1);
  const series = array(raw.series, 10000).map((column, i) => {
    object(column); const name = text(column.name);
    if (name !== run.series[i]?.name) fail('spatial series do not match grid mean series.');
    const frames = array(column.frames, 501).map(frame => {
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

export function readResponse(raw) {
  object(raw);
  if (raw.success !== true) fail('only completed successful results can be restored.');
  const operation = choice(raw.operation, ['parse', 'expand', 'simulate', 'infer', 'analyze']), dialect = choice(raw.dialect, ['current', 'legacy']);
  const source = object(raw.model), settings = readSettings(source.settings);
  if (typeof source.isJit !== 'boolean') fail('invalid JIT flag.');
  const { species, reactions } = readNetwork(source, source.isJit, operation);
  let samples = 0; const budget = { cells: 0, states: 0, edges: 0 };
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
    if (Boolean(result.spatial) !== (operation === 'simulate' && simulator === 'pde')) fail('spatial output does not match its simulator.');
    if (Boolean(result.stateSpace) !== (operation === 'analyze') || (result.stateSpace && (times.length || series.length))) fail('state-space output does not match its operation.');
    return result;
  });
  if (operation === 'analyze' && !simulations.length) fail('missing state-space runs.');
  const model = { kind: choice(source.kind, ['classic', 'rules']), compilation: choice(source.compilation, ['default', 'detailed', 'finite', 'infinite']), isJit: source.isJit, settings, species, reactions, simulations };
  if (source.inference !== undefined) model.inference = source.inference === null ? null : readInference(source.inference, simulations);
  if ((operation === 'infer') !== Boolean(model.inference)) fail('inference metadata does not match the operation.');
  return { success: true, operation, dialect, diagnostics: [], model };
}

function readSavedResult(raw, model) {
  object(raw); const request = normaliseRequest(raw.request), response = readResponse(raw.response);
  if (request.operation !== response.operation || (request.dialect !== 'auto' && request.dialect !== response.dialect)) fail('result does not match its request metadata.');
  if (!['simulate', 'infer', 'analyze'].includes(response.operation) && response.model.simulations.length) fail('unexpected simulation data.');
  const snapshot = { name: text(raw.name, 120), engineVersion: text(raw.engineVersion || 'unknown', 50), request };
  const networkFocus = text(raw.networkFocus ?? '', 512);
  const runIndex = integer(raw.runIndex ?? 0, 0, Math.max(0, response.model.simulations.length - 1));
  if (networkFocus && !modelForRun(response.model, runIndex).species.some(species => species.id === networkFocus)) fail('network focus refers to an unknown species.');
  const run = response.model.simulations[runIndex];
  const spatialSeries = integer(raw.spatialSeries ?? 0, 0, Math.max(0, (run?.spatial?.series.length || 0) - 1));
  const spatialFrame = integer(raw.spatialFrame ?? 0, 0, Math.max(0, (run?.times.length || 0) - 1));
  const stateIndex = integer(raw.stateIndex ?? 0, 0, Math.max(0, (run?.stateSpace?.states.length || 0) - 1));
  return { response, snapshot, spatialSeries, spatialFrame, stateIndex, revision: resultIsCurrent(model, snapshot) ? 0 : -1, runIndex, tab: choice(raw.tab ?? 'plot', ['plot', 'species', 'reactions', 'data', 'network', 'fit', 'spatial', 'states']), networkFocus };
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
  return { documents, activeId: raw.activeId, views };
}

export function serialiseProject(documents, activeId, views, engineVersion) {
  const raw = { format: 'visual-dsd-project', version: 1, engineVersion, savedAt: new Date().toISOString(), activeId, documents: documents.map(model => {
    const entry = { id: model.id, name: model.name, code: model.code, options: model.options, databases: model.databases, data: readDatasets(model.data), exampleId: model.exampleId };
    const view = views.get(model.id);
    if (view?.response) entry.result = { ...view.snapshot, engineVersion: view.snapshot?.engineVersion || engineVersion, response: view.response, runIndex: view.runIndex, tab: view.tab, networkFocus: view.networkFocus || '', spatialSeries: view.spatialSeries || 0, spatialFrame: view.spatialFrame || 0, stateIndex: view.stateIndex || 0 };
    return entry;
  }) };
  const json = JSON.stringify(raw);
  parseProject(json);
  return json;
}
