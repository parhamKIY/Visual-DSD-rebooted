import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readDatasets } from '../../src/VisualDsd.App/Web/observations.js';
import { createDocument, requestFor, csvFor, restoreWorkspace } from '../../src/VisualDsd.App/Web/model.js';
import { readResponse, serialiseProject, parseProject, resultIsCurrent } from '../../src/VisualDsd.App/Web/project.js';
import { extent } from '../../src/VisualDsd.App/Web/chart.js';
globalThis.crypto ??= webcrypto;

const observations = () => ({ times: [0, 1], series: [{ name: 'a', values: [10, 7], standardDeviation: null }], timeUnit: 's' });
function fixture() {
  const document = createDocument('fit.dsd', '<a>'); document.data = [{ name: 'experiment', tables: [observations()] }];
  const fit = { seed: 42, burnIn: 0, iterations: 2, thin: 1, retainedSamples: 2, dataPoints: 2, maxLogLikelihood: -1,
    parameters: [{ name: 'k', kind: 'model', mle: .35, mean: .34, variance: .001, median: .34, lower95: .3, upper95: .4, samples: [.3, .38] }], logLikelihood: [-2, -1], observations: [observations()] };
  const settings = { simulator: 'oslo', initial: 0, final: 1, points: 2, seed: null, timeUnit: 's', concentrationUnit: 'nM' };
  const response = { success: true, operation: 'infer', dialect: 'current', diagnostics: [], model: { kind: 'classic', compilation: 'default', isJit: false, settings,
    species: [{ id: 'a', name: 'a', structure: '<a>', svg: '', initial: '10', constant: false, time: null, valueKind: 'initial' }], reactions: [],
    simulations: [{ name: '', sweep: '', assignment: '', times: [0, 1], series: [{ name: 'a', values: [10, 7.046880897187134], standardDeviation: null }], seed: null, settings, network: null }], inference: fit } };
  const view = { response, snapshot: { name: document.name, request: requestFor(document, 'infer'), engineVersion: '0.6.0' }, runIndex: 0, tab: 'fit' };
  return { document, view };
}

test('observation data survives browser drafts and complete projects with exact fit provenance', () => {
  const { document, view } = fixture();
  assert.deepEqual(restoreWorkspace(JSON.stringify({ version: 1, documents: [document], activeId: document.id })).documents[0].data, document.data);
  const restored = parseProject(serialiseProject([document], document.id, new Map([[document.id, view]]), '0.6.0'));
  assert.deepEqual(restored.views.get(document.id).response, view.response); assert.equal(restored.views.get(document.id).tab, 'fit');
  assert.equal(resultIsCurrent(restored.documents[0], restored.views.get(document.id).snapshot), true);
  document.data[0].tables[0].series[0].values[1] = 8;
  assert.equal(resultIsCurrent(document, view.snapshot), false);
});

test('inference requires imported data and simulation requests do not acquire observation data implicitly', () => {
  const document = createDocument(); assert.throws(() => requestFor(document, 'infer'), /Import/);
  document.data = [{ name: 'experiment', tables: [observations()] }];
  assert.equal('data' in requestFor(document, 'simulate'), false);
  assert.equal(requestFor(document, 'infer').data[0].name, 'experiment');
});

test('posterior and observed data corruption cannot be imported as a successful fit', () => {
  for (const mutate of [fit => { fit.parameters[0].samples.pop(); }, fit => { fit.parameters[0].variance = -1; }, fit => { fit.parameters[0].upper95 = .1; }, fit => { fit.parameters.push(fit.parameters[0]); }, fit => { fit.logLikelihood[0] = Infinity; }, fit => { fit.dataPoints = 9; }, fit => { fit.observations[0].series[0].name = 'other'; }, fit => { fit.observations[0].times[1] = 2; }]) {
    const { view } = fixture(); mutate(view.response.model.inference); assert.throws(() => readResponse(view.response));
  }
});

test('standard deviations survive result restoration and full precision CSV export', () => {
  const { view } = fixture(); view.response.operation = 'simulate'; view.response.model.inference = null;
  const series = view.response.model.simulations[0].series[0]; series.standardDeviation = [0, .123456789012345];
  const restored = readResponse(view.response); assert.deepEqual(restored.model.simulations[0].series[0], series);
  assert.match(csvFor(restored.model.simulations[0]), /a \(StDev\)/); assert.match(csvFor(restored.model.simulations[0]), /0.123456789012345/);
  for (const bad of [[0], [0, -1], [0, Infinity]]) { series.standardDeviation = bad; assert.throws(() => readResponse(view.response)); }
});

test('plot bounds include uncertainty and observed points for the visible series', () => {
  const run = { times: [0, 1], series: [{ name: 'a', values: [1, 2], standardDeviation: [0, 5] }] };
  const bounds = extent(run, null, { times: [0, 1], series: [{ name: 'a', values: [1, 20] }] });
  assert.ok(bounds.y0 < -3); assert.ok(bounds.y1 > 20);
});

test('observation validation rejects duplicate datasets and invalid times, values, or column lengths', () => {
  for (const mutate of [table => { table.times[1] = 0; }, table => { table.series[0].values.pop(); }, table => { table.series[0].values[1] = NaN; }, table => { table.series.push(table.series[0]); }, table => { table.series[0].standardDeviation = [0, 1]; }]) {
    const table = observations(); mutate(table); assert.throws(() => readDatasets([{ name: 'x', tables: [table] }]));
  }
  const data = { name: 'x', tables: [observations()] }; assert.throws(() => readDatasets([data, data]));
});
