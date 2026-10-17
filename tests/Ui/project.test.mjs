import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createDocument, requestFor, csvFor, modelForRun } from '../../src/VisualDsd.App/Web/model.js';
import { parseProject, serialiseProject, resultIsCurrent, readResponse } from '../../src/VisualDsd.App/Web/project.js';
globalThis.crypto ??= webcrypto;

function fixture() {
  const document = createDocument('مدل.dsd', '<a>'); document.options.seed = '42';
  document.databases.toeholds = { name: 'custom.txt', code: 'a 0.1 0.2' };
  const response = { success: true, operation: 'simulate', dialect: 'current', diagnostics: [], model: { kind: 'classic', compilation: 'default', isJit: false,
    settings: { simulator: 'ssa', initial: 0, final: 100, points: 3, seed: 42, timeUnit: 's', concentrationUnit: 'nM' },
    species: [{ id: 'a', name: '<a>', structure: '<a>', svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', initial: '1', constant: false, time: null, valueKind: 'initial' }], reactions: [],
    simulations: [{ name: 'run', sweep: 's', assignment: 'N=1', seed: 42, times: [0, .123456789012345, 100], series: [{ name: 'a', values: [1, -2.34567890123456, 1e-20] }] }] } };
  const view = { snapshot: { name: document.name, request: requestFor(document, 'simulate'), engineVersion: '0.3.0' }, response, tab: 'network', runIndex: 0, networkFocus: 'a' };
  return { document, view, views: new Map([[document.id, view]]) };
}

test('complete project round trip preserves exact results, source, databases and originating engine version', () => {
  const { document, view, views } = fixture(), text = serialiseProject([document], document.id, views, '0.4.0'), restored = parseProject(text);
  assert.deepEqual(restored.documents[0], document);
  assert.deepEqual(restored.views.get(document.id).response, view.response);
  assert.equal(restored.views.get(document.id).snapshot.engineVersion, '0.3.0');
  assert.equal(restored.views.get(document.id).tab, 'network');
  assert.equal(restored.views.get(document.id).networkFocus, 'a');
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
  for (const mutate of [raw => { raw.version = 2; }, raw => { raw.activeId = 'missing'; }, raw => { raw.documents.push(raw.documents[0]); }, raw => { raw.documents[0].databases = 42; }, raw => { raw.documents[0].options.simulator = 'made-up'; }, raw => { raw.documents[0].result.request.operation = 'parse'; }, raw => { raw.documents[0].result.runIndex = 9; }, raw => { raw.documents[0].result.networkFocus = 'missing'; }]) {
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

function batchFixture() {
  const result = fixture(), model = result.view.response.model;
  model.isJit = true;
  model.species[0].valueKind = 'finalPopulation';
  const first = model.simulations[0];
  first.settings = { ...model.settings };
  first.network = { species: structuredClone(model.species), reactions: [] };
  const second = structuredClone(first); second.name = 'second'; second.assignment = 'N=7';
  second.settings.final = 200; second.times[2] = 200;
  second.network.species[0].id = 'second-only'; second.network.species[0].initial = '7';
  second.network.reactions = [{ reactants: [{ speciesId: 'second-only', multiplicity: 1 }], products: [], catalysts: [], rate: { kind: 'massAction', expression: '1' }, reverseRate: null }];
  model.simulations.push(second); result.view.runIndex = 1; result.view.networkFocus = 'second-only';
  return result;
}

test('selected JIT run supplies its own network and settings to every result view', () => {
  const { view } = batchFixture(), model = view.response.model;
  assert.equal(modelForRun(model, 0).species[0].initial, '1');
  assert.equal(modelForRun(model, 1).species[0].initial, '7');
  assert.equal(modelForRun(model, 1).species[0].id, 'second-only');
  assert.equal(modelForRun(model, 1).reactions.length, 1);
  assert.equal(modelForRun(model, 1).settings.final, 200);
  assert.equal(model.species[0].id, 'a'); assert.equal(model.settings.final, 100);
  const { view: old } = fixture(); assert.deepEqual(modelForRun(old.response.model, 0), old.response.model);
});

test('batch project restores exact per-run networks, settings, data and focus on a species absent from the first run', () => {
  const { document, view, views } = batchFixture();
  const restored = parseProject(serialiseProject([document], document.id, views, '0.5.0')).views.get(document.id);
  assert.deepEqual(restored.response, view.response); assert.equal(restored.runIndex, 1); assert.equal(restored.networkFocus, 'second-only');
  assert.equal(modelForRun(restored.response.model, restored.runIndex).settings.final, 200);
  assert.equal(csvFor(restored.response.model.simulations[1]), csvFor(view.response.model.simulations[1]));
});

test('batch import validates every network in its own identifier scope and rejects corrupted run settings', () => {
  for (const mutate of [model => { model.simulations[1].network.reactions[0].reactants[0].speciesId = 'a'; },
    model => { model.simulations[1].network.species.push(model.simulations[1].network.species[0]); },
    model => { model.simulations[1].settings.final = Infinity; }, model => { model.simulations[1].settings.seed = 7; }]) {
    const { view } = batchFixture(); mutate(view.response.model); assert.throws(() => readResponse(view.response), Error);
  }
});


test('timed inputs preserve their own values and absolute times with a stable species reference', () => {
  const { document, view, views } = fixture();
  const input = { ...view.response.model.species[0], id: 'initial:1:a', sourceId: 'a', initial: '3', time: '0.5', valueKind: 'timedInput' };
  view.response.model.species.push(input);
  const restored = parseProject(serialiseProject([document], document.id, views, '0.8.0'));
  assert.deepEqual(restored.views.get(document.id).response.model.species[1], input);
  for (const sourceId of ['unknown', 'initial:1:a']) { input.sourceId = sourceId; assert.throws(() => readResponse(view.response)); }
});

for (const simulator of ['sundials', 'cmesundials', 'mc']) {
  test(`${simulator} project round trip retains solver, uncertainty and run identity`, () => {
    const { document, view, views } = fixture();
    document.options.simulator = simulator;
    view.snapshot.request = requestFor(document, 'simulate');
    view.response.model.settings.simulator = simulator;
    view.response.model.simulations[0].settings = { ...view.response.model.settings };
    if (simulator !== 'sundials') view.response.model.simulations[0].series[0].standardDeviation = [0, 1.25, .5];
    const restored = parseProject(serialiseProject([document], document.id, views, '0.10.0'));
    assert.equal(restored.documents[0].options.simulator, simulator);
    assert.equal(resultIsCurrent(restored.documents[0], restored.views.get(document.id).snapshot), true);
    assert.deepEqual(restored.views.get(document.id).response.model.simulations, view.response.model.simulations);
  });
}
