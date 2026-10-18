import {watchJob,readJob,terminalJob,documentFromRequest,progressLabel} from './live-jobs.js';
import { dsdFields, databaseIssues, sequenceCsv, sequenceFasta, filterExamples } from './dsd-workspace.js';
import { exportSummary, populationSnapshotSvg } from './exports.js';
import { phaseSvg, dispersionSvg, jacobianSvg, synthesisCsv } from './synthesis.js';
import { MAX_CODE_BYTES, MAX_DOCUMENTS, STORAGE_KEY, optionDefaults, byteLength, createDocument, restoreWorkspace, requestFor, highlightSource, positionAt, csvFor, numberLabel, reactionLabel, modelForRun, modelForNode, populationLabel } from './model.js';
import { SimulationChart } from './chart.js';
import { ReactionNetwork } from './network.js';
import { MAX_PROJECT_BYTES, parseProject, serialiseProject, resultIsCurrent } from './project.js';
import { readDatasets } from './observations.js';
import { drawSpatial, spatialCsv, statesCsv, stateSummary, shortestPath } from './exploration.js';

import { drawProbabilities, probabilityCsv } from './probabilities.js';

import { programSvg, locationLabel } from './program.js';
import { drawTrace, drawMarginal, drawPair, posteriorCsv } from './posterior.js';

