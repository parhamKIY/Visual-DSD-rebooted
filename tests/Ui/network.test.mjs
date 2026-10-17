import test from 'node:test';
import assert from 'node:assert/strict';
import { graphFor, layoutGraph, edgeGeometry, fitView } from '../../src/VisualDsd.App/Web/network.js';
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

test('layout is deterministic and all rendered paths remain finite, including a species on both sides', () => {
  const graph = graphFor(model), first = layoutGraph(graph), second = layoutGraph(graph); assert.deepEqual(first, second);
  assert.ok(first.every(node => Number.isFinite(node.x) && Number.isFinite(node.y) && node.x >= 0 && node.x <= 1000 && node.y >= 0 && node.y <= 640));
  const nodes = new Map(first.map(node => [node.id, node]));
  for (const edge of graph.edges) assert.equal(/NaN|Infinity/.test(edgeGeometry(edge, nodes, true).path), false);
  assert.equal(layoutGraph(graphFor({ species: [], reactions: [] })).length, 0);
  const [x, y, width, height] = fitView(first);
  assert.ok(first.every(node => node.x > x && node.x < x + width && node.y > y && node.y < y + height));
  assert.deepEqual(fitView([]), [0, 0, 1000, 640]);
});


test('timed input entries do not create extra chemical species or disconnected graph nodes', () => {
  const withInput = { ...model, species: [...model.species, { id: 'initial:1:a', sourceId: 'a', name: 'a', initial: '3', time: '0.5', valueKind: 'timedInput' }] };
  const graph = graphFor(withInput);
  assert.equal(graph.totalSpecies, 4); assert.equal(graph.speciesCount, 4); assert.equal(graph.limited, false);
  assert.equal(graph.nodes.some(node => node.id === 's:initial:1:a'), false);
});
