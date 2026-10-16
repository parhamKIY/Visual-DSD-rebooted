import { MAX_CODE_BYTES, MAX_DOCUMENTS, byteLength, optionDefaults, requestFor } from './model.js';

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
  choice(options.dialect, ['auto', 'current', 'legacy']); choice(options.compilation, ['source', 'default', 'detailed', 'finite', 'infinite']); choice(options.simulator, ['source', 'oslo', 'ssa']);
  const databases = {};
  const sourceDatabases = raw.databases === undefined ? {} : object(raw.databases);
  for (const key of ['toeholds', 'specificities']) if (sourceDatabases[key] !== undefined) {
    const entry = object(sourceDatabases[key]); databases[key] = { name: text(entry.name, 120), code: text(entry.code) };
    if (byteLength(entry.code) > MAX_CODE_BYTES) fail('sequence database exceeds 256 KiB.');
  }
  return { id, name, code, options, databases, revision: 0, exampleId: raw.exampleId == null ? null : text(raw.exampleId, 100) };
}

export function normaliseRequest(raw) {
  object(raw);
  const options = { ...optionDefaults };
  for (const key of ['dialect', 'compilation', 'simulator']) if (raw[key] !== undefined) options[key] = text(raw[key], 30);
  choice(options.dialect, ['auto', 'current', 'legacy']); choice(options.compilation, ['source', 'default', 'detailed', 'finite', 'infinite']); choice(options.simulator, ['source', 'oslo', 'ssa']);
  for (const key of ['initial', 'final', 'points', 'seed', 'timeoutSeconds']) if (raw[key] !== undefined && raw[key] !== null) options[key] = String(finite(raw[key]));
  const databases = {};
  for (const key of ['toeholds', 'specificities']) if (raw[key] !== undefined && raw[key] !== null) { const code = text(raw[key]); if (byteLength(code) > MAX_CODE_BYTES) fail('sequence database exceeds 256 KiB.'); databases[key] = { name: 'Custom database', code }; }
  return requestFor({ code: text(raw.code), options, databases }, choice(raw.operation, ['parse', 'expand', 'simulate']));
}

export function resultIsCurrent(model, snapshot) {
  try { return JSON.stringify(requestFor(model, snapshot.request.operation)) === JSON.stringify(normaliseRequest(snapshot.request)); }
  catch { return false; }
}

export function readResponse(raw) {
  object(raw);
  if (raw.success !== true) fail('only completed successful results can be restored.');
  const operation = choice(raw.operation, ['parse', 'expand', 'simulate']), dialect = choice(raw.dialect, ['current', 'legacy']);
  const source = object(raw.model), settings = object(source.settings);
  const species = array(source.species, 10000).map(item => {
    object(item); if (typeof item.constant !== 'boolean') fail('invalid species flag.');
    const valueKind = item.valueKind ?? (source.isJit && operation === 'simulate' ? item.time == null ? 'finalPopulation' : 'scheduledInput' : 'initial');
    return { id: text(item.id, 512), name: text(item.name), structure: text(item.structure), svg: text(item.svg, 8 * 1024 * 1024), initial: text(item.initial), constant: item.constant, time: nullableText(item.time), valueKind: choice(valueKind, ['initial', 'finalPopulation', 'scheduledInput']) };
  });
  const ids = new Set(species.map(item => item.id)); if (ids.size !== species.length) fail('duplicate species identifiers.');
  const participants = items => array(items, 10000).map(item => { object(item); if (!ids.has(item.speciesId)) fail('reaction refers to an unknown species.'); return { speciesId: item.speciesId, multiplicity: integer(item.multiplicity, 1, 2147483647) }; });
  const rate = item => { object(item); return { kind: choice(item.kind, ['massAction', 'functional']), expression: text(item.expression) }; };
  const reactions = array(source.reactions, 50000).map(item => { object(item); return { reactants: participants(item.reactants), products: participants(item.products), catalysts: participants(item.catalysts), rate: rate(item.rate), reverseRate: item.reverseRate == null ? null : rate(item.reverseRate) }; });
  let samples = 0;
  const simulations = array(source.simulations, 256).map(run => {
    object(run);
    const times = array(run.times, 1000000).map(finite);
    if (times.some((value, index) => index && value < times[index - 1])) fail('simulation times are not ordered.');
    const series = array(run.series, 10000).map(column => {
      object(column); const values = array(column.values, 1000000).map(finite); samples += values.length;
      if (values.length !== times.length || samples > 1000000) fail('invalid or oversized simulation table.');
      return { name: text(column.name), values };
    });
    return { name: text(run.name), sweep: text(run.sweep), assignment: text(run.assignment), times, series, seed: seed(run.seed) };
  });
  if (typeof source.isJit !== 'boolean') fail('invalid JIT flag.');
  return { success: true, operation, dialect, diagnostics: [], model: { kind: choice(source.kind, ['classic', 'rules']), compilation: choice(source.compilation, ['default', 'detailed', 'finite', 'infinite']), isJit: source.isJit, settings: { simulator: text(settings.simulator, 50), initial: finite(settings.initial), final: finite(settings.final), points: integer(settings.points, -2147483648, 2147483647), seed: seed(settings.seed), timeUnit: text(settings.timeUnit, 100), concentrationUnit: text(settings.concentrationUnit, 100) }, species, reactions, simulations } };
}

function readSavedResult(raw, model) {
  object(raw); const request = normaliseRequest(raw.request), response = readResponse(raw.response);
  if (request.operation !== response.operation || (request.dialect !== 'auto' && request.dialect !== response.dialect)) fail('result does not match its request metadata.');
  if (response.operation !== 'simulate' && response.model.simulations.length) fail('unexpected simulation data.');
  const snapshot = { name: text(raw.name, 120), engineVersion: text(raw.engineVersion || 'unknown', 50), request };
  const networkFocus = text(raw.networkFocus ?? '', 512);
  if (networkFocus && !response.model.species.some(species => species.id === networkFocus)) fail('network focus refers to an unknown species.');
  return { response, snapshot, revision: resultIsCurrent(model, snapshot) ? 0 : -1, runIndex: integer(raw.runIndex ?? 0, 0, Math.max(0, response.model.simulations.length - 1)), tab: choice(raw.tab ?? 'plot', ['plot', 'species', 'reactions', 'data', 'network']), networkFocus };
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
    const entry = { id: model.id, name: model.name, code: model.code, options: model.options, databases: model.databases, exampleId: model.exampleId };
    const view = views.get(model.id);
    if (view?.response) entry.result = { ...view.snapshot, engineVersion: view.snapshot?.engineVersion || engineVersion, response: view.response, runIndex: view.runIndex, tab: view.tab, networkFocus: view.networkFocus || '' };
    return entry;
  }) };
  const json = JSON.stringify(raw);
  parseProject(json);
  return json;
}