const $ = id => document.getElementById(id);
for(const field of dsdFields){
  const label=document.createElement('label');label.textContent=field.label;
  let input;
  if(field.kind==='bool'||field.kind==='string'){
    input=document.createElement('select');
    for(const [value,text]of [['','From source'],...(field.kind==='bool'?[['true','On'],['false','Off']]:field.choices.map(value=>[value,value]))]){const option=document.createElement('option');option.value=value;option.textContent=text;input.append(option);}
  }else{input=document.createElement('input');input.type='number';input.step=field.kind==='int'?'1':'any';input.placeholder='From source';}
  input.id=field.id;label.append(input);$('dsd-option-controls').append(label);
}
const editor = $('editor');
const chart = new SimulationChart($('chart'), $('legend'), $('chart-tooltip'));
const network = new ReactionNetwork($('network'), $('network-details'), $('network-caption'));
const views = new Map();
let exportImageUrl, sequenceDefaults;
const liveChart=new SimulationChart($('live-chart'),$('live-legend'),$('live-tooltip'));
const pendingKey=STORAGE_KEY+'.pending-job';
let documents = [], activeId, activeJob = null, examples = [], persistTimer, toastTimer, canPersist = true, engineVersion = 'unknown', importTarget = null;
const current = () => documents.find(model => model.id === activeId);
const stateFor = id => { if (!views.has(id)) views.set(id, { response: null, revision: -1, diagnostics: [], tab: 'plot', runIndex: 0, speciesPage: 0, reactionPage: 0, dataPage: 0, search: '', status: 'Ready when you are.' }); return views.get(id); };
const state = () => stateFor(activeId);
const fittedModel = () => state().response ? modelForNode(state().response.model,state().fitNodeId) : null;
const selectedModel = () => modelForRun(fittedModel(), state().runIndex);

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
  const filtered=filterExamples(examples,$('example-search').value,$('example-category').value);
  $('example-count').textContent=filtered.length===examples.length?String(examples.length):`${filtered.length} / ${examples.length}`;
  $('examples').replaceChildren(...filtered.map(example => {
    const button = element('button', 'example-button'); button.type = 'button'; button.title = example.description;
    button.append(element('strong', '', example.name), element('small', '', example.category?.startsWith('Original')?example.category:example.language === 'crn' ? 'Chemical reaction network' : example.dialect === 'legacy' ? 'Original syntax' : example.id === 'jit' ? 'Stochastic · just-in-time' : 'Visual DSD'));
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
  renderProgramSelection();
  for (const key of Object.keys(optionDefaults)) $(key).value = model.options[key];
  renderDatabases();
  renderDatasets();
  $('species-search').value = state().search;
  $('document-description').textContent = examples.find(example => example.id === model.exampleId)?.description || 'Write a model, inspect its network, explore its dynamics.';
  renderLanguage();
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
  const document=createDocument(`${example.name.replace(' · legacy', '')}.${example.language === 'crn' ? 'crn' : example.dialect === 'legacy' ? 'vdsd' : 'dsd'}`, example.code, example.dialect, id);
  document.data=readDatasets(example.data??[]);addDocument(document);
}
async function openFiles(files) {
  for (const file of files) {
    if (file.size > MAX_CODE_BYTES + 3) { toast(`${file.name} exceeds the 256 KiB model limit.`); continue; }
    try { addDocument(createDocument(file.name, await file.text(), /\.vdsd$/i.test(file.name) ? 'legacy' : 'auto')); }
    catch (error) { toast(error.message); }
  }
  $('file-input').value = '';
}

function renderLanguage() {
  const crn = current().options.language === 'crn';
  $('dialect-badge').textContent = crn ? 'CRN' : current().options.dialect === 'legacy' ? 'Legacy syntax' : 'Visual DSD';
  $('program-selection').hidden = !crn; $('edit-crn').hidden = crn;
  $('dialect').disabled = $('compilation').disabled = crn;
  document.querySelector('.sequence-settings').hidden = crn; document.querySelector('.dsd-settings').hidden=crn;
}
function renderProgramSelection() {
  const options = current().options, program = state().response?.model.program;
  const fill = (id, entries, value) => {
    const automatic = element('option', '', 'Automatic'); automatic.value = '';
    $(id).replaceChildren(automatic, ...entries.map(([id, label]) => { const option = element('option', '', label); option.value = id; return option; }));
    if (value && ![...$(id).options].some(option => option.value === value)) { const missing = element('option', '', `${value} · check source`); missing.value = value; $(id).append(missing); }
    $(id).value = value;
  };
  fill('nodeId', (program?.nodes || []).filter(node => node.id).map(node => [node.id, node.id]), options.nodeId);
  const node = program?.nodes.find(node => node.id === (options.nodeId || program.selectedNodeId));
  fill('systemId', (node?.systems || []).map(system => [system.id || '$top', system.id || 'Top-level network']), options.systemId);
  renderLanguage();
}
function renderProgram() {
  const program = state().response?.model.program;
  if (!program) return;
  $('program-summary').textContent = `${program.nodes.length} model node(s) · ${program.edges.length} parameter link(s) · selected: ${locationLabel({ nodeId: program.selectedNodeId, systemId: program.selectedSystemId })}`;
  $('program-graph').innerHTML = programSvg(program);
  $('program-systems').replaceChildren(...program.nodes.flatMap(node => node.systems.map(system => {
    const button = element('button', 'program-system'); button.type = 'button'; button.disabled = Boolean(activeJob);
    button.setAttribute('aria-current', String(node.id === program.selectedNodeId && system.id === program.selectedSystemId));
    button.append(element('span', '', locationLabel({ nodeId: node.id, systemId: system.id })), element('small', '', `${system.speciesCount} species · ${system.reactionCount} reactions`));
    button.addEventListener('click', () => { current().options.nodeId = node.id; current().options.systemId = system.id || '$top'; changed(); renderProgramSelection(); run('parse'); });
    return button;
  })));
  const table = element('table'), head = element('tr');
  for (const name of ['From', 'To', 'Parameter', 'Prior']) head.append(element('th', '', name)); table.append(head);
  for (const edge of program.edges) for (const parameter of edge.parameters) {
    const row = element('tr'); for (const value of [locationLabel(edge.source), locationLabel(edge.target), `${parameter.sourceParameter} → ${parameter.targetParameter}`, parameter.kind]) row.append(element('td', '', value)); table.append(row);
  }
  $('program-links').replaceChildren(program.edges.length ? table : element('p', 'exploration-note', 'No inference links. Systems can be simulated independently.'));
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
  renderLive();
  const busy = Boolean(activeJob); document.body.classList.toggle('busy', busy);
  for (const id of ['check', 'expand', 'simulate', 'infer', 'analyze', 'synthesize', 'scientific-export', 'empty-simulate', 'nodeId', 'systemId', 'language']) $(id).disabled = busy;
  $('cancel').hidden = !busy; $('cancel').disabled = !activeJob?.id || activeJob.cancelling;
  $('edit-crn').disabled = busy || current().options.language === 'crn' || !state().response?.model.crnCode || !resultIsCurrent(current(), state().snapshot);
  for (const button of document.querySelectorAll('.program-system')) button.disabled = busy;
  $('save-project').disabled = busy; $('open-project').disabled = busy;
  $('run-state').textContent = busy && activeJob.documentId === activeId ? activeJob.message : busy ? `Running ${documents.find(model => model.id === activeJob.documentId)?.name || 'another model'}…` : state().status;
}
async function run(operation) {
  if (activeJob) return;
  const model = current(), documentId = model.id, revision = model.revision;
  let request;
  try {
    for (const key of ['initial', 'final', 'points', 'seed', 'timeoutSeconds',...(model.options.language==='crn'?[]:dsdFields.filter(f=>f.kind==='int'||f.kind==='double').map(f=>f.id))]) if ($(key).validity.badInput) throw new Error(`${key}: enter a valid number.`);
    for (const input of $('dataset-list').querySelectorAll('input')) if (!input.validity.valid) throw new Error(input.validationMessage);
    request = requestFor(model, operation);
  }
  catch (error) { showError(error); return; }
  state().diagnostics = [];state().live=null; renderDiagnostics(); renderEditor();
  const message = operation === 'export' ? 'Preparing scientific files…' : operation === 'synthesize' ? 'Synthesizing parameters…' : operation === 'analyze' ? 'Exploring reachable states…' : operation === 'infer' ? 'Fitting parameters…' : operation === 'simulate' ? 'Simulating…' : operation === 'expand' ? 'Expanding reaction network…' : 'Checking source…';
  activeJob = { id: null, documentId, revision, operation, request, engineVersion, name: model.name, message, started: performance.now(), cancelling: false };
  const task = activeJob; task.tab = state().tab; updateBusy();
  try {
    const admitted = await api('/api/jobs', { method: 'POST', body: JSON.stringify(request) }); task.id = admitted.id; updateBusy();
    persist();rememberJob(task);await monitorJob(task);
  } catch (error) {
    if(task.detached)return;
    const view = stateFor(documentId); view.diagnostics = [{ code: 'CONNECTION_ERROR', message: error.message }]; view.status = 'Monitoring stopped. Check Jobs to retrieve the calculation; it was not automatically cancelled.';
  } finally {
    if (activeJob === task) activeJob = null;
    if (activeId === documentId) { renderResults(); renderEditor(); }
    updateBusy();
  }
}
function finishJob(job, task) {
  const view = stateFor(task.documentId), elapsed = (job.startedAt&&job.finishedAt?(Date.parse(job.finishedAt)-Date.parse(job.startedAt))/1000:(performance.now()-task.started)/1000).toFixed(1);
  if(job.result?.success)view.live=null;
  if (job.state === 'cancelled') { view.status = 'Calculation stopped.'; return; }
  view.diagnostics = job.result?.diagnostics || [{ code: 'WORKER_ERROR', message: 'The calculation ended without a result.' }];
  if (job.result?.success) {
    view.response = job.result; view.snapshot = { name: task.name, request: task.request, engineVersion: task.engineVersion }; view.revision = task.revision; view.runIndex = 0; view.speciesPage = view.reactionPage = view.dataPage = 0;
    view.spatialFrame = view.spatialSeries = view.stateIndex = view.probabilitySpecies = view.probabilityFrame = 0; view.probabilityLog = false; view.fitNodeId = job.result.model.program?.selectedNodeId || ''; view.fitParameter = view.fitPair = '';
    view.tab = task.operation === 'export' ? 'exports' : task.operation === 'synthesize' ? 'synthesis' : task.operation === 'analyze' ? 'states' : job.result.model.simulations[0]?.spatial ? 'spatial' : task.operation === 'infer' ? 'fit' : task.operation === 'simulate' ? 'plot' : task.tab === 'program' && job.result.model.program ? 'program' : 'species';
    view.status = `${task.operation === 'export' ? 'Scientific files prepared' : task.operation === 'synthesize' ? 'Synthesis complete · '+job.result.model.synthesis.status : task.operation === 'analyze' ? 'State exploration complete' : task.operation === 'infer' ? 'Parameter fit complete' : task.operation === 'parse' ? 'Source checked' : task.operation === 'expand' ? 'Network expanded' : 'Simulation complete'} · ${elapsed} s`;
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
  $('edit-crn').disabled = Boolean(activeJob) || current().options.language === 'crn' || !response?.model.crnCode || !fresh;
  $('export-json').disabled = !response;
  if (!response) return;
  const model = selectedModel();
  const contributions = model.species.filter(species => species.sourceId).length;
  $('result-summary').textContent = `${model.species.length - contributions} species${contributions ? ` · ${contributions} input entries` : ''} · ${model.reactions.length} reactions`;
  const fitNodeId=view.fitNodeId??model.program?.selectedNodeId;
  const fitSystem=selectedRun()?.name.split(' · ')[0];
  const fitSystemId=model.program?.nodes.find(n=>n.id===fitNodeId)?.systems.some(s=>s.id===fitSystem)?fitSystem:(fitNodeId===model.program?.selectedNodeId?model.program.selectedSystemId:'');
  $('result-note').textContent = `${model.kind === 'crn' ? 'CRN · ' + locationLabel({ nodeId: fitNodeId, systemId: response.operation==='infer'?fitSystemId:model.program.selectedSystemId }) : response.operation === 'parse' ? 'Initial species' : model.isJit ? 'Species generated in the selected run' : 'Expanded network'} · ${model.kind === 'crn' ? 'chemical reaction network' : model.compilation + ' semantics'}${fresh ? '' : ' · earlier source'} · engine ${view.snapshot?.engineVersion || 'unknown'}`;
}
function renderResults() {
  const view = state(), response = view.response;
  renderProgramSelection(); renderProgram();
  $('tab-program').hidden = !response?.model.program;
  if (view.tab === 'program' && !response?.model.program) view.tab = 'plot';
  $('tab-dsd').hidden=!response?.model.dsd; if(view.tab==='dsd'&&!response?.model.dsd)view.tab='plot';
  $('tab-exports').hidden = !response?.model.exports;
  if(view.tab==='exports'&&!response?.model.exports)view.tab='plot';
  $('tab-synthesis').hidden = !response?.model.synthesis;
  if(view.tab==='synthesis'&&!response?.model.synthesis)view.tab='plot';
  $('tab-fit').hidden = !response?.model.inference;
  if (view.tab === 'fit' && !response?.model.inference) view.tab = 'plot';
  $('tab-probabilities').hidden = !selectedRun()?.probabilities;
  if (view.tab === 'probabilities' && $('tab-probabilities').hidden) view.tab = 'plot';
  $('tab-spatial').hidden = !selectedRun()?.spatial; $('tab-states').hidden = !selectedRun()?.stateSpace;
  if ((view.tab === 'spatial' && $('tab-spatial').hidden) || (view.tab === 'states' && $('tab-states').hidden)) view.tab = 'plot';
  renderDiagnostics(); updateStamp(); selectTab(view.tab);renderLive();
  $('empty-state').hidden = Boolean(response); $('results-content').hidden = !response;
  if (!response) { $('result-summary').textContent = 'No run yet'; $('species-count').textContent = '0'; $('reaction-count').textContent = '0'; $('result-note').textContent = 'Results will appear here after you run a model.'; return; }
  const model = selectedModel();
  $('species-count').textContent = model.species.filter(species => !species.sourceId).length; $('reaction-count').textContent = model.reactions.length;
  const nodes=response.model.inferenceNodes || [];
  $('fit-node-toolbar').hidden=!nodes.length;
  $('fit-node').replaceChildren(...nodes.map(n=>{const option=element('option','',n.nodeId||'Model');option.value=n.nodeId;return option;}));
  $('fit-node').value=state().fitNodeId ?? response.model.program?.selectedNodeId ?? '';
  renderRuns(); renderSpecies(); renderReactions(); renderData(); renderNetwork(); renderFit(); renderSynthesis(); renderExports(); renderDsdWorkspace(); renderExploration(); renderProbabilities();
}
function renderNetwork() {
  const view = state(), model = selectedModel();
  view.networkFocus = model.species.find(item => item.id === view.networkFocus)?.sourceId || view.networkFocus;
  if (!model.species.some(item => item.id === view.networkFocus)) view.networkFocus = '';
  $('network-focus').replaceChildren(element('option', '', 'Full network'), ...model.species.filter(item => !item.sourceId).map(item => { const option = element('option', '', `${item.id} · ${item.structure || item.name}`); option.value = item.id; return option; }));
  $('network-focus').firstElementChild.value = ''; $('network-focus').value = view.networkFocus;
  try { network.render(model, view.networkFocus); $('network-export').disabled = false; }
  catch (error) { $('network-caption').textContent = error.message; $('network').replaceChildren(); $('network-export').disabled = true; }
}
function selectedRun() { return fittedModel()?.simulations[state().runIndex]; }
function renderRuns() {
  const model = selectedModel(), runs = model.simulations, select = $('run-select');
  select.replaceChildren(...runs.map((run, index) => { const option = element('option', '', [run.name, run.sweep, run.assignment].filter(value => value && value !== '[]').join(' · ') || `Run ${index + 1}`); option.value = index; return option; }));
  select.value = state().runIndex; select.hidden = runs.length < 2;
  $('run-toolbar').hidden = runs.length < 2;
  const run = selectedRun(), hasData = Boolean(run?.times.length);
  $('plot-empty').hidden = hasData; $('chart-container').hidden = !hasData; $('legend').hidden = !hasData;
  for (const id of ['export-csv', 'data-export-csv', 'export-svg']) $(id).disabled = !hasData;
  $('plot-heading').textContent = run?.spatial ? 'GRID MEAN CONCENTRATION OVER TIME' : ['cme', 'cmesundials', 'lna', 'mc', 'ssa'].includes(model.settings.simulator) ? 'MEAN POPULATION OVER TIME' : 'CONCENTRATION OVER TIME';
  $('plot-subtitle').textContent = model.inference ? 'Maximum-likelihood fit · circles: observations' : run ? [run.name, run.sweep, run.assignment].filter(value => value && value !== '[]').join(' · ') || `${run.series.length} plotted traces` : 'The source has been checked; simulation is a separate step.';
  if (hasData) chart.setRun(run, model.settings, model.inference?.observations[state().runIndex]);
  $('run-details').replaceChildren();
  if (hasData) {
    for (const [label, value] of [['Simulator', ({ oslo: 'Deterministic · Oslo', ssa: 'Stochastic · SSA', lna: 'Linear noise · LNA', cme: 'Master equation · CME', pde: 'Reaction diffusion · PDE', sundials: 'Deterministic · Sundials', cmesundials: 'Master equation · Sundials', mc: 'Moment closure · MC' })[model.settings.simulator] || model.settings.simulator], ['Time range', `${numberLabel(run.times[0])} — ${numberLabel(run.times.at(-1))} ${model.settings.timeUnit}`], ['Samples', String(run.times.length)], ...(run.seed !== null && run.seed !== undefined ? [['Seed', run.seed]] : [])]) { const item = element('div', '', label); item.append(element('strong', '', value)); $('run-details').append(item); }
  }
}
function renderProbabilities() {
  const run = selectedRun(); if (!run?.probabilities) return;
  const view = state(), model = selectedModel(), data = run.probabilities;
  view.probabilitySpecies = Math.min(view.probabilitySpecies || 0, data.speciesIds.length - 1);
  view.probabilityFrame = Math.min(view.probabilityFrame || 0, run.times.length - 1);
  $('probability-species').replaceChildren(...data.speciesIds.map((id, i) => { const option = element('option', '', model.species.find(item => item.id === id)?.structure || id); option.value = i; return option; }));
  $('probability-species').value = view.probabilitySpecies; $('probability-log').checked = Boolean(view.probabilityLog);
  $('probability-time').max = run.times.length - 1; $('probability-time').value = view.probabilityFrame;
  $('probability-time-label').textContent = `${numberLabel(run.times[view.probabilityFrame])} ${model.settings.timeUnit}`;
  $('probability-summary').textContent = `${data.states.length} joint states · ${run.times.length} output times · maximum numerical mass residual ${numberLabel(data.maximumMassError)}`;
  drawProbabilities($('probability-chart'), run, view.probabilitySpecies, view.probabilityFrame, view.probabilityLog, model.settings.timeUnit);
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
  $('species-populations').hidden=!(selectedModel()?.isJit && selectedRun()?.network && selectedRun()?.times.length);
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
    footer.append(element('span', '', populationLabel(species)));
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
  const fit = fittedModel().inference;
  $('fit-table').replaceChildren(); $('fit-trace').replaceChildren();
  if (!fit) return;
  const chains=fit.chains || [],included=chains.filter(c=>c.included);
  $('fit-summary').textContent = `${fit.dataPoints} measurements · ${chains.length||1} chains (${included.length||1} pooled) · ${fit.burnIn} burn-in + ${fit.iterations} sampling iterations per chain · thinning ${fit.thin} · ${fit.retainedSamples} pooled draws · maximum log likelihood ${numberLabel(fit.maxLogLikelihood)}`;
  $('fit-chains').replaceChildren(...(chains.length?chains:[{seed:fit.seed,included:true}]).map((c,i)=>element('span','',`Chain ${i+1} · seed ${c.seed} · ${c.included?'included':'excluded by likelihood bound'}`)));
  const table = element('table'), header = element('tr');
  for (const name of ['Parameter', 'Kind', 'Maximum likelihood', 'Posterior mean', 'Median', '95% lower', '95% upper','Split R-hat']) header.append(element('th', '', name));
  table.append(header);
  for (const parameter of fit.parameters) { const row = element('tr'); for (const value of [parameter.name, parameter.kind, parameter.mle, parameter.mean, parameter.median, parameter.lower95, parameter.upper95,parameter.splitRHat??'Unavailable']) { const cell = element('td', '', typeof value === 'number' ? numberLabel(value) : value); cell.title = String(value); row.append(cell); } table.append(row); }
  $('fit-table').append(table);
  const view=state();
  if(!fit.parameters.some(p=>p.name===view.fitParameter))view.fitParameter=fit.parameters[0].name;
  if(!fit.parameters.some(p=>p.name===view.fitPair) || view.fitPair===view.fitParameter)view.fitPair=fit.parameters.find(p=>p.name!==view.fitParameter)?.name||'';
  for(const [id,value,items]of [['fit-parameter',view.fitParameter,fit.parameters],['fit-pair',view.fitPair,fit.parameters.filter(p=>p.name!==view.fitParameter)]]){
    $(id).replaceChildren(...items.map(p=>{const option=element('option','',p.name);option.value=p.name;return option;}));$(id).value=value;$(id).disabled=!items.length;
  }
  drawTrace($('fit-trace'),fit);drawTrace($('fit-parameter-trace'),fit,view.fitParameter);
  const parameter=fit.parameters.find(p=>p.name===view.fitParameter),pair=fit.parameters.find(p=>p.name===view.fitPair);
  drawMarginal($('fit-density'),parameter);drawPair($('fit-scatter'),parameter,pair);
  const priors=fit.priors || [];
  $('fit-priors').replaceChildren(...priors.map(p=>element('p','exploration-note',`${p.name}: ${p.distribution} · ${p.interval} · initial ${numberLabel(p.initial)} · ${p.variable?'variable':'fixed'}`)));
}

editor.addEventListener('input', () => { current().code = editor.value; changed(); renderEditor(); });
editor.addEventListener('scroll', syncScroll);
for (const event of ['click', 'keyup', 'select']) editor.addEventListener(event, cursorPosition);
editor.addEventListener('keydown', event => { if (event.key === 'Tab') { event.preventDefault(); editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end'); editor.dispatchEvent(new Event('input')); } });
$('model-name').addEventListener('input', () => { current().name = $('model-name').value || 'Untitled.dsd'; renderDocuments(); persist(); });
for (const key of Object.keys(optionDefaults)) $(key).addEventListener('input', () => {
  current().options[key] = $(key).value;
  if (key === 'language') { current().options.nodeId = current().options.systemId = ''; renderProgramSelection(); }
  if (key === 'nodeId') { current().options.systemId = ''; renderProgramSelection(); }
  renderLanguage(); changed();
});
function effectiveDatabase(key){return current().databases[key]?.code??sequenceDefaults?.[key];}
function databaseStatus(key){
  const value=$(`${key}-text`).value,result=databaseIssues(value,key);
  const cross=key==='specificities'?new Set(($('toeholds-text').value).split(/\r\n?|\n/).map(v=>v.trim()).filter(Boolean)):null;
  if(cross && value.split(/\r\n?|\n/).some(v=>cross.has(v.trim())&&v.trim()))result.issues.push('A sequence also occurs in the toehold database.');
  if(!result.count)result.issues.push('No sequences: domains may remain unassigned.');
  $(`${key}-stats`).textContent=`${result.count} sequences${result.issues.length?' · '+result.issues.slice(0,3).join(' ')+(result.issues.length>3?' …':''):''}`;
  $(`${key}-stats`).classList.toggle('has-issues',Boolean(result.issues.length));
}
function renderDatabases(){
  for(const key of ['toeholds','specificities']){
    const value=effectiveDatabase(key);$(`${key}-text`).value=value??'';$(`${key}-text`).disabled=value===undefined;$(`save-${key}`).disabled=value===undefined;
    $(`${key}-name`).textContent=current().databases[key]?.name||'Default database';$(`${key}-file`).value='';
  }
  databaseStatus('toeholds');databaseStatus('specificities');
}
function setDatabase(model,key,code,name){
  if(byteLength(code)>MAX_CODE_BYTES)throw new Error('Sequence databases must be no larger than 256 KiB.');
  model.databases[key]={name,code};model.revision++;persist();
  if(model.id===activeId){renderDatabases();updateStamp();}
}
for (const key of ['toeholds', 'specificities']) {
  $(`${key}-file`).addEventListener('change',async event=>{
    const file=event.target.files[0],model=current();if(!file)return;
    try{if(file.size>MAX_CODE_BYTES+3)throw new Error('Sequence databases must be no larger than 256 KiB.');setDatabase(model,key,await file.text(),file.name);}catch(error){toast(error.message);}finally{event.target.value='';}
  });
  $(`${key}-text`).addEventListener('input',()=>{
    const code=$(`${key}-text`).value;
    if(byteLength(code)>MAX_CODE_BYTES){$(`${key}-text`).value=effectiveDatabase(key)??'';toast('The sequence database exceeds 256 KiB.');return;}
    current().databases[key]={name:`Edited ${key}.txt`,code};$(`${key}-name`).textContent=`Edited ${key}.txt`;databaseStatus('toeholds');databaseStatus('specificities');changed();
  });
  $(`clear-${key}`).addEventListener('click',()=>{delete current().databases[key];renderDatabases();changed();});
  $(`save-${key}`).addEventListener('click',()=>{const code=effectiveDatabase(key);if(code!==undefined)download(`${key}.txt`,code);});
}
$('dsd-reset').addEventListener('click',()=>{for(const field of dsdFields){current().options[field.id]='';$(field.id).value='';}changed();});
$('example-search').addEventListener('input',renderExamples);$('example-category').addEventListener('change',renderExamples);
$('reset-settings').addEventListener('click', () => { current().options = { ...optionDefaults }; for (const key of Object.keys(optionDefaults)) $(key).value = optionDefaults[key]; renderProgramSelection(); renderLanguage(); changed(); });
$('toggle-models').addEventListener('click', () => { const open = $('model-sidebar').classList.toggle('mobile-open'); $('toggle-models').setAttribute('aria-expanded', String(open)); });
$('new-crn').addEventListener('click', () => { try { addDocument(createDocument('Untitled.crn', 'directive simulator deterministic\ndirective simulation {final=10;plots=[A;B]}\n| 10 A\n| A ->{0.25} B\n')); $('settings-panel').open = true; } catch (error) { toast(error.message); } });
$('edit-crn').addEventListener('click', () => { try { const model = state().response?.model; if (!model?.crnCode || !resultIsCurrent(current(), state().snapshot)) return; const draft = createDocument(`${stem()}.crn`, model.crnCode); draft.data = structuredClone(current().data); addDocument(draft); toast('Independent CRN opened. The strand model is kept separately.'); } catch (error) { toast(error.message); } });
$('program-svg').addEventListener('click', () => { const program = state().response?.model.program; if (program) download(`${stem()}-models.svg`, programSvg(program), 'image/svg+xml'); });
$('new-model').addEventListener('click', () => { try { addDocument(createDocument()); editor.focus(); } catch (error) { toast(error.message); } });
$('open-model').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', event => openFiles(event.target.files));
$('save-model').addEventListener('click', saveModel);
$('save-project').addEventListener('click', saveProject);
$('import-data').addEventListener('click', () => { importTarget = null; $('data-input').click(); });
$('data-input').addEventListener('change', event => { const target = importTarget; importTarget = null; importData(event.target.files, target); });
$('export-posterior').addEventListener('click', () => download(`${stem()}-posterior.csv`,posteriorCsv(fittedModel().inference),'text/csv;charset=utf-8'));
$('open-project').addEventListener('click', () => $('project-input').click());
$('project-input').addEventListener('change', event => openProject(event.target.files[0]));
$('network-focus').addEventListener('change', () => { state().networkFocus = $('network-focus').value; renderNetwork(); });
$('network-in').addEventListener('click', () => network.zoom(1 / 1.3));
$('network-out').addEventListener('click', () => network.zoom(1.3));
$('network-fit').addEventListener('click', () => network.fit());
$('network-export').addEventListener('click', () => download(`${stem()}-network.svg`, network.exportSvg(), 'image/svg+xml'));
for (const [id, operation] of [['scientific-export', 'export'], ['check', 'parse'], ['expand', 'expand'], ['simulate', 'simulate'], ['infer', 'infer'], ['synthesize', 'synthesize'], ['analyze', 'analyze'], ['empty-simulate', 'simulate']]) $(id).addEventListener('click', () => run(operation));
$('cancel').addEventListener('click', cancelJob);
for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  tab.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const tabs = [...document.querySelectorAll('[data-tab]')].filter(button => !button.hidden).map(button => button.dataset.tab), index = tabs.indexOf(state().tab); selectTab(event.key === 'Home' ? 'plot' : event.key === 'End' ? tabs.at(-1) : tabs[(index + (event.key === 'ArrowLeft' ? tabs.length - 1 : 1)) % tabs.length], true); } });
}
$('run-select').addEventListener('change', () => { state().runIndex = Number($('run-select').value); state().dataPage = state().speciesPage = state().reactionPage = 0; state().networkFocus = ''; state().spatialFrame = state().spatialSeries = state().stateIndex = state().probabilitySpecies = state().probabilityFrame = 0; renderResults(); });
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
window.addEventListener('beforeunload', event => { persist(); if (!canPersist) { event.preventDefault(); event.returnValue = ''; } });
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
    const [info, library, databases,execution] = await Promise.all([api('/api/info'), api('/api/examples'),api('/api/sequences/defaults'),api('/api/execution')]);
    $('execution-mode').textContent=execution.mode==='remote'?'Remote compute':'Local compute';
    sequenceDefaults=databases;renderDatabases();
    const categories=[...new Set(library.map(e=>e.category||'Workspace'))].sort();
    $('example-category').replaceChildren(new Option('All categories',''),...categories.map(value=>new Option(value,value)));
    engineVersion = info.version; examples = library; renderExamples(); connection(true); $('version').textContent = `Version ${info.version}`;
    $('document-description').textContent = examples.find(example => example.id === current().exampleId)?.description || 'Write a model, inspect its network, explore its dynamics.';
    if (!saved) { const example = await api('/api/examples/catalytic'); if (documents.length === 1 && current().id === initialDocumentId && current().revision === 0 && current().name === 'Untitled.dsd') { const model = createDocument('Catalytic.dsd', example.code, example.dialect, example.id); documents = [model]; selectDocument(model.id); } }
    await restorePendingJob();
  } catch (error) { connection(false); toast(error.message); }
}
initialize().catch(error => toast(error.message));

