import { MAX_CODE_BYTES, MAX_DOCUMENTS, STORAGE_KEY, optionDefaults, byteLength, createDocument, restoreWorkspace, requestFor, highlightSource, positionAt, csvFor, numberLabel, reactionLabel, modelForRun } from './model.js';
import { SimulationChart } from './chart.js';
import { ReactionNetwork } from './network.js';
import { MAX_PROJECT_BYTES, parseProject, serialiseProject, resultIsCurrent } from './project.js';
import { readDatasets } from './observations.js';
import { drawSpatial, spatialCsv, statesCsv, stateSummary, shortestPath } from './exploration.js';

const $ = id => document.getElementById(id);
const editor = $('editor');
const chart = new SimulationChart($('chart'), $('legend'), $('chart-tooltip'));
const network = new ReactionNetwork($('network'), $('network-details'), $('network-caption'));
const views = new Map();
let documents = [], activeId, activeJob = null, examples = [], persistTimer, toastTimer, canPersist = true, engineVersion = 'unknown', importTarget = null;
const current = () => documents.find(model => model.id === activeId);
const stateFor = id => { if (!views.has(id)) views.set(id, { response: null, revision: -1, diagnostics: [], tab: 'plot', runIndex: 0, speciesPage: 0, reactionPage: 0, dataPage: 0, search: '', status: 'Ready when you are.' }); return views.get(id); };
const state = () => stateFor(activeId);
const selectedModel = () => modelForRun(state().response.model, state().runIndex);

function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
function connection(online) { $('connection').classList.toggle('offline', !online); $('connection').replaceChildren(element('span', 'status-dot'), document.createTextNode(online ? 'Local · connected' : 'Service unavailable')); }
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
function saveModel() { download(current().name || 'Untitled.dsd', current().code); persist(); toast('Model download started.'); }
function saveProject() {
  if (activeJob) return toast('Wait for the calculation to finish before saving the project.');
  try { download(`${stem()}.dsdproj.json`, serialiseProject(documents, activeId, views, engineVersion), 'application/json'); toast('Project download started, including saved results.'); }
  catch (error) { toast(error.message); }
}
async function openProject(file) {
  if (!file) return;
  try {
    if (activeJob) throw new Error('Stop the running calculation before opening a project.');
    if (file.size > MAX_PROJECT_BYTES) throw new Error('Project files must be no larger than 16 MiB.');
    const imported = parseProject(await file.text());
    if (activeJob) throw new Error('Stop the running calculation before opening a project.');
    if (!confirm('Replace the open workspace with this project? Save your current project first if you want to keep it.')) return;
    clearTimeout(persistTimer); documents = imported.documents; activeId = imported.activeId; views.clear();
    for (const [id, restored] of imported.views) Object.assign(stateFor(id), restored, { status: `Restored result · engine ${restored.snapshot.engineVersion}` });
    selectDocument(activeId); toast('Project opened. Saved results have been restored.');
  } catch (error) { toast(error.message); }
  finally { $('project-input').value = ''; }
}

async function api(path, options = {}) {
  let response;
  try { response = await fetch(path, { ...options, signal: AbortSignal.timeout(10000), headers: { ...options.headers, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } }); }
  catch { connection(false); throw new Error('The local service is unavailable. Keep this page open and restart Visual DSD.'); }
  connection(true);
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
  renderDatasets();
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
  const loaded = documents.find(model => model.exampleId === id);
  if (loaded) return selectDocument(loaded.id);
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
  const lines = new Set(state().diagnostics.map(diagnostic => diagnostic.line));
  for (const [index, line] of Array.from($('line-numbers').children).entries()) line.classList.toggle('error-line', lines.has(index + 1));
  for (const diagnostic of state().diagnostics) {
    const button = element('button'); button.type = 'button';
    button.append(element('strong', '', diagnostic.line ? `Line ${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ''} · ` : ''), document.createTextNode(diagnostic.message));
    button.addEventListener('click', () => focusDiagnostic(diagnostic)); box.append(button);
  }
}
function showError(error) { state().diagnostics = [{ code: 'WORKSPACE_ERROR', message: error.message }]; renderDiagnostics(); renderEditor(); }

