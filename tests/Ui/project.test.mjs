import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createDocument, requestFor, csvFor } from '../../src/VisualDsd.App/Web/model.js';
import { parseProject, serialiseProject, resultIsCurrent, readResponse } from '../../src/VisualDsd.App/Web/project.js';
globalThis.crypto ??= webcrypto;

function fixture() {
  const document = createDocument('مدل.dsd', '<a>'); document.options.seed = '42';
  document.databases.toeholds = { name: 'custom.txt', code: 'a 0.1 0.2' };
  const response = { success: true, operation: 'simulate', dialect: 'current', diagnostics: [], model: { kind: 'classic', compilation: 'default', isJit: false,
    settings: { simulator: 'ssa', initial: 0, final: 100, points: 3, seed: 42, timeUnit: 's', concentrationUnit: 'nM' },
    species: [{ id: 'a', name: '<a>', structure: '<a>', svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', initial: '1', constant: false, time: null, valueKind: 'initial' }], reactions: [],
    simulations: [{ name: 'run', sweep: 's', assignment: 'N=1', seed: 42, times: [0, .123456789012345, 100], series: [{ name: 'a', values: [1, -2.34567890123456, 1e-20] }] }] } };
  const view = { snapshot: { name: document.name, request: requestFor(document, 'simulate'), engineVersion: '0.3.0' }, response, tab: 'network', runIndex: 0 };
  return { document, view, views: new Map([[document.id, view]]) };
}

test('complete project round trip preserves exact results, source, databases and originating engine version', () => {
  const { document, view, views } = fixture(), text = serialiseProject([document], document.id, views, '0.4.0'), restored = parseProject(text);
  assert.deepEqual(restored.documents[0], document);
  assert.deepEqual(restored.views.get(document.id).response, view.response);
  assert.equal(restored.views.get(document.id).snapshot.engineVersion, '0.3.0');
  assert.equal(restored.views.get(document.id).tab, 'network');
  assert.equal(restored.views.get(document.id).revision, 0);
  assert.equal(csvFor(restored.views.get(document.id).response.model.simulations[0]), csvFor(view.response.model.simulations[0]));
});

test('unfinished drafts can be saved without pretending to contain a result', () => {
  const document = createDocument(); document.code = ''; document.options.final = 'unfinished';
  const restored = parseProject(serialiseProject([document], document.id, new Map(), '0.4.0'));
  assert.equal(restored.documents[0].code, ''); assert.equal(restored.documents[0].options.final, 'unfinished'); assert.equal(restored.views.size, 0);
});

test('old results remain marked stale after project import and become current only when the executed request matches', () => {
  const { document, view, views } = fixture(); document.code += '\n// changed';
  const restored = parseProject(serialiseProject([document], document.id, views, '0.4.0'));
  assert.equal(restored.views.get(document.id).revision, -1);
  assert.equal(resultIsCurrent(document, view.snapshot), false);
  document.code = '<a>'; assert.equal(resultIsCurrent(document, view.snapshot), true);
  document.options.seed = '43'; assert.equal(resultIsCurrent(document, view.snapshot), false);
});

test('malformed files and unsupported versions are rejected without altering the current project', () => {
  const { document, views } = fixture(), json = serialiseProject([document], document.id, views, '0.4.0');
  for (const mutate of [raw => { raw.version = 2; }, raw => { raw.activeId = 'missing'; }, raw => { raw.documents.push(raw.documents[0]); }, raw => { raw.documents[0].options.simulator = 'made-up'; }, raw => { raw.documents[0].result.request.operation = 'parse'; }, raw => { raw.documents[0].result.runIndex = 9; }]) {
    const raw = JSON.parse(json); mutate(raw); assert.throws(() => parseProject(JSON.stringify(raw)), Error);
  }
  assert.throws(() => parseProject('{'), /JSON/); assert.throws(() => parseProject(' '.repeat(16 * 1024 * 1024 + 1)), /16 MiB/);
  assert.equal(document.code, '<a>'); assert.equal(views.size, 1);
});

test('numeric and network corruption cannot be restored as a successful result', () => {
  for (const mutate of [raw => { raw.model.simulations[0].series[0].values.pop(); }, raw => { raw.model.simulations[0].times[1] = -1; }, raw => { raw.model.simulations[0].series[0].values[0] = Infinity; }, raw => { raw.model.species.push(raw.model.species[0]); }, raw => { raw.model.reactions.push({ reactants: [{ speciesId: 'missing', multiplicity: 1 }], products: [], catalysts: [], rate: { kind: 'massAction', expression: '1' }, reverseRate: null }); }]) {
    const { view } = fixture(); mutate(view.response); assert.throws(() => readResponse(view.response), Error);
  }
});

test('legacy JIT result files identify final populations without relabeling them as initial amounts', () => {
  const { view } = fixture(); view.response.model.isJit = true; delete view.response.model.species[0].valueKind;
  assert.equal(readResponse(view.response).model.species[0].valueKind, 'finalPopulation');
});
