import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createDocument, requestFor, populationLabel } from '../../src/VisualDsd.App/Web/model.js';
import { readResponse, serialiseProject, parseProject } from '../../src/VisualDsd.App/Web/project.js';
import { spatialCsv, statesCsv, shortestPath, stateSummary, spatialScale } from '../../src/VisualDsd.App/Web/exploration.js';
globalThis.crypto ??= webcrypto;

function fixture(operation = 'simulate') {
  const document = createDocument('explore.dsd', '<a>');
  const settings = { simulator: 'pde', initial: 0, final: 1, points: 1, seed: 42, timeUnit: 's', concentrationUnit: 'nM' };
  const species = ['a', 'b'].map(id => ({ id, name: id, structure: `<${id}>`, svg: '', initial: '1', constant: false, time: null, valueKind: 'initial' }));
  const spatial = { dimensions: 1, boundary: 'Periodic', x: [0, 1, 2, 3], y: [], dt: .1, series: [{ name: 'a', frames: [[1, 2, 3, 1], [1.123456789012345, 2, 3, 1.123456789012345]] }] };
  const stateSpace = { speciesIds: ['a', 'b'], initialState: 0, states: [[2, 0], [1, 1], [0, 2]], transitions: [{ source: 0, target: 1, rate: .7 }, { source: 1, target: 2, rate: .35 }] };
  const run = { name: '', sweep: '', assignment: '', times: [0, 1], series: [{ name: 'a', values: [2, 2.041152263004115] }], seed: 42, settings, network: null, spatial, stateSpace: null };
  if (operation === 'analyze') Object.assign(run, { times: [], series: [], spatial: null, stateSpace });
  const response = { success: true, operation, dialect: 'current', diagnostics: [], model: { kind: 'classic', compilation: 'default', isJit: false, settings, species, reactions: [], simulations: [run], inference: null } };
  const view = { response, snapshot: { name: document.name, request: requestFor(document, operation), engineVersion: '0.7.0' }, runIndex: 0, tab: operation === 'analyze' ? 'states' : 'spatial', spatialSeries: 0, spatialFrame: operation === 'analyze' ? 0 : 1, stateIndex: operation === 'analyze' ? 2 : 0 };
  return { document, view, run };
}

for (const operation of ['simulate', 'analyze']) test(`${operation} project roundtrip preserves all coordinates, cells, rates and selected view`, () => {
  const { document, view } = fixture(operation);
  const restored = parseProject(serialiseProject([document], document.id, new Map([[document.id, view]]), '0.7.0')).views.get(document.id);
  assert.deepEqual(restored.response, view.response); assert.equal(restored.tab, view.tab); assert.equal(restored.spatialFrame, view.spatialFrame); assert.equal(restored.stateIndex, view.stateIndex);
});

test('spatial CSV preserves every coordinate and full precision value in x-major order', () => {
  const { run } = fixture(); const lines = spatialCsv(run, 's').trim().split('\r\n');
  assert.equal(lines.length, 9); assert.equal(lines[0], 'Time (s),x (model units),a'); assert.equal(lines[5], '1,0,1.123456789012345');
  run.spatial.dimensions = 2; run.spatial.y = [...run.spatial.x]; run.spatial.series[0].frames = [Array.from({ length: 16 }, (_, i) => i), Array(16).fill(0)];
  const rows = spatialCsv(run).trim().split('\r\n'); assert.equal(rows.length, 33); assert.equal(rows[6], '0,1,1,5');
});

test('malformed spatial data is rejected transactionally', () => {
  for (const mutate of [grid => grid.x.pop(), grid => { grid.x[2] = 1; }, grid => { grid.dimensions = 2; }, grid => { grid.series[0].frames[0].pop(); }, grid => { grid.series[0].frames.pop(); }, grid => { grid.series[0].frames[0][0] = Infinity; }, grid => { grid.dt = 0; }, grid => { grid.series[0].name = 'other'; }]) {
    const { view, run } = fixture(); mutate(run.spatial); assert.throws(() => readResponse(view.response));
  }
});

test('state graph rejects unreachable, duplicate, malformed, and nonpositive-rate output', () => {
  for (const mutate of [graph => { graph.initialState = 3; }, graph => graph.speciesIds.push('unknown'), graph => { graph.states[0][0] = .5; }, graph => { graph.states[1] = [...graph.states[0]]; }, graph => graph.transitions.pop(), graph => { graph.transitions[0].rate = 0; }, graph => { graph.transitions[0].rate = NaN; }, graph => { graph.transitions[0].target = 4; }, graph => graph.transitions.push({ ...graph.transitions[0] })]) {
    const { view, run } = fixture('analyze'); mutate(run.stateSpace); assert.throws(() => readResponse(view.response));
  }
});