$('probability-species').addEventListener('change', () => { state().probabilitySpecies = Number($('probability-species').value); renderProbabilities(); });
$('probability-time').addEventListener('input', () => { state().probabilityFrame = Number($('probability-time').value); renderProbabilities(); });
$('probability-log').addEventListener('change', () => { state().probabilityLog = $('probability-log').checked; renderProbabilities(); });
$('probability-csv').addEventListener('click', () => download(`${stem()}.probabilities.csv`, probabilityCsv(selectedRun(), state().probabilitySpecies, selectedModel().settings.timeUnit), 'text/csv'));
$('probability-svg').addEventListener('click', () => download(`${stem()}.probabilities.svg`, new XMLSerializer().serializeToString($('probability-chart')), 'image/svg+xml'));

$('fit-node').addEventListener('change',()=>{Object.assign(state(),{fitNodeId:$('fit-node').value,runIndex:0,speciesPage:0,reactionPage:0,dataPage:0,networkFocus:'',fitParameter:'',fitPair:''});renderResults();});
$('fit-parameter').addEventListener('change',()=>{state().fitParameter=$('fit-parameter').value;renderFit();});
$('fit-pair').addEventListener('change',()=>{state().fitPair=$('fit-pair').value;renderFit();});
$('fit-svg').addEventListener('click',()=>{
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('viewBox','0 0 800 660');
  for(const [id,y]of [['fit-parameter-trace',0],['fit-density',200],['fit-scatter',200],['fit-trace',460]]){const item=$(id).cloneNode(true);item.setAttribute('x',id==='fit-scatter'?400:0);item.setAttribute('y',y);item.setAttribute('width',id==='fit-density'||id==='fit-scatter'?400:800);item.setAttribute('height',id==='fit-density'||id==='fit-scatter'?260:200);svg.append(item);}
  download(`${stem()}-posterior.svg`,new XMLSerializer().serializeToString(svg),'image/svg+xml');
});

