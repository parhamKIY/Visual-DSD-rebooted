import { MAX_CODE_BYTES, MAX_DOCUMENTS, STORAGE_KEY, optionDefaults, byteLength, createDocument, restoreWorkspace, requestFor, highlightSource, positionAt, csvFor, numberLabel, reactionLabel } from './model.js';
import { SimulationChart } from './chart.js';

const $ = id => document.getElementById(id);
const editor = $('editor');
const chart = new SimulationChart($('chart'), $('legend'), $('chart-tooltip'));
const views = new Map();
let documents = [], activeId, activeJob = null, examples = [], persistTimer, toastTimer, canPersist = true;
const current = () => documents.find(model => model.id === activeId);
const stateFor = id => { if (!views.has(id)) views.set(id, { response: null, revision: -1, diagnostics: [], tab: 'plot', runIndex: 0, speciesPage: 0, reactionPage: 0, dataPage: 0, search: '', status: 'Ready when you are.' }); return views.get(id); };
const state = () => stateFor(activeId);

function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
function persist() {
  clearTimeout(persistTimer);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, documents, activeId })); canPersist = true; }
  catch { if (canPersist) toast('Browser storage is unavailable. Use Save model to keep your work.'); canPersist = false; }
  $('save-status').textContent = canPersist ? 'Saved in browser' : 'Session only · save a file';
}
function changed() {
  const model = current(); model.revision++;
  state().diagnostics = [];
  renderDiagnostics(); updateStamp();
  $('save-status').textContent = 'Saving…';
  clearTimeout(persistTimer); persistTimer = setTimeout(persist, 300);
}
function download(name, text, type = 'text/plain;charset=utf-8') {
  const link = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type }));
  link.href = url; link.download = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_'); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function stem() { return current().name.replace(/\.[^.]+$/, '') || 'model'; }
function saveModel() { download(current().name || 'Untitled.dsd', current().code); persist(); toast('Model file saved.'); }

async function api(path, options = {}) {
  let response;
  try { response = await fetch(path, { ...options, signal: AbortSignal.timeout(10000), headers: { ...options.headers, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } }); }
  catch { throw new Error('The local service is unavailable. Keep this page open and restart Visual DSD.'); }
  if (!response.ok) {
    let body; try { body = await response.json(); } catch { /* Empty HTTP errors have no diagnostic body. */ }
    const message = body?.diagnostics?.map(error => error.message).join('\n');
    throw new Error(message || (response.status === 429 ? 'The model queue is full. Try again shortly.' : `The request could not be completed (${response.status}).`));
  }
  return response.json();
}

