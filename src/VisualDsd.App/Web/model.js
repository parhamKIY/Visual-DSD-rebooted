export const MAX_CODE_BYTES = 256 * 1024;
export const MAX_DOCUMENTS = 16;
export const STORAGE_KEY = 'visual-dsd.workspace.v1';
export const optionDefaults = Object.freeze({ dialect: 'auto', compilation: 'source', simulator: 'source', initial: '', final: '', points: '', seed: '', timeoutSeconds: '30' });
export const byteLength = text => new TextEncoder().encode(text).length;
export const escapeHtml = text => String(text).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function createDocument(name = 'Untitled.dsd', code = '// Your strand displacement model\n\n<a^ b>\n', dialect = 'auto', exampleId = null) {
  if (byteLength(code) > MAX_CODE_BYTES) throw new Error('Model files must be no larger than 256 KiB.');
  return { id: crypto.randomUUID(), name, code: code.replace(/\r\n?/g, '\n'), options: { ...optionDefaults, dialect }, exampleId, revision: 0, databases: {} };
}

export function restoreWorkspace(raw) {
  try {
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !Array.isArray(saved.documents)) return null;
    const ids = new Set();
    const documents = saved.documents.slice(0, MAX_DOCUMENTS).filter(document => {
      if (typeof document?.id !== 'string' || ids.has(document.id) || document.id.length > 80 || typeof document.name !== 'string' || typeof document.code !== 'string' || byteLength(document.code) > MAX_CODE_BYTES) return false;
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
      return { id: document.id, name: document.name.slice(0, 120), code: document.code, options, databases, exampleId: typeof document.exampleId === 'string' ? document.exampleId : null, revision: 0 };
    });
    return documents.length ? { documents, activeId: documents.some(document => document.id === saved.activeId) ? saved.activeId : documents[0].id } : null;
  } catch { return null; }
}

export function requestFor(document, operation) {
  const request = { code: document.code, operation, dialect: document.options.dialect, compilation: document.options.compilation, simulator: document.options.simulator };
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
  if (request.timeoutSeconds < 1 || request.timeoutSeconds > 120) throw new Error('The time limit must be between 1 and 120 seconds.');
  if (request.initial !== undefined && request.final !== undefined && request.final <= request.initial) throw new Error('Final time must be greater than initial time.');
  for (const key of ['toeholds', 'specificities']) if (document.databases[key]) request[key] = document.databases[key].code;
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
  const header = [timeUnit ? `Time (${timeUnit})` : 'Time', ...run.series.map(series => series.name)].map(value => quote(value, true)).join(',');
  const rows = run.times.map((time, index) => [time, ...run.series.map(series => series.values[index])].map(value => quote(value)).join(','));
  return [header, ...rows].join('\r\n') + '\r\n';
}

export function numberLabel(value) {
  if (!Number.isFinite(Number(value))) return String(value);
  const number = Number(value);
  return number === 0 ? '0' : Math.abs(number) >= 100000 || Math.abs(number) < .001 ? number.toExponential(3).replace(/\.?0+e/, 'e') : Number(number.toPrecision(6)).toString();
}

export function reactionLabel(reaction, species) {
  const names = new Map(species.map(item => [item.id, item.name || item.id]));
  const side = participants => participants.map(participant => `${participant.multiplicity === 1 ? '' : `${participant.multiplicity} `}${names.get(participant.speciesId) || participant.speciesId}`).join(' + ') || '∅';
  return { equation: `${side(reaction.reactants)} ${reaction.reverseRate ? '⇌' : '→'} ${side(reaction.products)}`, catalysts: reaction.catalysts.length ? side(reaction.catalysts) : '' };
}