function table(rows){const t=element('table');for(const [index,row] of rows.entries()){const tr=element('tr');for(const cell of row)tr.append(element(index?'td':'th','',String(cell)));t.append(tr);}return t;}
function renderSynthesis(){
  const result=state().response?.model.synthesis;if(!result)return;
  $('synthesis-summary').textContent=`${result.mode==='turing'?'Turing instability':'Multistability'} · ${result.status} · ${result.solver} · ${numberLabel(result.solverSeconds)} s solving${result.seed==null?'':' · seed '+result.seed}`;
  $('synthesis-note').textContent=result.status==='SAT'?'Z3 found a satisfying assignment to the symbolic constraints. Displayed values are double-precision approximations. Residuals and eigenvalues below are numerical checks; this is not experimental validation.':result.status==='UNSAT'?'No assignment satisfies this model’s encoded constraints and bounds. This statement applies to the selected symbolic formulation.':'The solver returned UNKNOWN. A time limit or incomplete solving does not establish that no solution exists.';

  $('synthesis-values').replaceChildren(table([['Variable','Kind','Value','Lower bound','Upper bound'],...result.values.map(v=>[v.name,v.kind,numberLabel(v.value),v.lowerBound==null?'—':numberLabel(v.lowerBound),v.upperBound==null?'—':numberLabel(v.upperBound)])]));
  const eqNodes=[];
  for(const eq of result.equilibria){eqNodes.push(element('h3','state-heading',`${eq.name} · max Re(λ) = ${numberLabel(eq.maximumRealEigenvalue)}`));eqNodes.push(table([['Species','Concentration','ODE residual'],...eq.species.map((name,i)=>[name,numberLabel(eq.values[i]),numberLabel(eq.residuals[i])])]));}
  if(result.phasePortrait){const details=element('details');details.append(element('summary','','Sampled trajectories · distance at final time'),table([['Trajectory','Nearest equilibrium','Final distance'],...result.phasePortrait.trajectories.map((t,i)=>[i+1,t.nearestEquilibrium+1,numberLabel(t.finalDistance)])]));eqNodes.push(details);}
  $('synthesis-equilibria').replaceChildren(...eqNodes);
  $('synthesis-dispersion').innerHTML=result.dispersion?dispersionSvg(result):'';
  $('synthesis-phase').innerHTML=result.phasePortrait?phaseSvg(result):'';
  $('synthesis-jacobian').innerHTML=result.equilibria.length?jacobianSvg(result):'';
  $('synthesis-equations').textContent=[result.rateEquations,'Jacobian:',result.jacobian,'Diffusion (w = q²):',result.diffusion,'Constraints:',result.constraints].join('\n\n');
  $('synthesis-open').disabled=Boolean(activeJob)||!result.code;
  $('synthesis-svg').disabled=!result.equilibria.length;
}
$('synthesis-csv').addEventListener('click',()=>download(`${stem()}-synthesis.csv`,synthesisCsv(state().response.model.synthesis),'text/csv;charset=utf-8'));
$('synthesis-svg').addEventListener('click',()=>{const figures=[...$('panel-synthesis').querySelectorAll('.synthesis-chart svg')];const body=figures.map((svg,i)=>`<g transform="translate(0 ${i*340})">${svg.innerHTML}</g>`).join('');download(`${stem()}-synthesis.svg`,`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 750 ${figures.length*340}" style="font-family:system-ui,sans-serif;fill:#344b54">${body}</svg>`,'image/svg+xml');});
$('synthesis-open').addEventListener('click',()=>{try{const result=state().response.model.synthesis;if(!result?.code)return;const doc=createDocument(`${stem()}-synthesized.crn`,result.code,'current');addDocument(doc);}catch(error){toast(error.message);}});