function renderDocuments() {
  $('documents').replaceChildren(...documents.map(model => {
    const row = element('div', `document-item${model.id === activeId ? ' active' : ''}`);
    const button = element('button'); button.type = 'button'; button.title = model.name; button.setAttribute('aria-current', model.id === activeId ? 'page' : 'false');
    button.append(element('span', 'file-icon', '▤'), element('span', 'document-name', model.name)); button.addEventListener('click', () => selectDocument(model.id));
    const close = element('button', 'close-document', '×'); close.type = 'button'; close.title = 'Close model'; close.setAttribute('aria-label', `Close ${model.name}`); close.addEventListener('click', () => closeDocument(model.id));
    row.append(button, close); return row;
  }));
}
function renderExamples() {
  $('example-count').textContent = String(examples.length);
  $('examples').replaceChildren(...examples.map(example => {
    const button = element('button', 'example-button'); button.type = 'button'; button.title = example.description;
    button.append(element('strong', '', example.name), element('small', '', example.dialect === 'legacy' ? 'Original syntax' : example.id === 'jit' ? 'Stochastic · just-in-time' : 'Visual DSD'));
    button.addEventListener('click', () => openExample(example.id).catch(showError)); return button;
  }));
}
function addDocument(model) {
  if (documents.length >= MAX_DOCUMENTS) throw new Error(`You have ${MAX_DOCUMENTS} models open. Save and close one before opening another.`);
  documents.push(model); selectDocument(model.id); return model;
}
function selectDocument(id) {
  activeId = id;
  const model = current();
  $('model-name').value = model.name; editor.value = model.code;
  for (const key of Object.keys(optionDefaults)) $(key).value = model.options[key];
  for (const key of ['toeholds', 'specificities']) { $(`${key}-name`).textContent = model.databases[key]?.name || 'Default database'; $(`${key}-file`).value = ''; }
  $('species-search').value = state().search;
  $('document-description').textContent = examples.find(example => example.id === model.exampleId)?.description || 'Write a model, inspect its network, explore its dynamics.';
  $('dialect-badge').textContent = model.options.dialect === 'legacy' ? 'Legacy syntax' : 'Visual DSD';
  renderDocuments(); renderEditor(); renderResults(); updateBusy(); persist();
  $('model-sidebar').classList.remove('mobile-open'); $('toggle-models').setAttribute('aria-expanded', 'false');
}
function closeDocument(id) {
  if (activeJob?.documentId === id) return toast('Stop the running model before closing it.');
  const model = documents.find(item => item.id === id);
  if (!confirm(`Close ${model.name}? Save the model file first if you want to keep it.`)) return;
  documents = documents.filter(item => item.id !== id); views.delete(id);
  if (!documents.length) documents.push(createDocument());
  selectDocument(activeId === id ? documents[0].id : activeId);
}
async function openExample(id) {
  const existing = documents.find(model => model.exampleId === id);
  if (existing) return selectDocument(existing.id);
  const example = await api(`/api/examples/${encodeURIComponent(id)}`);
  addDocument(createDocument(`${example.name.replace(' · legacy', '')}.${example.dialect === 'legacy' ? 'vdsd' : 'dsd'}`, example.code, example.dialect, id));
}
async function openFiles(files) {
  for (const file of files) {
    if (file.size > MAX_CODE_BYTES + 3) { toast(`${file.name} exceeds the 256 KiB model limit.`); continue; }
    try { addDocument(createDocument(file.name, await file.text(), /\.vdsd$/i.test(file.name) ? 'legacy' : 'auto')); }
    catch (error) { toast(error.message); }
  }
  $('file-input').value = '';
}

function renderEditor() {
  $('highlight').innerHTML = highlightSource(editor.value);
  const lines = editor.value.split('\n').length;
  const errorLines = new Set(state().diagnostics.filter(error => error.line).map(error => error.line));
  $('line-numbers').replaceChildren(...Array.from({ length: lines }, (_, index) => element('span', errorLines.has(index + 1) ? 'error-line' : '', String(index + 1))));
  $('line-count').textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  syncScroll(); cursorPosition();
}
function syncScroll() { $('highlight').scrollTop = editor.scrollTop; $('highlight').scrollLeft = editor.scrollLeft; $('line-numbers').scrollTop = editor.scrollTop; }
function cursorPosition() { const prefix = editor.value.slice(0, editor.selectionStart); $('cursor-position').textContent = `Ln ${prefix.split('\n').length}, Col ${prefix.length - prefix.lastIndexOf('\n')}`; }
function focusDiagnostic(diagnostic) {
  if (!diagnostic.line) return;
  const position = positionAt(editor.value, diagnostic.line, diagnostic.column);
  editor.focus(); editor.setSelectionRange(position, Math.min(position + 1, editor.value.length));
  editor.scrollTop = Math.max(0, (diagnostic.line - 4) * 23); syncScroll(); cursorPosition();
}
function renderDiagnostics() {
  const box = $('diagnostics'); box.replaceChildren(); box.hidden = !state().diagnostics.length;
  for (const diagnostic of state().diagnostics) {
    const button = element('button'); button.type = 'button';
    button.append(element('strong', '', diagnostic.line ? `Line ${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ''} · ` : ''), document.createTextNode(diagnostic.message));
    button.addEventListener('click', () => focusDiagnostic(diagnostic)); box.append(button);
  }
}
function showError(error) { state().diagnostics = [{ code: 'WORKSPACE_ERROR', message: error.message }]; renderDiagnostics(); renderEditor(); }

