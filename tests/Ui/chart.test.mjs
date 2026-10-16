import test from 'node:test';
import assert from 'node:assert/strict';
import { extent, ticks, sampledIndices, nearestIndex } from '../../src/VisualDsd.App/Web/chart.js';

test('plot bounds preserve negative concentrations and are finite for empty or flat data', () => {
  for (const run of [{ times: [], series: [] }, { times: [5], series: [{ values: [0] }] }]) {
    const bounds = extent(run); assert.ok(Object.values(bounds).every(Number.isFinite)); assert.ok(bounds.x1 > bounds.x0); assert.ok(bounds.y1 > bounds.y0);
  }
  const run = { times: [0, 10], series: [{ values: [-3, 4] }, { values: [100, 150] }] };
  const bounds = extent(run, new Set([0]));
  assert.ok(bounds.y0 < -3); assert.ok(bounds.y1 > 4); assert.ok(bounds.y1 < 100);
});

test('chart downsampling retains endpoints and narrow positive and negative peaks', () => {
  const values = Array(100000).fill(0); values[33333] = 100; values[33334] = -90;
  const sampled = sampledIndices(values);
  assert.equal(sampled[0], 0); assert.equal(sampled.at(-1), values.length - 1);
  assert.ok(sampled.includes(33333)); assert.ok(sampled.includes(33334)); assert.ok(sampled.length <= 1200);
  assert.ok(sampled.every((value, index) => index === 0 || value > sampled[index - 1]));
});

test('cursor finds actual nearest samples without interpolating values', () => {
  assert.equal(nearestIndex([], 1), -1);
  assert.equal(nearestIndex([0, 2, 10], 1.9), 1);
  assert.equal(nearestIndex([0, 2, 10], -5), 0);
  assert.equal(nearestIndex([0, 2, 10], 100), 2);
});

test('tick generation handles negative, very small and large ranges', () => {
  for (const [low, high] of [[-10, 4], [0, 1e-12], [1e6, 7e6], [0, 1]]) {
    const values = ticks(low, high); assert.ok(values.length >= 2 && values.length < 50);
    assert.ok(values.every(value => Number.isFinite(value) && value >= low && value <= high + (high - low) * 1e-9));
  }
});