function exportItems(){return state().response?.model.exports || [];}
function renderExports(){
  const items=exportItems();if(!items.length)return;
  $('exports-summary').textContent=exportSummary(items);
  const runs=[...new Set(items.map(item=>item.fileName.match(/run[-_](\d+)/)?.[1] || item.run+'|'+item.sweep+'|'+item.assignment))];
  $('export-run').replaceChildren(...runs.map((key,i)=>{const item=items.find(e=>(e.fileName.match(/run[-_](\d+)/)?.[1] || e.run+'|'+e.sweep+'|'+e.assignment)===key);const node=element('option','',[...new Set([`Run ${i+1}`,item.run,item.sweep,item.assignment].filter(v=>v&&v!=='[]'))].join(' · '));node.value=key;return node;}));
  renderExportFiles();
}
function renderExportFiles(){
  const key=$('export-run').value;
  const items=exportItems().filter(item=>(item.fileName.match(/run[-_](\d+)/)?.[1] || item.run+'|'+item.sweep+'|'+item.assignment)===key);
  $('export-file').replaceChildren(...items.map(item=>{const node=element('option','',item.name+(item.diagnostic?' · unavailable':''));node.value=item.fileName;return node;}));
  renderExportPreview();
}
function selectedExport(){return exportItems().find(item=>item.fileName===$('export-file').value);}
function renderExportPreview(){
  const item=selectedExport();if(!item)return;
  if(exportImageUrl){URL.revokeObjectURL(exportImageUrl);exportImageUrl=null;}
  $('export-image').removeAttribute('src');$('export-image').hidden=true;
  $('export-download').disabled=item.content==null;
  $('export-diagnostic').textContent=item.diagnostic?`${item.diagnostic.code}: ${item.diagnostic.message}`:item.fileName;
  const preview=$('export-preview');preview.textContent=item.content??'';
  preview.hidden=item.content==null || item.contentType==='image/svg+xml';
  if(item.content!=null && item.contentType==='image/svg+xml'){
    exportImageUrl=URL.createObjectURL(new Blob([item.content],{type:'image/svg+xml'}));
    $('export-image').src=exportImageUrl;$('export-image').hidden=false;
  }
}
$('export-run').addEventListener('change',renderExportFiles);
$('export-file').addEventListener('change',renderExportPreview);
$('export-download').addEventListener('click',()=>{const item=selectedExport();if(item?.content!=null)download(item.fileName,item.content,item.contentType+';charset=utf-8');});