test('shortest witnesses handle cycles and choose fewer transitions while absorbing states and ranges are exact', () => {
  const { view, run } = fixture('analyze'); const graph = run.stateSpace;
  assert.deepEqual(shortestPath(graph, 2), [0, 1, 2]); assert.deepEqual(shortestPath(graph, 99), []);
  graph.transitions.push({ source: 1, target: 0, rate: 1 }, { source: 0, target: 2, rate: .1 });
  assert.deepEqual(shortestPath(graph, 2), [0, 2]); assert.deepEqual(shortestPath(graph, 0), [0]);
  const summary = stateSummary(graph); assert.deepEqual(summary.absorbing, [2]); assert.deepEqual(summary.ranges[0], { id: 'a', min: 0, max: 2 });
  assert.equal(statesCsv(graph, view.response.model), 'State,<a>,<b>\r\n0,2,0\r\n1,1,1\r\n2,0,2\r\n');
});

test('spatial colors share a fixed scale across all frames and saved view indexes are bounded', () => {
  const { document, view, run } = fixture(); assert.deepEqual(spatialScale(run.spatial.series[0]), { min: 1, max: 3 });
  view.spatialFrame = 2; assert.throws(() => serialiseProject([document], document.id, new Map([[document.id, view]]), '0.7.0'));
});

test('analysis metadata cannot be imported under an unrelated operation or simulator', () => {
  const { view, run } = fixture('analyze'); view.response.operation = 'expand'; assert.throws(() => readResponse(view.response));
  const spatial = fixture(); spatial.run.settings.simulator = 'ssa'; assert.throws(() => readResponse(spatial.view.response));
});

test('spatial initial conditions are labeled as fields rather than scalar concentrations', () => {
  const { view } = fixture(); view.response.model.species[0].valueKind = 'spatial';
  const restored = readResponse(view.response); assert.match(populationLabel(restored.model.species[0]), /Spatial initial field/); assert.doesNotMatch(populationLabel(restored.model.species[0]), /Initial: 1/);
});

test('scheduled JIT inputs use remaining time and ordinary timed inputs use absolute time', () => {
  const species = { initial: '3', time: '0.5', constant: false };
  assert.equal(populationLabel({ ...species, valueKind: 'timedInput' }), 'Timed input: 3 · at 0.5');
  assert.equal(populationLabel({ ...species, valueKind: 'scheduledInput' }), 'Scheduled input: 3 · after 0.5');
});


test('large spatial heatmaps reduce display cells without dropping samples or changing export data', async () => {
  const { spatialHeatmapRows } = await import('../../src/VisualDsd.App/Web/exploration.js');
  const run = { times: Array.from({length: 3000}, (_,i) => i / 30), spatial: {x: Array.from({length: 64}, (_,i) => i)} };
  const series = { frames: run.times.map((_,t) => Array(64).fill(t)) };
  const rows = spatialHeatmapRows(run,series);
  assert.ok(rows.length * 64 <= 20000);
  assert.equal(rows[0].start,0); assert.equal(rows.at(-1).end,3000);
  assert.ok(rows.every((r,i) => !i || r.start===rows[i-1].end));
  assert.ok(rows.every(r => Math.abs(r.values[0]-(r.start+r.end-1)/2)<1e-10));
  assert.equal(series.frames.length,3000); assert.equal(series.frames[2999][0],2999);
});


test('larger spatial grids and nonuniform sample times survive project import', () => {
  for (const [dimensions,nx] of [[1,512],[2,128]]) {
    const {document,view,run} = fixture();
    const grid=run.spatial; grid.dimensions=dimensions;
    grid.x=Array.from({length:nx},(_,i)=>i/(nx-1)); grid.y=dimensions===2?[...grid.x]:[];
    run.times=[0,.17,.17,1]; run.series[0].values=[2,2,2,2];
    grid.series[0].frames=run.times.map(()=>Array(nx*(grid.y.length||1)).fill(2));
    const restored=parseProject(serialiseProject([document],document.id,new Map([[document.id,view]]),'0.12.0')).views.get(document.id);
    assert.deepEqual(restored.response.model.simulations[0].times,run.times);
    assert.equal(restored.response.model.simulations[0].spatial.x.length,nx);
  }
});
