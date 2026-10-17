import { numberLabel } from './model.js';

export function marginal(run, speciesIndex) {
  const data = run.probabilities;
  if (!data || !Number.isInteger(speciesIndex) || speciesIndex < 0 || speciesIndex >= data.speciesIds.length) throw new Error('Select a probability species.');
  const counts = [...new Set(data.states.map(state => state[speciesIndex]))].sort((a, b) => a - b);
  const locations = new Map(counts.map((count, i) => [count, i]));
  const probabilities = data.mass.map(row => {
    const bins = Array(counts.length).fill(0);
    row.forEach((p, i) => { bins[locations.get(data.states[i][speciesIndex])] += p; });
    return bins;
  });
  return { counts, probabilities };
}

export function probabilityCsv(run, speciesIndex, timeUnit = 's') {
  const { counts, probabilities } = marginal(run, speciesIndex);
  const header = `Time (${timeUnit})`.replaceAll('"', '""');
  return `"${header}",Copy number,Probability\r\n` + probabilities.flatMap((row, t) => row.map((p, i) => `${run.times[t]},${counts[i]},${p}`)).join('\r\n') + '\r\n';
}

export function heatmapBuckets(run, map, maximumCells = 20000) {
  const count = Math.min(run.times.length, 160, Math.max(1, Math.floor(maximumCells / map.counts.length)));
  return Array.from({ length: count }, (_, i) => {
    const start = Math.floor(i * run.times.length / count), end = Math.floor((i + 1) * run.times.length / count);
    const mean = Array(map.counts.length).fill(0);
    for (let t = start; t < end; t++) map.probabilities[t].forEach((p, j) => { mean[j] += p / (end - start); });
    return { start, end, mean };
  });
}

export function drawProbabilities(svg, run, speciesIndex, frameIndex, logarithmic, timeUnit = 's') {
  const map = marginal(run, speciesIndex), buckets = heatmapBuckets(run, map), name = run.probabilities.speciesIds[speciesIndex];
  const make = (tag, attrs = {}, text) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) e.setAttribute(key, value); if (text !== undefined) e.textContent = text; return e; };
  svg.replaceChildren(); svg.setAttribute('viewBox', '0 0 900 510');
  svg.setAttribute('aria-label', `Probability map for ${name}, ${map.counts.length} reachable copy numbers. Selected time ${run.times[frameIndex]} ${timeUnit}.`);
  svg.append(make('rect', { width: 900, height: 510, fill: 'white' }));
  const label = (x, y, text, extra = {}) => svg.append(make('text', { x, y, fill: '#52626b', 'font-size': 12, 'font-family': 'sans-serif', ...extra }, text));
  const cell = (x, y, w, h, p, title) => {
    const level = logarithmic ? (p <= 0 ? 0 : Math.max(0, 1 + Math.log10(p) / 12)) : p;
    const rect = make('rect', { x, y, width: w + .1, height: h + .1, fill: `rgb(${Math.round(247 - 236 * level)},${Math.round(250 - 140 * level)},${Math.round(249 - 150 * level)})` });
    rect.append(make('title', {}, title)); svg.append(rect);
  };
  const top = 55, height = 320, rowHeight = height / map.counts.length;
  const timeX = t => 70 + 500 * (run.times.at(-1) === run.times[0] ? .5 : (t - run.times[0]) / (run.times.at(-1) - run.times[0]));
  for (const [i, bucket] of buckets.entries()) {
    const left = i === 0 ? 70 : timeX((run.times[bucket.start - 1] + run.times[bucket.start]) / 2);
    const right = i === buckets.length - 1 ? 570 : timeX((run.times[bucket.end - 1] + run.times[bucket.end]) / 2);
    bucket.mean.forEach((p, j) => cell(left, top + (map.counts.length - 1 - j) * rowHeight, right - left, rowHeight, p,
      `t=${run.times[bucket.start]}..${run.times[bucket.end - 1]}, count=${map.counts[j]}, mean probability=${p}`));
  }
  svg.append(make('path', { d: `M${timeX(run.times[frameIndex])} ${top}v${height}`, stroke: '#d65b31', 'stroke-width': 2, 'stroke-dasharray': '4 3' }));
  const selected = map.probabilities[frameIndex];
  selected.forEach((p, j) => {
    const rect = make('rect', { x: 680, y: top + (map.counts.length - 1 - j) * rowHeight, width: p * 160, height: Math.max(.1, rowHeight - .3), fill: '#0b6e63' });
    rect.append(make('title', {}, `count=${map.counts[j]}, probability=${p}`)); svg.append(rect);
  });
  for (let i = 0; i < Math.min(8, map.counts.length); i++) {
    const j = Math.round(i * (map.counts.length - 1) / Math.max(1, Math.min(8, map.counts.length) - 1));
    label(60, top + (map.counts.length - j - .5) * rowHeight + 4, String(map.counts[j]), { 'text-anchor': 'end' });
    label(670, top + (map.counts.length - j - .5) * rowHeight + 4, String(map.counts[j]), { 'text-anchor': 'end' });
  }
  label(70, 30, `${name} · probability over time`); label(650, 30, `Distribution at t=${numberLabel(run.times[frameIndex])} ${timeUnit}`);
  label(70, 399, numberLabel(run.times[0])); label(570, 399, numberLabel(run.times.at(-1)), { 'text-anchor': 'end' });
  label(300, 420, `Time (${timeUnit})`); label(680, 399, '0'); label(840, 399, '1', { 'text-anchor': 'end' }); label(710, 420, 'Probability');
  label(70, 445, 'Copy number · reachable populations only; other counts have probability zero.');
  label(70, 468, logarithmic ? 'Log color scale: 10⁻¹² to 1; zero is white.' : 'Linear color scale: 0 to 1.');
  label(70, 490, buckets.length < run.times.length ? 'Heatmap averages adjacent samples for display; selected bars and CSV retain exact samples.' : 'Every output time is shown. Selected bars retain exact samples.');
}
