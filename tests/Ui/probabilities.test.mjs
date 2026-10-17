import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createDocument, requestFor } from '../../src/VisualDsd.App/Web/model.js';
import { readResponse, serialiseProject, parseProject } from '../../src/VisualDsd.App/Web/project.js';
import { marginal, probabilityCsv, heatmapBuckets } from '../../src/VisualDsd.App/Web/probabilities.js';
globalThis.crypto ??= webcrypto;

function fixture() {
  const document = createDocument('decay.dsd', '<a>'); document.options.simulator = 'cme';
  const settings = { simulator: 'cme', initial: 0, final: 1, points: 1, seed: null, timeUnit: 's', concentrationUnit: 'nM' };
  const species = ['a', 'b'].map(id => ({ id, name: id, structure: `<${id}>`, svg: '', initial: id === 'a' ? '2' : '0', constant: false, time: null, valueKind: 'initial' }));
  const probabilities = { speciesIds: ['a', 'b'], states: [[2, 0], [1, 1], [0, 2]], mass: [[1, 0, 0], [.25, .5, .25]], maximumMassError: 1e-12 };
  const run = { name: '', sweep: '', assignment: '', seed: null, settings, times: [0, 1], series: [
    { name: 'a', values: [2, 1], standardDeviation: [0, Math.sqrt(.5)] }, { name: 'b', values: [0, 1], standardDeviation: [0, Math.sqrt(.5)] }], probabilities };
  const response = { success: true, operation: 'simulate', dialect: 'current', diagnostics: [], model: { kind: 'classic', compilation: 'default', isJit: false, settings, species, reactions: [], simulations: [run] } };
  const view = { response, snapshot: { name: document.name, request: requestFor(document, 'simulate'), engineVersion: '0.11.0' }, tab: 'probabilities', runIndex: 0, probabilitySpecies: 1, probabilityFrame: 1, probabilityLog: true };
  return { document, view, run, probabilities };
}

test('marginals sum joint probabilities without discarding correlations or rare tails', () => {
  const run = { probabilities: { speciesIds: ['a', 'b'], states: [[0, 0], [0, 1], [1000000, 0]], mass: [[.2, .8 - 1e-12, 1e-12]] } };
  assert.deepEqual(marginal(run, 0).counts, [0, 1000000]);
  assert.equal(marginal(run, 0).probabilities[0][1], 1e-12);
  assert.equal(marginal(run, 1).probabilities[0][0], .2 + 1e-12);
  assert.throws(() => marginal(run, 2));
});

test('probability project roundtrip retains joint mass, selected species, time and palette', () => {
  const { document, view } = fixture();
  const restored = parseProject(serialiseProject([document], document.id, new Map([[document.id, view]]), '0.11.0')).views.get(document.id);
  assert.deepEqual(restored.response, view.response); assert.equal(restored.tab, 'probabilities');
  assert.equal(restored.probabilitySpecies, 1); assert.equal(restored.probabilityFrame, 1); assert.equal(restored.probabilityLog, true);
});

test('invalid probability states, masses, identities, moments and selections are rejected', () => {
  for (const mutate of [
    p => { p.mass[1][0] = -1e-12; }, p => { p.mass[0][0] = .9; }, p => p.mass.pop(), p => p.mass[0].pop(),
    p => { p.states[0][0] = .5; }, p => { p.states[0][0] = -1; }, p => p.states[0].pop(),
    p => { p.states[1] = [...p.states[0]]; }, p => { p.speciesIds[0] = 'unknown'; }, p => { p.speciesIds[0] = 'b'; },
    p => { p.mass[1] = [1, 0, 0]; }, p => { p.maximumMassError = .1; },
  ]) { const { view, probabilities } = fixture(); mutate(probabilities); assert.throws(() => readResponse(view.response)); }
  const { document, view } = fixture(); view.probabilityFrame = 2;
  assert.throws(() => serialiseProject([document], document.id, new Map([[document.id, view]]), '0.11.0'));
});

test('older CME results remain readable without fabricated probability data', () => {
  const { view, run } = fixture(); delete run.probabilities;
  assert.equal(readResponse(view.response).model.simulations[0].probabilities, undefined);
});

test('distribution CSV preserves every exact sample and sparse copy number', () => {
  const { run } = fixture(), csv = probabilityCsv(run, 0);
  assert.equal(csv.split('\r\n').length, 8);
  assert.ok(csv.includes('0,2,1\r\n')); assert.ok(csv.includes('1,0,0.25\r\n'));
});

test('heatmap reduction is bounded and conserves mass while covering all samples', () => {
  const run = { times: Array.from({ length: 5000 }, (_, i) => i / 10) };
  const map = { counts: Array.from({ length: 40 }, (_, i) => i), probabilities: run.times.map(() => Array(40).fill(1 / 40)) };
  const buckets = heatmapBuckets(run, map);
  assert.ok(buckets.length * map.counts.length <= 20000);
  assert.equal(buckets[0].start, 0); assert.equal(buckets.at(-1).end, 5000);
  assert.ok(buckets.every((b, i) => (!i || b.start === buckets[i - 1].end) && Math.abs(b.mean.reduce((a, v) => a + v, 0) - 1) < 1e-12));
});


test('CME projects retain more than a thousand joint states and compound plot moments', () => {
  const {document, view, run, probabilities} = fixture();
  probabilities.states = Array.from({length: 1201},(_,i) => [1200-i,i]);
  probabilities.mass = run.times.map(() => Array.from({length:1201},(_,i)=>i===0?1:0));
  run.series = [{name:'a',values:[1200,1200],standardDeviation:[0,0]}, {name:'a+b',values:[1200,1200],standardDeviation:[0,0]}];
  const restored = parseProject(serialiseProject([document],document.id,new Map([[document.id,view]]),'0.12.0')).views.get(document.id);
  assert.equal(restored.response.model.simulations[0].probabilities.states.length,1201);
  assert.deepEqual(restored.response.model.simulations[0].series,run.series);
});