function updateBusy() {
  const busy = Boolean(activeJob); document.body.classList.toggle('busy', busy);
  for (const id of ['check', 'expand', 'simulate', 'empty-simulate']) $(id).disabled = busy;
  $('cancel').hidden = !busy; $('cancel').disabled = !activeJob?.id || activeJob.cancelling;
  $('run-state').textContent = busy && activeJob.documentId === activeId ? activeJob.message : busy ? `Running ${documents.find(model => model.id === activeJob.documentId)?.name || 'another model'}…` : state().status;
}
async function run(operation) {
  if (activeJob) return;
  const model = current(), documentId = model.id, revision = model.revision;
  let request;
  try { request = requestFor(model, operation); }
  catch (error) { showError(error); return; }
  state().diagnostics = []; renderDiagnostics(); renderEditor();
  activeJob = { id: null, documentId, revision, operation, message: operation === 'simulate' ? 'Simulating…' : operation === 'expand' ? 'Expanding reaction network…' : 'Checking source…', started: performance.now(), cancelling: false };
  const task = activeJob; updateBusy();
  try {
    const admitted = await api('/api/jobs', { method: 'POST', body: JSON.stringify(request) }); task.id = admitted.id; updateBusy();
    let failures = 0;
    while (activeJob === task) {
      let job;
      try { job = await api(`/api/jobs/${task.id}`); failures = 0; }
      catch (error) { if (++failures > 5) { fetch(`/api/jobs/${task.id}`, { method: 'DELETE' }).catch(() => {}); throw error; } task.message = 'Reconnecting to the local service…'; updateBusy(); await new Promise(resolve => setTimeout(resolve, 1500)); continue; }
      if (job.finishedAt) { finishJob(job, task); break; }
      task.message = task.cancelling ? 'Stopping…' : job.state === 'queued' ? 'Waiting for a calculation slot…' : operation === 'simulate' ? 'Simulating…' : operation === 'expand' ? 'Expanding reaction network…' : 'Checking source…'; updateBusy();
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  } catch (error) {
    const view = stateFor(documentId); view.diagnostics = [{ code: 'CONNECTION_ERROR', message: error.message }]; view.status = 'Calculation could not be completed.';
  } finally {
    if (activeJob === task) activeJob = null;
    if (activeId === documentId) { renderResults(); renderEditor(); }
    updateBusy();
  }
}
function finishJob(job, task) {
  const view = stateFor(task.documentId), elapsed = ((performance.now() - task.started) / 1000).toFixed(1);
  if (job.state === 'cancelled') { view.status = 'Calculation stopped.'; return; }
  view.diagnostics = job.result?.diagnostics || [{ code: 'WORKER_ERROR', message: 'The calculation ended without a result.' }];
  if (job.result?.success) {
    view.response = job.result; view.revision = task.revision; view.runIndex = 0; view.speciesPage = view.reactionPage = view.dataPage = 0;
    view.tab = task.operation === 'simulate' ? 'plot' : 'species';
    view.status = `${task.operation === 'parse' ? 'Source checked' : task.operation === 'expand' ? 'Network expanded' : 'Simulation complete'} · ${elapsed} s`;
  } else view.status = job.state === 'timedOut' ? 'Time limit reached. Adjust the model or time limit.' : 'The model needs attention.';
  const model = documents.find(item => item.id === task.documentId);
  if (model?.revision !== task.revision && !job.result?.success) view.diagnostics = view.diagnostics.map(diagnostic => ({ ...diagnostic, line: null, column: null, message: `Earlier source: ${diagnostic.message}` }));
}
async function cancelJob() {
  if (!activeJob?.id || activeJob.cancelling) return;
  const task = activeJob; task.cancelling = true; task.message = 'Stopping…'; updateBusy();
  try { await api(`/api/jobs/${task.id}`, { method: 'DELETE' }); }
  catch (error) { task.cancelling = false; toast(error.message); updateBusy(); }
}

function selectTab(tab, focus = false) {
  state().tab = tab;
  for (const button of document.querySelectorAll('[data-tab]')) { const selected = button.dataset.tab === tab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; if (selected && focus) button.focus(); }
  for (const panel of document.querySelectorAll('.result-panel')) panel.hidden = panel.id !== `panel-${tab}`;
}
function updateStamp() {
  const view = state(), response = view.response;
  $('stale').hidden = !response || current().revision === view.revision;
  $('export-json').disabled = !response;
  if (!response) return;
  const model = response.model;
  $('result-summary').textContent = `${model.species.length} species · ${model.reactions.length} reactions`;
  $('result-note').textContent = `${response.operation === 'parse' ? 'Initial species' : model.isJit ? 'Species generated during simulation' : 'Expanded network'} · ${model.compilation} semantics${current().revision === view.revision ? '' : ' · earlier source'}`;
}
function renderResults() {
  const view = state(), response = view.response;
  renderDiagnostics(); updateStamp(); selectTab(view.tab);
  $('empty-state').hidden = Boolean(response); $('results-content').hidden = !response;
  if (!response) { $('result-summary').textContent = 'No run yet'; $('species-count').textContent = '0'; $('reaction-count').textContent = '0'; $('result-note').textContent = 'Results will appear here after you run a model.'; return; }
  const model = response.model;
  $('species-count').textContent = model.species.length; $('reaction-count').textContent = model.reactions.length;
  renderRuns(); renderSpecies(); renderReactions(); renderData();
}
function selectedRun() { return state().response?.model.simulations[state().runIndex]; }
function renderRuns() {
  const model = state().response.model, runs = model.simulations, select = $('run-select');
  select.replaceChildren(...runs.map((run, index) => { const option = element('option', '', [run.name || `Run ${index + 1}`, run.sweep, run.assignment].filter(Boolean).join(' · ')); option.value = index; return option; }));
  select.value = state().runIndex; select.hidden = runs.length < 2;
  const run = selectedRun(), hasData = Boolean(run?.times.length);
  $('plot-empty').hidden = hasData; $('chart-container').hidden = !hasData; $('legend').hidden = !hasData;
  for (const id of ['export-csv', 'data-export-csv', 'export-svg']) $(id).disabled = !hasData;
  $('plot-subtitle').textContent = run ? [run.name, run.sweep, run.assignment].filter(Boolean).join(' · ') || `${run.series.length} species traces` : 'The source has been checked; simulation is a separate step.';
  if (hasData) chart.setRun(run, model.settings);
  $('run-details').replaceChildren();
  if (hasData) {
    for (const [label, value] of [['Simulator', model.settings.simulator === 'oslo' ? 'Deterministic · Oslo' : 'Stochastic · SSA'], ['Time range', `${numberLabel(run.times[0])} — ${numberLabel(run.times.at(-1))} ${model.settings.timeUnit}`], ['Samples', String(run.times.length)], ...(run.seed !== null && run.seed !== undefined ? [['Seed', run.seed]] : [])]) { const item = element('div', '', label); item.append(element('strong', '', value)); $('run-details').append(item); }
  }
}
function svgImage(source) { const image = element('img'); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`; image.loading = 'lazy'; return image; }
function renderSpecies() {
  const view = state(), all = view.response.model.species;
  const query = view.search.toLocaleLowerCase();
  const filtered = all.filter(species => [species.id, species.name, species.structure].some(value => value.toLocaleLowerCase().includes(query)));
  const size = 24; view.speciesPage = Math.max(0, Math.min(view.speciesPage, Math.ceil(filtered.length / size) - 1)); const start = view.speciesPage * size;
  $('species-page-label').textContent = filtered.length ? `${start + 1}–${Math.min(start + size, filtered.length)} of ${filtered.length}` : 'No matching species';
  $('species-prev').disabled = !view.speciesPage; $('species-next').disabled = start + size >= filtered.length;
  $('species-grid').replaceChildren(...filtered.slice(start, start + size).map(species => {
    const card = element('article', 'species-card'), heading = element('div', 'species-card-header'), drawing = element('div', 'species-drawing'), footer = element('div', 'species-card-footer');
    heading.append(element('strong', '', species.name || species.id), element('span', 'muted', species.id));
    if (species.svg) { const image = svgImage(species.svg); image.alt = species.structure || species.name; drawing.append(image); } else drawing.textContent = species.structure;
    const structure = element('div', 'species-structure', species.structure); structure.title = species.structure;
    footer.append(element('span', '', `Initial: ${species.initial}${species.constant ? ' · constant' : ''}${species.time ? ` · at ${species.time}` : ''}`));
    if (species.svg) { const save = element('button', 'text-button', 'Save SVG'); save.type = 'button'; save.setAttribute('aria-label', `Save ${species.id} SVG`); save.addEventListener('click', () => download(`${stem()}-${species.id}.svg`, species.svg, 'image/svg+xml')); footer.append(save); }
    card.append(heading, drawing, structure, footer); return card;
  }));
}
function renderReactions() {
  const view = state(), model = view.response.model, size = 30, start = view.reactionPage * size;
  $('reaction-page-label').textContent = model.reactions.length ? `${start + 1}–${Math.min(start + size, model.reactions.length)} of ${model.reactions.length}` : 'No reactions in this result';
  $('reaction-prev').disabled = !view.reactionPage; $('reaction-next').disabled = start + size >= model.reactions.length;
  $('reaction-list').replaceChildren(...model.reactions.slice(start, start + size).map((reaction, index) => {
    const card = element('article', 'reaction-card'), content = element('div'), label = reactionLabel(reaction, model.species);
    content.append(element('div', 'reaction-equation', label.equation), element('small', '', `${reaction.rate.kind === 'functional' ? 'Functional rate' : 'Rate'}: ${reaction.rate.expression}${reaction.reverseRate ? ` · reverse: ${reaction.reverseRate.expression}` : ''}`));
    if (label.catalysts) content.append(element('small', '', `Catalysts: ${label.catalysts}`)); card.append(element('span', 'reaction-index', `${start + index + 1}`), content); return card;
  }));
}
function renderData() {
  const run = selectedRun(), view = state(), size = 100, start = view.dataPage * size;
  $('data-table').replaceChildren(); $('data-prev').disabled = !view.dataPage; $('data-next').disabled = !run || start + size >= run.times.length;
  if (!run?.times.length) { $('data-page-label').textContent = 'Run a simulation to inspect its data.'; return; }
  $('data-page-label').textContent = `Rows ${start + 1}–${Math.min(start + size, run.times.length)} of ${run.times.length} · full precision in CSV`;
  const table = element('table'), header = element('thead'), heading = element('tr'), body = element('tbody');
  for (const name of [`Time (${view.response.model.settings.timeUnit})`, ...run.series.map(series => series.name)]) { const cell = element('th', '', name); cell.scope = 'col'; cell.title = name; heading.append(cell); }
  header.append(heading);
  for (let index = start; index < Math.min(start + size, run.times.length); index++) { const row = element('tr'); for (const value of [run.times[index], ...run.series.map(series => series.values[index])]) { const cell = element('td', '', numberLabel(value)); cell.title = String(value); row.append(cell); } body.append(row); }
  table.append(header, body); $('data-table').append(table);
}
function exportCsv() { const run = selectedRun(); if (run) download(`${stem()}-run-${state().runIndex + 1}.csv`, csvFor(run, state().response.model.settings.timeUnit), 'text/csv;charset=utf-8'); }

editor.addEventListener('input', () => { current().code = editor.value; changed(); renderEditor(); });
editor.addEventListener('scroll', syncScroll);
for (const event of ['click', 'keyup', 'select']) editor.addEventListener(event, cursorPosition);
editor.addEventListener('keydown', event => { if (event.key === 'Tab') { event.preventDefault(); editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end'); editor.dispatchEvent(new Event('input')); } });
$('model-name').addEventListener('input', () => { current().name = $('model-name').value || 'Untitled.dsd'; renderDocuments(); persist(); });
for (const key of Object.keys(optionDefaults)) $(key).addEventListener('input', () => { current().options[key] = $(key).value; $('dialect-badge').textContent = current().options.dialect === 'legacy' ? 'Legacy syntax' : 'Visual DSD'; changed(); });
for (const key of ['toeholds', 'specificities']) {
  $(`${key}-file`).addEventListener('change', async event => {
    const file = event.target.files[0], model = current(); if (!file) return;
    try { if (file.size > MAX_CODE_BYTES) throw new Error('Sequence databases must be no larger than 256 KiB.'); const code = await file.text(); if (byteLength(code) > MAX_CODE_BYTES) throw new Error('The sequence database exceeds 256 KiB.'); model.databases[key] = { name: file.name, code }; model.revision++; persist(); if (model.id === activeId) { $(`${key}-name`).textContent = file.name; updateStamp(); } }
    catch (error) { toast(error.message); }
    event.target.value = '';
  });
  $(`clear-${key}`).addEventListener('click', () => { delete current().databases[key]; $(`${key}-name`).textContent = 'Default database'; changed(); });
}
$('reset-settings').addEventListener('click', () => { current().options = { ...optionDefaults }; for (const key of Object.keys(optionDefaults)) $(key).value = optionDefaults[key]; $('dialect-badge').textContent = 'Visual DSD'; changed(); });
$('toggle-models').addEventListener('click', () => { const open = $('model-sidebar').classList.toggle('mobile-open'); $('toggle-models').setAttribute('aria-expanded', String(open)); });
$('new-model').addEventListener('click', () => { try { addDocument(createDocument()); editor.focus(); } catch (error) { toast(error.message); } });
$('open-model').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', event => openFiles(event.target.files));
$('save-model').addEventListener('click', saveModel);
for (const [id, operation] of [['check', 'parse'], ['expand', 'expand'], ['simulate', 'simulate'], ['empty-simulate', 'simulate']]) $(id).addEventListener('click', () => run(operation));
$('cancel').addEventListener('click', cancelJob);
for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  tab.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const tabs = ['plot', 'species', 'reactions', 'data'], index = tabs.indexOf(state().tab); selectTab(event.key === 'Home' ? 'plot' : event.key === 'End' ? 'data' : tabs[(index + (event.key === 'ArrowLeft' ? 3 : 1)) % 4], true); } });
}
$('run-select').addEventListener('change', () => { state().runIndex = Number($('run-select').value); state().dataPage = 0; renderRuns(); renderData(); });
$('species-search').addEventListener('input', () => { state().search = $('species-search').value; state().speciesPage = 0; renderSpecies(); });
for (const [kind, render] of [['species', renderSpecies], ['reaction', renderReactions], ['data', renderData]]) for (const direction of ['prev', 'next']) $(`${kind}-${direction}`).addEventListener('click', () => { state()[`${kind}Page`] += direction === 'prev' ? -1 : 1; render(); });
for (const id of ['export-csv', 'data-export-csv']) $(id).addEventListener('click', exportCsv);
$('export-svg').addEventListener('click', () => download(`${stem()}-simulation.svg`, chart.exportSvg(), 'image/svg+xml'));
$('export-json').addEventListener('click', () => download(`${stem()}-result.json`, JSON.stringify(state().response, null, 2), 'application/json'));
$('shortcuts').addEventListener('click', () => $('help-dialog').showModal());
$('close-help').addEventListener('click', () => $('help-dialog').close());
document.addEventListener('keydown', event => { if (!event.ctrlKey && !event.metaKey) return; if (event.key === 'Enter') { event.preventDefault(); run('simulate'); } else if (event.key.toLowerCase() === 's') { event.preventDefault(); saveModel(); } else if (event.key.toLowerCase() === 'o') { event.preventDefault(); $('file-input').click(); } });
window.addEventListener('pagehide', persist);
window.addEventListener('beforeunload', event => { persist(); if (!canPersist || activeJob) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
window.addEventListener('drop', event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); openFiles(event.dataTransfer.files); });

async function initialize() {
  let saved;
  try { saved = restoreWorkspace(localStorage.getItem(STORAGE_KEY)); } catch { canPersist = false; }
  if (saved) { documents = saved.documents; activeId = saved.activeId; }
  else { const model = createDocument(); documents = [model]; activeId = model.id; }
  selectDocument(activeId);
  try {
    const [info, library] = await Promise.all([api('/api/info'), api('/api/examples')]);
    examples = library; renderExamples(); $('connection').replaceChildren(element('span', 'status-dot'), document.createTextNode('Local · connected')); $('version').textContent = `Version ${info.version}`;
    if (!saved) { const example = await api('/api/examples/catalytic'); if (documents.length === 1 && current().revision === 0 && current().name === 'Untitled.dsd') { const model = createDocument('Catalytic.dsd', example.code, example.dialect, example.id); documents = [model]; selectDocument(model.id); } }
  } catch (error) { $('connection').classList.add('offline'); $('connection').replaceChildren(element('span', 'status-dot'), document.createTextNode('Service unavailable')); toast(error.message); }
}
initialize().catch(error => toast(error.message));