$('species-populations').addEventListener('click',()=>{try{download(`${stem()}-final-populations.svg`,populationSnapshotSvg(selectedModel(),selectedRun()),'image/svg+xml');}catch(error){toast(error.message);}});

function renderDsdWorkspace(){
  const data=state().response?.model.dsd;if(!data)return;
  const missing=data.sequences.filter(s=>s.sequence===null).length;
  $('sequence-summary').textContent=data.sequenceStatus==='unavailable'?'This Rules DSD result does not expose a classic domain-to-DNA mapping.':`${data.sequences.length} domain assignments · ${missing} unassigned · ${data.remainingToeholds} unused toeholds · ${data.remainingSpecificities} unused specificities`;
  $('sequences-csv').disabled=!data.sequences.length;$('sequences-fasta').disabled=!data.sequences.some(s=>s.sequence!==null);
  const dl=$('dsd-effective');dl.replaceChildren(...dsdFields.flatMap(field=>[element('dt','',field.label),element('dd','',String(data.options[field.name]))]));
  const term=$('domain-search').value.toUpperCase(),entries=data.sequences.filter(s=>(s.domain+' '+(s.sequence??'')+' '+(s.reverseComplement??'')).toUpperCase().includes(term));
  const view=state();view.domainPage=Math.max(0,Math.min(view.domainPage||0,Math.ceil(entries.length/50)-1));const start=view.domainPage*50;
  $('domain-table').replaceChildren(table([['Domain','Type','DNA · 5′ → 3′','Reverse complement · 5′ → 3′'],...entries.slice(start,start+50).map(s=>[s.domain,s.isToehold?'Toehold':'Specificity',s.sequence??'Unassigned',s.reverseComplement??'Unassigned'])]));
  $('domain-page-label').textContent=entries.length?`${start+1}–${Math.min(start+50,entries.length)} of ${entries.length}`:'No matching domains';
  $('domain-prev').disabled=!view.domainPage;$('domain-next').disabled=start+50>=entries.length;
}
$('domain-search').addEventListener('input',()=>{state().domainPage=0;renderDsdWorkspace();});
$('domain-prev').addEventListener('click',()=>{state().domainPage--;renderDsdWorkspace();});$('domain-next').addEventListener('click',()=>{state().domainPage++;renderDsdWorkspace();});
$('sequences-csv').addEventListener('click',()=>download(`${stem()}-sequences.csv`,sequenceCsv(state().response.model.dsd),'text/csv;charset=utf-8'));
$('sequences-fasta').addEventListener('click',()=>download(`${stem()}-sequences.fasta`,sequenceFasta(state().response.model.dsd),'text/plain;charset=utf-8'));

