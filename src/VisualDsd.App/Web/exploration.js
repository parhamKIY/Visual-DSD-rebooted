import { csvFor, numberLabel } from './model.js';

export function shortestPath(graph, target) {
  const previous = new Map([[graph.initialState, null]]), queue = [graph.initialState];
  const edges = new Map();
  for (const edge of graph.transitions) { if (!edges.has(edge.source)) edges.set(edge.source, []); edges.get(edge.source).push(edge.target); }
  for (let i = 0; i < queue.length && !previous.has(target); i++) for (const next of edges.get(queue[i]) || []) if (!previous.has(next)) { previous.set(next, queue[i]); queue.push(next); }
  if (!previous.has(target)) return [];
  const path = []; for (let at = target; at !== null; at = previous.get(at)) path.push(at);
  return path.reverse();
}

export function stateSummary(graph) {
  const sources = new Set(graph.transitions.map(edge => edge.source));
  return { absorbing: graph.states.map((_, i) => i).filter(i => !sources.has(i)), ranges: graph.speciesIds.map((id, i) => ({ id, min: Math.min(...graph.states.map(row => row[i])), max: Math.max(...graph.states.map(row => row[i])) })) };
}

export function spatialCsv(run, timeUnit) {
  const grid = run.spatial, cells = grid.x.length * (grid.y.length || 1), times = run.times.flatMap(time => Array(cells).fill(time));
  const x = [], y = [];
  for (const _ of run.times) for (const coordinate of grid.x) for (const second of grid.y.length ? grid.y : [null]) { x.push(coordinate); if (second !== null) y.push(second); }
  return csvFor({ times, series: [{ name: 'x (model units)', values: x }, ...(y.length ? [{ name: 'y (model units)', values: y }] : []), ...grid.series.map(series => ({ name: series.name, values: series.frames.flat() }))] }, timeUnit);
}

export function statesCsv(graph, network) {
  const names = new Map(network.species.map(species => [species.id, species.structure || species.name || species.id]));
  return csvFor({ times: graph.states.map((_, i) => i), series: graph.speciesIds.map((id, index) => ({ name: names.get(id) || id, values: graph.states.map(row => row[index]) })) }).replace(/^Time(?=,|\r?\n)/, 'State');
}

export function spatialScale(series) {
  let min = Infinity, max = -Infinity;
  for (const frame of series.frames) for (const value of frame) { min = Math.min(min, value); max = Math.max(max, value); }
  return { min, max };
}

// Reduce only the display; CSV and saved results retain every original grid value.
export function spatialHeatmapRows(run, series, maximumCells = 20000) {
  const count = Math.min(run.times.length, Math.max(1, Math.floor(maximumCells / run.spatial.x.length)));
  return Array.from({ length: count }, (_, i) => {
    const start = Math.floor(i * run.times.length / count), end = Math.floor((i + 1) * run.times.length / count);
    const values = Array(run.spatial.x.length).fill(0);
    for (let t = start; t < end; t++) series.frames[t].forEach((v, j) => { values[j] += v / (end - start); });
    return { start, end, values };
  });
}

export function drawSpatial(svg, run, seriesIndex, frameIndex, settings) {
  const grid = run.spatial, series = grid.series[seriesIndex], frame = series.frames[frameIndex], { min, max } = spatialScale(series);
  const make = (tag, attributes = {}, text) => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); if (text !== undefined) node.textContent = text; return node; };
  svg.replaceChildren(); svg.setAttribute('viewBox', '0 0 800 480');
  svg.setAttribute('aria-label', `${grid.dimensions}D concentration map of ${series.name}, time ${numberLabel(run.times[frameIndex])} ${settings.timeUnit}. Color range ${numberLabel(min)} to ${numberLabel(max)} ${settings.concentrationUnit}.`);
  svg.append(make('rect', { width: 800, height: 480, fill: '#ffffff' }));
  const color = value => { const t = max === min ? .5 : (value - min) / (max - min); return `rgb(${Math.round(238 - 224 * t)},${Math.round(247 - 137 * t)},${Math.round(244 - 144 * t)})`; };
  const label = (x, y, text, extra = {}) => svg.append(make('text', { x, y, fill: '#52626b', 'font-size': 12, 'font-family': 'sans-serif', ...extra }, text));
  const cell = (x, y, width, height, value, title) => { const rect = make('rect', { x, y, width: width + .1, height: height + .1, fill: color(value) }); rect.append(make('title', {}, title)); svg.append(rect); };
  label(55, 24, `${series.name} · t = ${numberLabel(run.times[frameIndex])} ${settings.timeUnit}`);
  if (grid.dimensions === 2) {
    const width = 330 / grid.x.length, height = 330 / grid.y.length;
    for (let x = 0; x < grid.x.length; x++) for (let y = 0; y < grid.y.length; y++) { const value = frame[x * grid.y.length + y]; cell(160 + x * width, 50 + (grid.y.length - 1 - y) * height, width, height, value, `x=${grid.x[x]}, y=${grid.y[y]}, value=${value}`); }
    label(115, 60, numberLabel(grid.y.at(-1))); label(130, 380, numberLabel(grid.y[0])); label(105, 215, 'y');
  } else {
    const width = 540 / grid.x.length, rows = spatialHeatmapRows(run, series);
    const timeY = t => 310 - 260 * (run.times.at(-1) === run.times[0] ? .5 : (t - run.times[0]) / (run.times.at(-1) - run.times[0]));
    for (const [i, row] of rows.entries()) {
      const top = i === rows.length - 1 ? 50 : timeY((run.times[row.end - 1] + run.times[row.end]) / 2);
      const bottom = i === 0 ? 310 : timeY((run.times[row.start - 1] + run.times[row.start]) / 2);
      for (let x = 0; x < grid.x.length; x++) cell(70 + x * width, top, width, bottom - top, row.values[x], `t=${run.times[row.start]}..${run.times[row.end - 1]}, x=${grid.x[x]}, mean value=${row.values[x]}`);
    }
    svg.append(make('path', { d: `M69 ${timeY(run.times[frameIndex])}h542`, stroke: '#d65b31', 'stroke-width': 2, fill: 'none', 'pointer-events': 'none' }));
    label(12, 60, numberLabel(run.times.at(-1))); label(12, 310, numberLabel(run.times[0])); label(12, 180, settings.timeUnit);
    const path = frame.map((value, i) => `${i ? 'L' : 'M'}${70 + i * 540 / (frame.length - 1)} ${380 - (max === min ? .5 : (value - min) / (max - min)) * 55}`).join('');
    svg.append(make('path', { d: path, stroke: '#0b6e63', 'stroke-width': 2, fill: 'none' }));
    label(630, 355, 'Selected time'); label(630, 375, 'spatial profile');
  }
  const left = grid.dimensions === 2 ? 160 : 70, right = grid.dimensions === 2 ? 490 : 610;
  label(left, 404, numberLabel(grid.x[0])); label(right, 404, numberLabel(grid.x.at(-1)), { 'text-anchor': 'end' }); label((left + right) / 2, 425, 'x (model units)', { 'text-anchor': 'middle' });
  for (let i = 0; i < 80; i++) cell(660, 75 + (79 - i) * 3, 18, 3, min + (max - min) * i / 79, 'Color scale');
  label(688, 83, numberLabel(max)); label(688, 315, numberLabel(min)); label(650, 340, settings.concentrationUnit);
  label(70, 455, `${grid.boundary} boundary · grid ${grid.x.length}${grid.y.length ? ` × ${grid.y.length}` : ''} · dt = ${numberLabel(grid.dt)} · fixed color scale over time`);
}
