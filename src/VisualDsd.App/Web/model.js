import { dsdDefaults, dsdOverrides } from './dsd-workspace.js';
import { readDatasets } from './observations.js';
import { readLogicState } from './logic.js';

export const MAX_CODE_BYTES = 256 * 1024;
export const MAX_DOCUMENTS = 16;
export const STORAGE_KEY = 'visual-dsd.workspace.v1';
export const optionDefaults = Object.freeze({ ...dsdDefaults, language: 'dsd', nodeId: '', systemId: '', dialect: 'auto', compilation: 'source', simulator: 'source', initial: '', final: '', points: '', seed: '', timeoutSeconds: '30', phaseX: '', phaseY: '', phaseTrajectories: '12' });
export const byteLength = text => new TextEncoder().encode(text).length;
export const escapeHtml = text => String(text).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function modelForNode(model, nodeId) {
  const node=model.inferenceNodes?.find(n=>n.nodeId===nodeId);
  return node ? {...model, settings:node.settings, species:node.network.species, reactions:node.network.reactions, simulations:node.simulations, inference:node.inference} : model;
}

export function modelForRun(model, runIndex) {
  const run = model.simulations[runIndex];
  return { ...model, settings: run?.settings ?? model.settings, species: run?.network?.species ?? model.species, reactions: run?.network?.reactions ?? model.reactions };
}

export function createDocument(name = 'Untitled.dsd', code = '// Your strand displacement model\n\n<a^ b>\n', dialect = 'auto', exampleId = null) {
  if (byteLength(code) > MAX_CODE_BYTES) throw new Error('Model files must be no larger than 256 KiB.');
  return { id: crypto.randomUUID(), name, code: code.replace(/\r\n?/g, '\n'), options: { ...optionDefaults, dialect, language: /\.crn$/i.test(name) ? 'crn' : 'dsd' }, exampleId, revision: 0, databases: {}, data: [] };
}

export function restoreWorkspace(raw) {
  try {
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !Array.isArray(saved.documents)) return null;
    const ids = new Set();
    const documents = saved.documents.slice(0, MAX_DOCUMENTS).filter(document => {
      if (typeof document?.id !== 'string' || ids.has(document.id) || document.id.length > 80 || typeof document.name !== 'string' || typeof document.code !== 'string' || byteLength(document.code) > MAX_CODE_BYTES) return false;
      try { readDatasets(document.data); readLogicState(document.logic); } catch { return false; }
      ids.add(document.id);
      return true;
    }).map(document => {
      const options = { ...optionDefaults };
      for (const key of Object.keys(options)) if (typeof document.options?.[key] === 'string') options[key] = document.options[key];
      const databases = {};
      for (const key of ['toeholds', 'specificities']) {
        const entry = document.databases?.[key];
        if (typeof entry?.code === 'string' && byteLength(entry.code) <= MAX_CODE_BYTES) databases[key] = { name: String(entry.name || 'Custom database').slice(0, 120), code: entry.code };
      }
      return { id: document.id, name: document.name.slice(0, 120), code: document.code, options, databases, data: readDatasets(document.data), ...(document.logic?{logic:readLogicState(document.logic)}:{}), exampleId: typeof document.exampleId === 'string' ? document.exampleId : null, revision: 0 };
    });
    return documents.length ? { documents, activeId: documents.some(document => document.id === saved.activeId) ? saved.activeId : documents[0].id } : null;
  } catch { return null; }
}

export function requestFor(document, operation) {
  if (!['dsd', 'crn'].includes(document.options.language ?? 'dsd')) throw new Error('Choose Visual DSD or CRN as the model language.');
  const request = { code: document.code, operation, dialect: document.options.dialect, compilation: document.options.compilation, simulator: document.options.simulator };
  if (document.options.language !== 'crn') { const overrides=dsdOverrides(document.options); if(Object.keys(overrides).length)request.dsdOptions=overrides; }
  if (document.options.language === 'crn') {
    request.language = 'crn'; request.dialect = 'current'; request.compilation = 'source';
    if (document.options.nodeId) request.nodeId = document.options.nodeId;
    if (document.options.systemId) request.systemId = document.options.systemId === '$top' ? '' : document.options.systemId;
  }
  if (!request.code.trim()) throw new Error('Write a model before running it.');
  if (byteLength(request.code) > MAX_CODE_BYTES) throw new Error('The model exceeds 256 KiB.');
  for (const key of ['initial', 'final', 'points', 'seed', 'timeoutSeconds']) {
    const text = document.options[key].trim();
    if (!text) { if (key === 'timeoutSeconds') request[key] = 30; continue; }
    const value = Number(text);
    if (!Number.isFinite(value)) throw new Error(`${key}: enter a finite number.`);
    if (['points', 'seed', 'timeoutSeconds'].includes(key) && !Number.isInteger(value)) throw new Error(`${key}: enter a whole number.`);
    request[key] = value;
  }
  if (request.points !== undefined && (request.points < 1 || request.points > 100000)) throw new Error('Output points must be between 1 and 100000.');
  if (request.seed !== undefined && (request.seed < -2147483648 || request.seed > 2147483647)) throw new Error('The random seed must fit in a 32-bit integer.');
  if (request.timeoutSeconds < 1 || request.timeoutSeconds > 86400) throw new Error('The time limit must be between 1 and 86400 seconds.');
  if (request.initial !== undefined && request.final !== undefined && request.final <= request.initial) throw new Error('Final time must be greater than initial time.');
  for (const key of ['toeholds', 'specificities']) if (document.options.language !== 'crn' && document.databases[key]) request[key] = document.databases[key].code;
  if (operation === 'infer') {
    request.data = readDatasets(document.data);
    if (!request.data.length) throw new Error('Import observation CSV files before fitting parameters.');
  }
  if (operation === 'synthesize') {
    const x=(document.options.phaseX??'').trim(),y=(document.options.phaseY??'').trim();
    if(Boolean(x)!==Boolean(y)||x.length>128||y.length>128)throw new Error('Specify both phase species (at most 128 characters each).');
    if(x){request.phaseX=x;request.phaseY=y;}
    const count=Number(document.options.phaseTrajectories??12);
    if(!Number.isInteger(count)||count<0||count>16)throw new Error('Phase trajectories must be between 0 and 16.');
    request.phaseTrajectories=count;
  }
  return request;
}

