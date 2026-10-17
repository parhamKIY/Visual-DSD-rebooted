import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createDocument, requestFor, restoreWorkspace, optionDefaults } from '../../src/VisualDsd.App/Web/model.js';
import { parseProject, serialiseProject, normaliseRequest, readProgram, readResponse, resultIsCurrent } from '../../src/VisualDsd.App/Web/project.js';
import { programSvg } from '../../src/VisualDsd.App/Web/program.js';
globalThis.crypto ??= webcrypto;

function fixture() {
  const code = 'directive parameters [k=0.5]\nsystem decay = { | 10 A | A ->{k} B }\nnode first {systems=[decay]}\nnode second {systems=[decay]}\nedge first -> [k=Normal] second';
  const document = createDocument('experiment.crn', code);
  document.options.nodeId = 'second'; document.options.systemId = 'decay';
  const program = { source: code, selectedNodeId: 'second', selectedSystemId: 'decay', nodes: ['first', 'second'].map(id => ({ id, systems: [{ id: '', speciesCount: 0, reactionCount: 0 }, { id: 'decay', speciesCount: 2, reactionCount: 1 }] })), edges: [{ source: { nodeId: 'first', systemId: '' }, target: { nodeId: 'second', systemId: '' }, parameters: [{ sourceParameter: 'k', targetParameter: 'k', kind: 'Normal' }] }] };
  const response = { success: true, operation: 'parse', dialect: 'current', diagnostics: [], model: { kind: 'crn', compilation: 'source', isJit: false, settings: { simulator: 'oslo', initial: 0, final: 10, points: 100, seed: null, timeUnit: 's', concentrationUnit: 'nM' }, species: [{ id: 'A', name: 'A', structure: 'A', svg: '', initial: '10', constant: false, time: null, valueKind: 'initial' }], reactions: [], simulations: [], program, crnCode: '| 10 A | A ->{0.5} B', inference: null } };
  const view = { response, snapshot: { name: document.name, request: requestFor(document, 'parse'), engineVersion: '0.9.0' }, tab: 'program', runIndex: 0 };
  return { document, response, program, view, views: new Map([[document.id, view]]) };
}

test('CRN source, language and independent selections survive workspace and project round trips', () => {
  const { document, response, view, views } = fixture();
  const restored = parseProject(serialiseProject([document], document.id, views, '0.9.0'));
  assert.deepEqual(restored.documents[0], document);
  assert.deepEqual(restored.views.get(document.id).response, response);
  assert.equal(restored.views.get(document.id).tab, 'program');
  assert.equal(resultIsCurrent(document, view.snapshot), true);
  document.options.systemId = '$top'; assert.equal(resultIsCurrent(document, view.snapshot), false);
  const browser = restoreWorkspace(JSON.stringify({ version: 1, documents: [document], activeId: document.id }));
  assert.equal(browser.documents[0].options.systemId, '$top');
});

test('CRN requests distinguish automatic selection and explicit top-level selection without DSD overrides', () => {
  const document = createDocument('model.crn', '| 1 A');
  document.options.dialect = 'legacy'; document.options.compilation = 'finite'; document.databases.toeholds = { code: 'unrelated' };
  const auto = requestFor(document, 'simulate');
  assert.equal(auto.language, 'crn'); assert.equal(auto.dialect, 'current'); assert.equal(auto.compilation, 'source');
  assert.equal('nodeId' in auto, false); assert.equal('systemId' in auto, false); assert.equal('toeholds' in auto, false);
  document.options.systemId = '$top'; assert.equal(requestFor(document, 'parse').systemId, '');
  assert.deepEqual(normaliseRequest(requestFor(document, 'parse')), requestFor(document, 'parse'));
});

test('earlier project files keep their DSD language and their request identity', () => {
  const document = createDocument('old.dsd', '<a>');
  const raw = JSON.parse(serialiseProject([document], document.id, new Map(), '0.8.0'));
  for (const key of ['language', 'nodeId', 'systemId']) delete raw.documents[0].options[key];
  assert.deepEqual(parseProject(JSON.stringify(raw)).documents[0].options, optionDefaults);
  assert.equal('language' in requestFor(document, 'parse'), false);
});

test('corrupt graph endpoints, selections, duplicate systems and cycles cannot enter restored results', () => {
  for (const mutate of [p => { p.edges[0].target.nodeId = 'unknown'; }, p => { p.selectedSystemId = 'unknown'; }, p => { p.nodes.push(p.nodes[0]); }, p => { p.nodes[0].systems.push(p.nodes[0].systems[0]); }, p => { p.edges.push({ ...p.edges[0], source: p.edges[0].target, target: p.edges[0].source }); }, p => { p.edges[0].parameters[0].kind = 'fake'; }]) {
    const { program, response } = fixture(); mutate(program);
    assert.throws(() => readProgram(program)); assert.throws(() => readResponse(response));
  }
});

test('saved CRN results must match their source and the selected node/system', () => {
  for (const mutate of [p => { p.source += '\n// different'; }, p => { p.selectedNodeId = 'first'; }, p => { p.selectedSystemId = ''; }]) {
    const { document, views, program } = fixture(); mutate(program);
    assert.throws(() => serialiseProject([document], document.id, views, '0.9.0'));
  }
});

test('model diagrams preserve dependencies and escape every imported label', () => {
  const { program } = fixture(), svg = programSvg(program);
  assert.match(svg, /Model dependency graph/); assert.match(svg, /first/); assert.match(svg, /second/); assert.match(svg, /Normal/);
  program.nodes[0].id = '<script>alert(1)</script>'; program.edges[0].source.nodeId = program.nodes[0].id;
  assert.doesNotMatch(programSvg(program), /<script>/); assert.match(programSvg(program), /&lt;script&gt;/);
});
