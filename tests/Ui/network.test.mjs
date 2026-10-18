import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { ReactionNetwork, graphFor, geometryFor, curvePath, fitView, nodeContent, svgDimensions, zoomView } from '../../src/VisualDsd.App/Web/network.js';

const web = new URL('../../src/VisualDsd.App/Web/', import.meta.url);
let listener, answer;
const context = vm.createContext({ console, setTimeout, clearTimeout, navigator: { userAgent: 'Node.js' } }, { codeGeneration: { strings: false, wasm: false } });
context.self = context;
context.addEventListener = (_, callback) => { listener = callback; };
context.postMessage = value => { answer = value; };
context.importScripts = name => vm.runInContext(readFileSync(new URL(name, web), 'utf8'), context);
vm.runInContext(readFileSync(new URL('msagl.worker.js', web), 'utf8'), context);
function layout(graph, options = {}, msgtype = 'RunLayout') {
  answer = null;
  listener({ data: { msgtype, graph: JSON.stringify(graph.nodes[0]?.boundaryCurve ? graph : geometryFor(graph, options)) } });
  assert.equal(answer?.msgtype, msgtype, answer?.error);
  return JSON.parse(answer.graph);
}
const model = { species: ['a', 'b', 'c', 'r:0'].map(id => ({ id, name: id, structure: `<${id}>` })), reactions: [
  { reactants: [{ speciesId: 'a', multiplicity: 2 }], products: [{ speciesId: 'b', multiplicity: 1 }], catalysts: [{ speciesId: 'c', multiplicity: 1 }], rate: { expression: 'k' }, reverseRate: { expression: 'u' } },
  { reactants: [{ speciesId: 'b', multiplicity: 1 }], products: [{ speciesId: 'b', multiplicity: 1 }], catalysts: [], rate: { expression: '1' }, reverseRate: null }
] };

test('bipartite graph preserves catalysts, reversibility, multiplicity and isolated species without identifier collisions', () => {
  const graph = graphFor(model);
  assert.equal(graph.speciesCount, 4); assert.equal(graph.reactionCount, 2); assert.equal(graph.nodes.length, 6); assert.equal(graph.edges.length, 5);
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, 6);
  const reactant = graph.edges.find(edge => edge.source === 's:a'); assert.equal(reactant.multiplicity, 2); assert.equal(reactant.reversible, true);
  const catalyst = graph.edges.find(edge => edge.source === 's:c'); assert.equal(catalyst.role, 'catalysts'); assert.equal(catalyst.reversible, false);
  assert.equal(graph.limited, false);
});

test('focus shows the actual incident reactions and their full participants', () => {
  const graph = graphFor(model, 'a'); assert.equal(graph.reactionCount, 1); assert.equal(graph.speciesCount, 3); assert.equal(graph.edges.length, 3);
  const isolated = graphFor(model, 'r:0'); assert.equal(isolated.speciesCount, 1); assert.equal(isolated.reactionCount, 0);
});

test('large network overviews are explicitly bounded and never leave dangling edges', () => {
  const graph = graphFor(model, '', 4); assert.equal(graph.nodes.length, 4); assert.equal(graph.limited, true);
  const ids = new Set(graph.nodes.map(node => node.id)); assert.ok(graph.edges.every(edge => ids.has(edge.source) && ids.has(edge.target)));
  assert.equal(graphFor(model, 'b', 3).limited, true);
});

test('original MSAGL lays out cycles deterministically without string compilation or nonfinite routes', () => {
  const graph = graphFor(model), first = layout(graph), second = layout(graph); assert.deepEqual(first, second);
  for (const edge of first.edges) assert.equal(/NaN|Infinity/.test(curvePath(edge.curve)), false);
  const [x, y, width, height] = fitView(first.nodes, 1.4, first.boundingBox);
  assert.ok(first.nodes.every(node => { const b = node.boundaryCurve.bounds; return b.x > x && b.x + b.width < x + width && b.y > y && b.y + b.height < y + height; }));
  assert.deepEqual(fitView([]), [0, 0, 1000, 640]);
});