function rememberJob(task){try{localStorage.setItem(pendingKey,JSON.stringify({id:task.id,documentId:task.documentId,name:task.name}));}catch{toast('Monitoring could not be saved in this browser. Use Jobs to reopen it.');}}
function forgetJob(id){try{if(JSON.parse(localStorage.getItem(pendingKey)||'null')?.id===id)localStorage.removeItem(pendingKey);}catch{}}
function renderLive(){
  const view=documents.length?state():null,p=view?.live;
  $('live-progress').hidden=!p;$('detach-job').hidden=!activeJob||activeJob.documentId!==activeId;
  if(!p)return;
  $('live-status').textContent=[p.message,p.run,p.time!=null?`t = ${p.time}`:'',p.completed!=null&&p.total!=null?`${p.completed} / ${p.total} chains`:''].filter(Boolean).join(' · ');
  const preview=p.preview,has=preview?.times.length&&preview.series.length;
  $('live-chart').hidden=!has;$('live-legend').hidden=!has;$('save-preview').disabled=!has;
  if(has)liveChart.setRun(preview,{timeUnit:'model time',concentrationUnit:'model output'});
}
async function monitorJob(task){
  task.monitor=new AbortController();
  const done=await watchJob(task.id,job=>{
    stateFor(task.documentId).live=job.progress;
    task.message=task.cancelling?'Stopping…':progressLabel(job);
    if(activeJob===task)updateBusy();
  },{signal:task.monitor.signal,onDisconnect:()=>{task.message='Reconnecting; the calculation continues on the service…';if(activeJob===task)updateBusy();}});
  forgetJob(task.id);finishJob(done,task);
}
async function inspectJob(id,binding){
  if(activeJob)return toast('Keep the current calculation in background before opening another.');
  const request=await api(`/api/jobs/${id}/input`),job=readJob(await api(`/api/jobs/${id}`));
  if(activeJob)return toast('Keep the current calculation in background before opening another.');
  let model=documents.find(d=>d.id===binding?.documentId);
  if(!model){model=documentFromRequest(request,binding?.name||`Job-${id.slice(0,8)}`);addDocument(model);}else selectDocument(model.id);
  const task={id,documentId:model.id,revision:resultIsCurrent(model,{request})?model.revision:-1,operation:request.operation,request,engineVersion:job.engineVersion||'unknown',name:binding?.name||model.name,message:progressLabel(job),started:performance.now(),cancelling:false,tab:'plot'};
  state().live=job.progress;
  if(terminalJob(job)){finishJob(job,task);renderResults();updateBusy();return;}
  activeJob=task;rememberJob(task);updateBusy();
  try{await monitorJob(task);}catch(error){if(!task.detached){stateFor(model.id).status='Monitoring stopped; inspect Jobs to reconnect.';toast(error.message);}}
  finally{if(activeJob===task)activeJob=null;if(activeId===model.id)renderResults();updateBusy();}
}
async function restorePendingJob(){
  let binding;try{binding=JSON.parse(localStorage.getItem(pendingKey)||'null');}catch{return;}
  if(!binding||!/^[a-f0-9]{32}$/i.test(binding.id))return;
  inspectJob(binding.id,binding).catch(error=>toast(error.message));
}
async function renderJobs(){
  try{
    const jobs=await api('/api/jobs');
    $('job-list').replaceChildren(...jobs.map(raw=>{
      const job=readJob(raw),row=element('div','job-row'),label=element('span','',`${job.id.slice(0,8)} · ${job.state}`);
      label.append(element('small','',`${new Date(job.createdAt).toLocaleString()} · ${job.progress?.message||'No progress yet'}${job.remoteId?' · remote '+job.remoteId:''}`));row.append(label);
      const inspect=element('button','button secondary compact',terminalJob(job)?'Inspect result':'Monitor');inspect.addEventListener('click',()=>inspectJob(job.id).catch(showError));row.append(inspect);
      if(!terminalJob(job)){const cancel=element('button','text-button','Cancel');cancel.addEventListener('click',async()=>{await api(`/api/jobs/${job.id}`,{method:'DELETE'});renderJobs();});row.append(cancel);}
      if(job.state==='failed'&&job.remoteId){const resume=element('button','text-button','Resume connection');resume.addEventListener('click',async()=>{await api(`/api/jobs/${job.id}/resume`,{method:'POST'});renderJobs();});row.append(resume);}
      return row;
    }));
    if(!jobs.length)$('job-list').append(element('p','muted','No calculations retained by this service.'));
  }catch(error){toast(error.message);}
}
$('show-jobs').addEventListener('click',()=>{$('jobs-panel').hidden=!$('jobs-panel').hidden;if(!$('jobs-panel').hidden)renderJobs();});
$('hide-jobs').addEventListener('click',()=>{$('jobs-panel').hidden=true;});$('refresh-jobs').addEventListener('click',renderJobs);
$('detach-job').addEventListener('click',()=>{const task=activeJob;if(!task)return;task.detached=true;activeJob=null;task.monitor?.abort();updateBusy();toast('Calculation continues. Open Jobs to monitor it again.');});
$('save-preview').addEventListener('click',()=>{const preview=state().live?.preview;if(preview)download(`${stem()}-provisional-preview.csv`,csvFor(preview),'text/csv;charset=utf-8');});