export function highlightSource(source) {
  const tokens = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|"(?:[^"\\]|\\.)*"|\b(?:directive|new|def|dom|rxn|module|system|in|if|then|else|true|false|deterministic|stochastic|infinite|finite|detailed)\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|[<>\[\]{}^*|:]/g;
  let html = '', cursor = 0;
  for (const match of source.matchAll(tokens)) {
    html += escapeHtml(source.slice(cursor, match.index));
    const token = match[0];
    const kind = token.startsWith('//') || token.startsWith('/*') ? 'comment' : /^\d/.test(token) ? 'number' : /^\w/.test(token) ? 'keyword' : token.startsWith('"') ? 'domain' : 'punctuation';
    html += `<span class="token-${kind}">${escapeHtml(token)}</span>`;
    cursor = match.index + token.length;
  }
  return html + escapeHtml(source.slice(cursor)) + '\n';
}

export function positionAt(source, line, column) {
  const lines = source.split('\n');
  const row = Math.max(0, Math.min(lines.length - 1, (line || 1) - 1));
  return lines.slice(0, row).reduce((sum, text) => sum + text.length + 1, 0) + Math.max(0, Math.min(lines[row].length, (column || 1) - 1));
}

export function csvFor(run, timeUnit = '') {
  const quote = (value, header = false) => {
    let text = String(value);
    if (header && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const columns = run.series.flatMap(series => [{ name: series.name, values: series.values }, ...(series.standardDeviation ? [{ name: `${series.name} (StDev)`, values: series.standardDeviation }] : [])]);
  const header = [timeUnit ? `Time (${timeUnit})` : 'Time', ...columns.map(series => series.name)].map(value => quote(value, true)).join(',');
  const rows = run.times.map((time, index) => [time, ...columns.map(series => series.values[index])].map(value => quote(value)).join(','));
  return [header, ...rows].join('\r\n') + '\r\n';
}

export function numberLabel(value) {
  if (!Number.isFinite(Number(value))) return String(value);
  const number = Number(value);
  return number === 0 ? '0' : Math.abs(number) >= 100000 || Math.abs(number) < .001 ? number.toExponential(3).replace(/\.?0+e/, 'e') : Number(number.toPrecision(6)).toString();
}

// Expand scientific literals as text: no rounding, expression evaluation or
// changes to rate identifiers, species references, source or simulation data.
export function rateLabel(expression) {
  return String(expression).replace(/\[[^\]]*\]|"[^"\n]*"|'[^'\n]*'|[\p{L}_][\p{L}\p{N}_']*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/gu, token => {
    const scientific = /^(\d*\.?\d+)[eE]([+-]?\d+)$/.exec(token);
    if (!scientific) return token;
    const exponent = Number(scientific[2]);
    if (!Number.isInteger(exponent) || Math.abs(exponent) > 324) return token;
    const mantissa = scientific[1], digits = mantissa.replace('.', '');
    if (/^0+$/.test(digits)) return '0';
    const decimal = (mantissa.includes('.') ? mantissa.indexOf('.') : mantissa.length) + exponent;
    return decimal <= 0 ? `0.${'0'.repeat(-decimal)}${digits}`
      : decimal >= digits.length ? digits + '0'.repeat(decimal - digits.length)
      : `${digits.slice(0, decimal)}.${digits.slice(decimal)}`;
  });
}

export function populationLabel(species) {
  if (species.valueKind === 'spatial') return 'Spatial initial field · defined in model';
  return `${species.valueKind === 'finalPopulation' ? 'Population at end' : species.valueKind === 'scheduledInput' ? 'Scheduled input' : species.valueKind === 'timedInput' ? 'Timed input' : species.valueKind === 'initialContribution' ? 'Initial contribution' : 'Initial'}: ${species.initial}${species.constant ? ' · constant' : ''}${species.time ? ` · ${species.valueKind === 'scheduledInput' ? 'after' : 'at'} ${species.time}` : ''}`;
}

export function reactionLabel(reaction, species) {
  const names = new Map(species.map(item => [item.id, item.name || item.id]));
  const side = participants => participants.map(participant => `${participant.multiplicity === 1 ? '' : `${participant.multiplicity} `}${names.get(participant.speciesId) || participant.speciesId}`).join(' + ') || '∅';
  return { equation: `${side(reaction.reactants)} ${reaction.reverseRate ? '⇌' : '→'} ${side(reaction.products)}`, catalysts: reaction.catalysts.length ? side(reaction.catalysts) : '' };
}