test('timed input entries do not create extra chemical species or disconnected graph nodes', () => {
  const withInput = { ...model, species: [...model.species, { id: 'initial:1:a', sourceId: 'a', name: 'a', initial: '3', time: '0.5', valueKind: 'timedInput' }] };
  const graph = graphFor(withInput);
  assert.equal(graph.totalSpecies, 4); assert.equal(graph.speciesCount, 4); assert.equal(graph.limited, false);
  assert.equal(graph.nodes.some(node => node.id === 's:initial:1:a'), false);
});

test('complete 252-species / 134-reaction networks retain every molecule, reaction and isolated species with nonoverlapping boundaries', () => {
  const large = { species: Array.from({ length: 252 }, (_, i) => ({ id: `m${i}`, name: `molecule_${i}`, svg: '<svg width="180" height="45" xmlns="http://www.w3.org/2000/svg"/>' })),
    reactions: Array.from({ length: 134 }, (_, i) => ({ reactants: [{ speciesId: `m${Math.floor(i / 2)}`, multiplicity: 1 }], products: [{ speciesId: `m${i + 1}`, multiplicity: 1 }], catalysts: [], rate: { expression: '0.000015' } })) };
  const graph = graphFor(large); assert.equal(graph.speciesCount, 252); assert.equal(graph.reactionCount, 134); assert.equal(graph.limited, false);
  const result = layout(graph); assert.equal(result.nodes.length, 386); assert.equal(result.edges.length, 268);
  for (let i = 0; i < result.nodes.length; i++) {
    const a = result.nodes[i].boundaryCurve.bounds;
    for (const other of result.nodes.slice(i + 1)) { const b = other.boundaryCurve.bounds; assert.ok(a.x + a.width <= b.x + .01 || b.x + b.width <= a.x + .01 || a.y + a.height <= b.y + .01 || b.y + b.height <= a.y + .01, `${result.nodes[i].id} overlaps ${other.id}`); }
  }
  assert.ok(result.edges.every(edge => !/NaN|Infinity/.test(curvePath(edge.curve))));
});

test('rate boxes, original molecular dimensions and full names determine real layout boundaries', () => {
  const node = { kind: 'species', label: 'a_name_that_must_never_be_truncated', species: { svg: '<svg width="700.5" height="84"/>', structure: '<a b c>' } };
  const content = nodeContent(node); assert.equal(content.graphic.width, 700.5); assert.equal(content.width, 720.5); assert.deepEqual(content.lines, [node.label]);
  assert.equal(nodeContent(node, { labels: 'names' }).graphic, null);
  assert.deepEqual(nodeContent(node, { labels: 'structure' }).lines, ['<a b c>', node.label]);
  const reaction = graphFor(model).nodes.find(n => n.kind === 'reaction');
  assert.deepEqual(nodeContent(reaction).lines, ['k', 'u']);
  assert.deepEqual(nodeContent(reaction, { rates: false }).lines, []);
  assert.ok(geometryFor(graphFor(model), { rates: false }).nodes.every(n => n.label.bounds.height >= 0));
});

test('SVG dimensions support viewBox and pixel dimensions and reject invalid/unbounded sizes', () => {
  assert.deepEqual(svgDimensions('<svg width="220px" height="50px"/>'), { width: 220, height: 50 });
  assert.deepEqual(svgDimensions("<svg width='100%' viewBox='-2 4 300 75'/>"), { width: 300, height: 75 });
  for (const svg of ['', '<svg width="NaN" height="-5"/>', '<svg viewBox="0 0 1e300 50"/>']) assert.deepEqual(svgDimensions(svg), { width: 160, height: 48 });
});