function renderDatasets() {
  $('dataset-list').replaceChildren(...(current().data || []).map((dataset, index) => {
    const row = element('div', 'dataset-row'), input = element('input'); input.value = dataset.name; input.maxLength = 120; input.setAttribute('aria-label', `Dataset ${index + 1} name`);
    input.addEventListener('input', () => {
      try {
        const data = structuredClone(current().data); data[index].name = input.value.trim(); current().data = readDatasets(data); input.setCustomValidity('');
        append.setAttribute('aria-label', `Add table to ${data[index].name}`); remove.setAttribute('aria-label', `Remove dataset ${data[index].name}`); changed();
      } catch (error) { input.setCustomValidity(error.message); }
    });
    input.addEventListener('blur', () => { if (!input.validity.valid) toast(input.validationMessage); input.value = current().data[index].name; input.setCustomValidity(''); });
    const count = dataset.tables.reduce((sum, table) => sum + table.times.length * table.series.length, 0);
    const remove = element('button', 'text-button', 'Remove'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove dataset ${dataset.name}`);
    remove.addEventListener('click', () => { current().data.splice(index, 1); changed(); renderDatasets(); });
    const append = element('button', 'text-button', 'Add table'); append.type = 'button'; append.setAttribute('aria-label', `Add table to ${dataset.name}`);
    append.addEventListener('click', () => { importTarget = { documentId: activeId, datasetName: current().data[index].name }; $('data-input').click(); });
    row.append(input, element('small', '', `${dataset.tables.length} tables · ${count} measurements`), append, remove);
    const group = element('div'); group.append(row);
    if (dataset.tables.length > 1) dataset.tables.forEach((table, tableIndex) => {
      const entry = element('div', 'dataset-row'), up = element('button', 'text-button', '↑'), removeTable = element('button', 'text-button', 'Remove'); up.type = removeTable.type = 'button';
      up.disabled = tableIndex === 0; up.setAttribute('aria-label', `Move ${dataset.name} table ${tableIndex + 1} up`); removeTable.setAttribute('aria-label', `Remove ${dataset.name} table ${tableIndex + 1}`);
      up.addEventListener('click', () => { const tables = current().data[index].tables; [tables[tableIndex - 1], tables[tableIndex]] = [tables[tableIndex], tables[tableIndex - 1]]; changed(); renderDatasets(); });
      removeTable.addEventListener('click', () => { current().data[index].tables.splice(tableIndex, 1); changed(); renderDatasets(); });
      entry.append(element('small', '', `Table ${tableIndex + 1}: ${table.times.length} rows · ${table.series.map(column => column.name).join(', ')}`), up, removeTable); group.append(entry);
    });
    return group;
  }));
}

async function importData(files, target) {
  const model = target ? documents.find(document => document.id === target.documentId) : current();
  if (!model) return;
  try {
    for (const file of files) {
      if (file.size > 512 * 1024) throw new Error('Observation CSV exceeds 512 KiB.');
      const dataset = await api('/api/data/parse', { method: 'POST', body: JSON.stringify({ name: file.name.replace(/\.csv$/i, ''), csv: await file.text() }) });
      if (!documents.includes(model)) return;
      if (target && !model.data.some(item => item.name === target.datasetName)) throw new Error('The target dataset is no longer open.');
      model.data = readDatasets(target ? model.data.map(item => item.name === target.datasetName ? { ...item, tables: [...item.tables, ...dataset.tables] } : item) : [...(model.data || []), dataset]); model.revision++;
      if (current() === model) { renderDatasets(); updateStamp(); } persist();
    }
  } catch (error) { toast(error.message); }
  finally { $('data-input').value = ''; }
}

function updateBusy() {
  const busy = Boolean(activeJob); document.body.classList.toggle('busy', busy);
  for (const id of ['check', 'expand', 'simulate', 'infer', 'analyze', 'empty-simulate']) $(id).disabled = busy;
  $('cancel').hidden = !busy; $('cancel').disabled = !activeJob?.id || activeJob.cancelling;
  $('save-project').disabled = busy; $('open-project').disabled = busy;
  $('run-state').textContent = busy && activeJob.documentId === activeId ? activeJob.message : busy ? `Running ${documents.find(model => model.id === activeJob.documentId)?.name || 'another model'}…` : state().status;
}
async function run(operation) {
  if (activeJob) return;
  const model = current(), documentId = model.id, revision = model.revision;
  let request;
  try {
    for (const key of ['initial', 'final', 'points', 'seed', 'timeoutSeconds']) if ($(key).validity.badInput) throw new Error(`${key}: enter a valid number.`);
    for (const input of $('dataset-list').querySelectorAll('input')) if (!input.validity.valid) throw new Error(input.validationMessage);
    request = requestFor(model, operation);
  }
  catch (error) { showError(error); return; }
  state().diagnostics = []; renderDiagnostics(); renderEditor();
  const message = operation === 'analyze' ? 'Exploring reachable states…' : operation === 'infer' ? 'Fitting parameters…' : operation === 'simulate' ? 'Simulating…' : operation === 'expand' ? 'Expanding reaction network…' : 'Checking source…';
  activeJob = { id: null, documentId, revision, operation, request, engineVersion, name: model.name, message, started: performance.now(), cancelling: false };
  const task = activeJob; updateBusy();
  try {
    const admitted = await api('/api/jobs', { method: 'POST', body: JSON.stringify(request) }); task.id = admitted.id; updateBusy();
    let failures = 0;
    while (activeJob === task) {
      let job;
      try { job = await api(`/api/jobs/${task.id}`); failures = 0; }
      catch (error) { if (++failures > 5) { fetch(`/api/jobs/${task.id}`, { method: 'DELETE' }).catch(() => {}); throw error; } task.message = 'Reconnecting to the local service…'; updateBusy(); await new Promise(resolve => setTimeout(resolve, 1500)); continue; }
      if (job.finishedAt) { finishJob(job, task); break; }
      task.message = task.cancelling ? 'Stopping…' : job.state === 'queued' ? 'Waiting for a calculation slot…' : message; updateBusy();
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
    view.response = job.result; view.snapshot = { name: task.name, request: task.request, engineVersion: task.engineVersion }; view.revision = task.revision; view.runIndex = 0; view.speciesPage = view.reactionPage = view.dataPage = 0;
    view.spatialFrame = view.spatialSeries = view.stateIndex = 0;
    view.tab = task.operation === 'analyze' ? 'states' : job.result.model.simulations[0]?.spatial ? 'spatial' : task.operation === 'infer' ? 'fit' : task.operation === 'simulate' ? 'plot' : 'species';
    view.status = `${task.operation === 'analyze' ? 'State exploration complete' : task.operation === 'infer' ? 'Parameter fit complete' : task.operation === 'parse' ? 'Source checked' : task.operation === 'expand' ? 'Network expanded' : 'Simulation complete'} · ${elapsed} s`;
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
  const fresh = !response || resultIsCurrent(current(), view.snapshot);
  $('stale').hidden = fresh;
  $('export-json').disabled = !response;
  if (!response) return;
  const model = selectedModel();
  $('result-summary').textContent = `${model.species.length} species · ${model.reactions.length} reactions`;
  $('result-note').textContent = `${response.operation === 'parse' ? 'Initial species' : model.isJit ? 'Species generated in the selected run' : 'Expanded network'} · ${model.compilation} semantics${fresh ? '' : ' · earlier source'} · engine ${view.snapshot?.engineVersion || 'unknown'}`;
}
function renderResults() {
  const view = state(), response = view.response;
  $('tab-fit').hidden = !response?.model.inference;
  if (view.tab === 'fit' && !response?.model.inference) view.tab = 'plot';
  $('tab-spatial').hidden = !selectedRun()?.spatial; $('tab-states').hidden = !selectedRun()?.stateSpace;
  if ((view.tab === 'spatial' && $('tab-spatial').hidden) || (view.tab === 'states' && $('tab-states').hidden)) view.tab = 'plot';
  renderDiagnostics(); updateStamp(); selectTab(view.tab);
  $('empty-state').hidden = Boolean(response); $('results-content').hidden = !response;
  if (!response) { $('result-summary').textContent = 'No run yet'; $('species-count').textContent = '0'; $('reaction-count').textContent = '0'; $('result-note').textContent = 'Results will appear here after you run a model.'; return; }
  const model = selectedModel();
  $('species-count').textContent = model.species.length; $('reaction-count').textContent = model.reactions.length;
  renderRuns(); renderSpecies(); renderReactions(); renderData(); renderNetwork(); renderFit(); renderExploration();
}
function renderNetwork() {
  const view = state(), model = selectedModel();
  if (!model.species.some(item => item.id === view.networkFocus)) view.networkFocus = '';
  $('network-focus').replaceChildren(element('option', '', 'Full network'), ...model.species.map(item => { const option = element('option', '', `${item.id} · ${item.structure || item.name}`); option.value = item.id; return option; }));
  $('network-focus').firstElementChild.value = ''; $('network-focus').value = view.networkFocus;
  try { network.render(model, view.networkFocus); $('network-export').disabled = false; }
  catch (error) { $('network-caption').textContent = error.message; $('network').replaceChildren(); $('network-export').disabled = true; }
}
function selectedRun() { return state().response?.model.simulations[state().runIndex]; }
function renderRuns() {
  const model = selectedModel(), runs = model.simulations, select = $('run-select');
  select.replaceChildren(...runs.map((run, index) => { const option = element('option', '', [run.name, run.sweep, run.assignment].filter(value => value && value !== '[]').join(' · ') || `Run ${index + 1}`); option.value = index; return option; }));
  select.value = state().runIndex; select.hidden = runs.length < 2;
  $('run-toolbar').hidden = runs.length < 2;
  const run = selectedRun(), hasData = Boolean(run?.times.length);
  $('plot-empty').hidden = hasData; $('chart-container').hidden = !hasData; $('legend').hidden = !hasData;
  for (const id of ['export-csv', 'data-export-csv', 'export-svg']) $(id).disabled = !hasData;
  $('plot-heading').textContent = run?.spatial ? 'GRID MEAN CONCENTRATION OVER TIME' : model.settings.simulator === 'cme' ? 'MEAN POPULATION OVER TIME' : 'CONCENTRATION OVER TIME';
  $('plot-subtitle').textContent = model.inference ? 'Maximum-likelihood fit · circles: observations' : run ? [run.name, run.sweep, run.assignment].filter(value => value && value !== '[]').join(' · ') || `${run.series.length} species traces` : 'The source has been checked; simulation is a separate step.';
  if (hasData) chart.setRun(run, model.settings, model.inference?.observations[state().runIndex]);
  $('run-details').replaceChildren();
  if (hasData) {
    for (const [label, value] of [['Simulator', ({ oslo: 'Deterministic · Oslo', ssa: 'Stochastic · SSA', lna: 'Linear noise · LNA', cme: 'Master equation · CME', pde: 'Reaction diffusion · PDE' })[model.settings.simulator] || model.settings.simulator], ['Time range', `${numberLabel(run.times[0])} — ${numberLabel(run.times.at(-1))} ${model.settings.timeUnit}`], ['Samples', String(run.times.length)], ...(run.seed !== null && run.seed !== undefined ? [['Seed', run.seed]] : [])]) { const item = element('div', '', label); item.append(element('strong', '', value)); $('run-details').append(item); }
  }
}
function renderExploration() {
  const run = selectedRun(), view = state(), model = selectedModel();
  if (run?.spatial) {
    view.spatialSeries = Math.min(view.spatialSeries || 0, run.spatial.series.length - 1); view.spatialFrame = Math.min(view.spatialFrame || 0, run.times.length - 1);
    $('spatial-series').replaceChildren(...run.spatial.series.map((column, i) => { const species = model.species.find(item => item.id === column.name); const option = element('option', '', species?.structure ? `${column.name} · ${species.structure}` : column.name); option.value = i; return option; })); $('spatial-series').value = view.spatialSeries;
    $('spatial-time').max = run.times.length - 1; $('spatial-time').value = view.spatialFrame;
    $('spatial-time-label').textContent = `${numberLabel(run.times[view.spatialFrame])} ${model.settings.timeUnit}`;
    drawSpatial($('spatial-chart'), run, view.spatialSeries, view.spatialFrame, model.settings);
  }
  if (run?.stateSpace) {
    const graph = run.stateSpace, summary = stateSummary(graph), selected = Math.min(view.stateIndex || 0, graph.states.length - 1); view.stateIndex = selected;
    $('state-select').replaceChildren(...graph.states.map((_, index) => { const option = element('option', '', `State ${index}${index === graph.initialState ? ' · initial' : ''}${summary.absorbing.includes(index) ? ' · absorbing' : ''}`); option.value = index; return option; })); $('state-select').value = selected;
    $('state-summary').textContent = `${graph.states.length} reachable states · ${graph.transitions.length} transitions · ${summary.absorbing.length} absorbing states · complete enumeration`;
    const path = shortestPath(graph, selected);
    $('state-path').replaceChildren(element('span', 'muted', `Shortest path · ${path.length - 1} transitions:`), ...path.map(index => { const button = element('button', 'button secondary compact', String(index)); button.setAttribute('aria-label', `Visit state ${index}`); button.addEventListener('click', () => { view.stateIndex = index; renderExploration(); }); return button; }));
    const table = element('table'), header = element('tr'); for (const name of ['Species', 'Population', 'Reachable min', 'Reachable max']) header.append(element('th', '', name)); table.append(header);
    const names = new Map(model.species.map(species => [species.id, species.structure || species.name]));
    graph.speciesIds.forEach((id, index) => { const row = element('tr'); for (const value of [names.get(id) || id, graph.states[selected][index], summary.ranges[index].min, summary.ranges[index].max]) row.append(element('td', '', String(value))); table.append(row); }); $('state-populations').replaceChildren(table);
    const edges = graph.transitions.filter(edge => edge.source === selected);
    $('state-transitions').replaceChildren(...edges.slice(0, 50).map(edge => { const button = element('button', 'state-edge'); button.append(element('strong', '', `State ${edge.target} →`), element('small', '', `rate ${numberLabel(edge.rate)} per ${model.settings.timeUnit}`)); button.addEventListener('click', () => { view.stateIndex = edge.target; renderExploration(); }); return button; }));
    if (!edges.length) $('state-transitions').append(element('p', 'muted', 'Absorbing state · no outgoing state changes.'));
    if (edges.length > 50) $('state-transitions').append(element('p', 'muted', `Showing 50 of ${edges.length} outgoing transitions. Export JSON for the full graph.`));
  }
}
function svgImage(source) { const image = element('img'); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`; image.loading = 'lazy'; return image; }
function renderSpecies() {
  const view = state(), all = selectedModel().species;
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
    footer.append(element('span', '', `${species.valueKind === 'finalPopulation' ? 'Population at end' : species.valueKind === 'scheduledInput' ? 'Scheduled input' : 'Initial'}: ${species.initial}${species.constant ? ' · constant' : ''}${species.time ? ` · ${species.valueKind === 'scheduledInput' ? 'after' : 'at'} ${species.time}` : ''}`));
    if (species.svg) { const save = element('button', 'text-button', 'Save SVG'); save.type = 'button'; save.setAttribute('aria-label', `Save ${species.id} SVG`); save.addEventListener('click', () => download(`${stem()}-${species.id}.svg`, species.svg, 'image/svg+xml')); footer.append(save); }
    card.append(heading, drawing, structure, footer); return card;
  }));
}
function renderReactions() {
  const view = state(), model = selectedModel(), size = 30, start = view.reactionPage * size;
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
  const columns = run.series.flatMap(series => [{ name: series.name, values: series.values }, ...(series.standardDeviation ? [{ name: `${series.name} (StDev)`, values: series.standardDeviation }] : [])]);
  for (const name of [`Time (${selectedModel().settings.timeUnit})`, ...columns.map(series => series.name)]) { const cell = element('th', '', name); cell.scope = 'col'; cell.title = name; heading.append(cell); }
  header.append(heading);
  for (let index = start; index < Math.min(start + size, run.times.length); index++) { const row = element('tr'); for (const value of [run.times[index], ...columns.map(series => series.values[index])]) { const cell = element('td', '', numberLabel(value)); cell.title = String(value); row.append(cell); } body.append(row); }
  table.append(header, body); $('data-table').append(table);
}
function exportCsv() { const run = selectedRun(); if (run) download(`${stem()}-run-${state().runIndex + 1}.csv`, csvFor(run, selectedModel().settings.timeUnit), 'text/csv;charset=utf-8'); }

function renderFit() {
  const fit = state().response.model.inference;
  $('fit-table').replaceChildren(); $('fit-trace').replaceChildren();
  if (!fit) return;
  $('fit-summary').textContent = `${fit.dataPoints} measurements · seed ${fit.seed} · ${fit.burnIn} burn-in + ${fit.iterations} sampling iterations · thinning ${fit.thin} · ${fit.retainedSamples} retained samples · maximum log likelihood ${numberLabel(fit.maxLogLikelihood)}`;
  const table = element('table'), header = element('tr');
  for (const name of ['Parameter', 'Kind', 'Maximum likelihood', 'Posterior mean', 'Median', '95% lower', '95% upper']) header.append(element('th', '', name));
  table.append(header);
  for (const parameter of fit.parameters) { const row = element('tr'); for (const value of [parameter.name, parameter.kind, parameter.mle, parameter.mean, parameter.median, parameter.lower95, parameter.upper95]) { const cell = element('td', '', typeof value === 'number' ? numberLabel(value) : value); cell.title = String(value); row.append(cell); } table.append(row); }
  $('fit-table').append(table);
  const values = fit.logLikelihood, low = Math.min(...values), high = Math.max(...values), range = high - low || 1;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', values.map((value, index) => `${index ? 'L' : 'M'}${30 + index * 740 / Math.max(1, values.length - 1)} ${140 - (value - low) / range * 110}`).join('')); line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#158779'); line.setAttribute('stroke-width', '1.7');
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text'); label.setAttribute('x', '30'); label.setAttribute('y', '173'); label.textContent = 'Retained posterior log likelihood · sample order'; label.setAttribute('fill', '#677d6e'); label.setAttribute('font-size', '12'); $('fit-trace').append(line, label);
}

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
$('save-project').addEventListener('click', saveProject);
$('import-data').addEventListener('click', () => { importTarget = null; $('data-input').click(); });
$('data-input').addEventListener('change', event => { const target = importTarget; importTarget = null; importData(event.target.files, target); });
$('export-posterior').addEventListener('click', () => {
  const fit = state().response.model.inference;
  download(`${stem()}-posterior.csv`, csvFor({ times: fit.logLikelihood.map((_, i) => i + 1), series: [{ name: 'logLikelihood', values: fit.logLikelihood }, ...fit.parameters.map(parameter => ({ name: parameter.name, values: parameter.samples }))] }).replace(/^Time,/, 'Retained sample,'), 'text/csv;charset=utf-8');
});
$('open-project').addEventListener('click', () => $('project-input').click());
$('project-input').addEventListener('change', event => openProject(event.target.files[0]));
$('network-focus').addEventListener('change', () => { state().networkFocus = $('network-focus').value; renderNetwork(); });
$('network-in').addEventListener('click', () => network.zoom(1 / 1.3));
$('network-out').addEventListener('click', () => network.zoom(1.3));
$('network-fit').addEventListener('click', () => network.fit());
$('network-export').addEventListener('click', () => download(`${stem()}-network.svg`, network.exportSvg(), 'image/svg+xml'));
for (const [id, operation] of [['check', 'parse'], ['expand', 'expand'], ['simulate', 'simulate'], ['infer', 'infer'], ['analyze', 'analyze'], ['empty-simulate', 'simulate']]) $(id).addEventListener('click', () => run(operation));
$('cancel').addEventListener('click', cancelJob);
for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  tab.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const tabs = [...document.querySelectorAll('[data-tab]')].filter(button => !button.hidden).map(button => button.dataset.tab), index = tabs.indexOf(state().tab); selectTab(event.key === 'Home' ? 'plot' : event.key === 'End' ? tabs.at(-1) : tabs[(index + (event.key === 'ArrowLeft' ? tabs.length - 1 : 1)) % tabs.length], true); } });
}
$('run-select').addEventListener('change', () => { state().runIndex = Number($('run-select').value); state().dataPage = state().speciesPage = state().reactionPage = 0; state().networkFocus = ''; state().spatialFrame = state().spatialSeries = state().stateIndex = 0; renderResults(); });
$('spatial-series').addEventListener('change', () => { state().spatialSeries = Number($('spatial-series').value); renderExploration(); });
$('spatial-time').addEventListener('input', () => { state().spatialFrame = Number($('spatial-time').value); renderExploration(); });
$('spatial-csv').addEventListener('click', () => download(`${stem()}-grid.csv`, spatialCsv(selectedRun(), selectedModel().settings.timeUnit), 'text/csv;charset=utf-8'));
$('spatial-svg').addEventListener('click', () => download(`${stem()}-spatial.svg`, new XMLSerializer().serializeToString($('spatial-chart')), 'image/svg+xml'));
$('state-select').addEventListener('change', () => { state().stateIndex = Number($('state-select').value); renderExploration(); });
$('state-initial').addEventListener('click', () => { state().stateIndex = selectedRun().stateSpace.initialState; renderExploration(); });
$('state-csv').addEventListener('click', () => download(`${stem()}-states.csv`, statesCsv(selectedRun().stateSpace, selectedModel()), 'text/csv;charset=utf-8'));
$('species-search').addEventListener('input', () => { state().search = $('species-search').value; state().speciesPage = 0; renderSpecies(); });
for (const [kind, render] of [['species', renderSpecies], ['reaction', renderReactions], ['data', renderData]]) for (const direction of ['prev', 'next']) $(`${kind}-${direction}`).addEventListener('click', () => { state()[`${kind}Page`] += direction === 'prev' ? -1 : 1; render(); });
for (const id of ['export-csv', 'data-export-csv']) $(id).addEventListener('click', exportCsv);
$('export-svg').addEventListener('click', () => download(`${stem()}-simulation.svg`, chart.exportSvg(), 'image/svg+xml'));
$('export-json').addEventListener('click', () => download(`${stem()}-result.json`, JSON.stringify({ format: 'visual-dsd-result', version: 1, ...state().snapshot, result: state().response }, null, 2), 'application/json'));
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
  const initialDocumentId = activeId;
  try {
    const [info, library] = await Promise.all([api('/api/info'), api('/api/examples')]);
    engineVersion = info.version; examples = library; renderExamples(); connection(true); $('version').textContent = `Version ${info.version}`;
    $('document-description').textContent = examples.find(example => example.id === current().exampleId)?.description || 'Write a model, inspect its network, explore its dynamics.';
    if (!saved) { const example = await api('/api/examples/catalytic'); if (documents.length === 1 && current().id === initialDocumentId && current().revision === 0 && current().name === 'Untitled.dsd') { const model = createDocument('Catalytic.dsd', example.code, example.dialect, example.id); documents = [model]; selectDocument(model.id); } }
  } catch (error) { connection(false); toast(error.message); }
}
initialize().catch(error => toast(error.message));