test('original routing modes, horizontal layouts, multiplicity and catalyst/reverse arrow semantics survive the worker', () => {
  for (const routing of ['sugiyamasplines', 'splines', 'splinesbundling', 'rectilinear', 'straightline']) {
    const result = layout(graphFor(model), { routing, direction: 'right' });
    assert.equal(result.nodes.length, 6); assert.equal(result.edges.length, 5);
    for (const edge of result.edges) assert.ok(curvePath(edge.curve));
    assert.equal(result.edges[0].label.content, '2');
    assert.ok(result.edges[0].arrowHeadAtSource); assert.equal(result.edges[0].arrowHeadAtTarget, undefined);
    assert.ok(result.edges[1].arrowHeadAtTarget); assert.equal(result.edges[1].arrowHeadAtSource, undefined);
    assert.equal(result.edges[2].arrowHeadAtTarget.style, 'diamond');
  }
});

test('source/sink reactions and disconnected species receive valid boundaries and curves', () => {
  const fixture = { species: [{ id: 'a' }, { id: 'isolated' }], reactions: [
    { reactants: [], products: [{ speciesId: 'a', multiplicity: 1 }], catalysts: [], rate: { expression: 'k' } },
    { reactants: [{ speciesId: 'a', multiplicity: 1 }], products: [], catalysts: [], rate: { expression: 'u' } }
  ] };
  const result = layout(graphFor(fixture)); assert.equal(result.nodes.length, 4); assert.equal(result.edges.length, 2);
  assert.ok(result.edges.every(edge => curvePath(edge.curve)));
});

test('moving a molecular node reroutes all its connections with the original router', () => {
  const geometry = layout(graphFor(model)); const moved = geometry.nodes[0];
  moved.boundaryCurve.bounds.x += 200; moved.boundaryCurve.bounds.y -= 100;
  moved.label.bounds.x += 200; moved.label.bounds.y -= 100;
  const result = layout(geometry, {}, 'RouteEdges');
  assert.equal(result.edges.length, geometry.edges.length); assert.deepEqual(result.nodes[0].boundaryCurve.bounds, moved.boundaryCurve.bounds);
  assert.ok(result.edges.every(edge => curvePath(edge.curve)));
});

test('zoom preserves the pointer anchor, supports full large graphs and retains viewport aspect', () => {
  const start = [-400, -900, 16000, 8000], anchor = { x: 300, y: 450 }, next = zoomView(start, .5, anchor);
  assert.equal(next[2] / next[3], 2); assert.equal((anchor.x - start[0]) / start[2], (anchor.x - next[0]) / next[2]);
  assert.deepEqual(zoomView(next, 2, anchor), start);
});

test('MSAGL vendored bundles match recorded provenance and require no dynamic evaluation', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../eng/msagl-sources.json', import.meta.url), 'utf8'));
  for (const [name, hash] of Object.entries(manifest.bundles)) {
    const source = readFileSync(new URL(name, web)); assert.equal(createHash('sha256').update(source).digest('hex'), hash);
    assert.equal(/\beval\s*\(|new Function\s*\(/.test(source.toString()), false);
  }
});

test('stale asynchronous layouts cannot overwrite a newer model and failed layouts can be retried', async () => {
  const pending = [];
  const viewer = Object.assign(Object.create(ReactionNetwork.prototype), {
    svg: { replaceChildren() {} }, details: { replaceChildren() {} }, caption: {}, options: {}, generation: 0,
    layout: geometry => new Promise((resolve, reject) => pending.push({ resolve, reject, geometry })), draw() {}, fit() {}, describe() {}
  });
  const first = viewer.render(model, 'a'), second = viewer.render(model, 'b');
  assert.equal(viewer.ready, false); pending[1].resolve(pending[1].geometry); await second;
  assert.equal(viewer.ready, true); const result = viewer.geometry;
  pending[0].resolve(pending[0].geometry); await first; assert.equal(viewer.geometry, result); assert.equal(viewer.focus, 'b');
  const failed = viewer.render(model, 'c'); pending[2].reject(new Error('test failure')); await failed;
  assert.equal(viewer.ready, false); assert.match(viewer.caption.textContent, /test failure/);
  const retry = viewer.render(model, 'c'); pending[3].resolve(pending[3].geometry); await retry; assert.equal(viewer.ready, true);
});
