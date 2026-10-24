import { numberLabel } from './model.js';

export const colors = ['#158779', '#c89245', '#6f87b9', '#b87991', '#8ca85e', '#b77854', '#70a8b2', '#9a8bb9', '#89978a', '#b99b79'];
const ns = 'http://www.w3.org/2000/svg';
const width = 800, height = 420, left = 65, right = 24, top = 24, bottom = 62;

export function extent(run, visible, observations) {
  let minimum = 0, maximum = 0;
  run.series.forEach((series, index) => { if (!visible || visible.has(index)) series.values.forEach((value, row) => { const deviation = series.standardDeviation?.[row] ?? 0; minimum = Math.min(minimum, value - deviation); maximum = Math.max(maximum, value + deviation); }); });
  observations?.series.forEach(column => { const index = run.series.findIndex(series => series.name === column.name); if (index >= 0 && (!visible || visible.has(index))) for (const value of column.values) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); } });
  if (minimum === maximum) maximum = minimum + 1;
  const padding = (maximum - minimum) * .08;
  const x0 = run.times[0] ?? 0, last = run.times.at(-1) ?? x0 + 1;
  return { x0, x1: last === x0 ? x0 + 1 : last, y0: minimum < 0 ? minimum - padding : 0, y1: maximum > 0 ? maximum + padding : 0 };
}

export function ticks(minimum, maximum, count = 5) {
  const range = maximum - minimum;
  if (!Number.isFinite(range) || range <= 0) return [minimum];
  const rough = range / count, power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power, step = (fraction >= 5 ? 5 : fraction >= 2 ? 2 : 1) * power;
  if (!(step > 0)) return [minimum, maximum];
  const result = [];
  for (let index = Math.ceil(minimum / step); index * step <= maximum + step * 1e-9 && result.length < 50; index++) result.push(index * step);
  return result;
}

export function sampledIndices(values, maximum = 1200) {
  if (values.length <= maximum) return Array.from({ length: values.length }, (_, index) => index);
  const indices = [0], size = Math.ceil((values.length - 2) / Math.max(1, Math.floor((maximum - 2) / 2)));
  for (let start = 1; start < values.length - 1; start += size) {
    let low = start, high = start;
    for (let index = start; index < Math.min(start + size, values.length - 1); index++) { if (values[index] < values[low]) low = index; if (values[index] > values[high]) high = index; }
    indices.push(...(low === high ? [low] : low < high ? [low, high] : [high, low]));
  }
  indices.push(values.length - 1);
  return indices;
}

export function nearestIndex(times, target) {
  if (!times.length) return -1;
  let low = 0, high = times.length - 1;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (times[middle] < target) low = middle + 1; else high = middle; }
  return low > 0 && Math.abs(times[low - 1] - target) < Math.abs(times[low] - target) ? low - 1 : low;
}

function svgElement(tag, attributes = {}, text) {
  const element = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

export class SimulationChart {
  constructor(svg, legend, tooltip, {onSelect} = {}) {
    this.svg = svg; this.legend = legend; this.tooltip = tooltip; this.run = null; this.visible = new Set(); this.index = 0;
    this.onSelect=onSelect;this.highlighted=null;
    svg.addEventListener('click',event=>{const index=event.target.closest('[data-series]')?.getAttribute('data-series');if(index!=null)this.onSelect?.(Number(index));});
    svg.addEventListener('pointermove', event => {
      if (!this.run?.times.length) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
      if (point.x < left || point.x > width - right || point.y < top || point.y > height - bottom) return this.hideCursor();
      const time = this.bounds.x0 + (point.x - left) / (width - left - right) * (this.bounds.x1 - this.bounds.x0);
      this.showCursor(nearestIndex(this.run.times, time));
    });
    svg.addEventListener('pointerleave', () => this.hideCursor());
    svg.addEventListener('blur', () => this.hideCursor());
    svg.addEventListener('keydown', event => {
      if (!this.run?.times.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      this.showCursor(event.key === 'Home' ? 0 : event.key === 'End' ? this.run.times.length - 1 : Math.max(0, Math.min(this.run.times.length - 1, this.index + (event.key === 'ArrowLeft' ? -1 : 1))));
    });
  }

  setRun(run, settings, observations = null) {
    this.run = run; this.settings = settings; this.observations = observations; this.index = 0;
    this.visible = new Set(run.series.map((_, index) => index));
    this.legend.replaceChildren();
    run.series.forEach((series, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-pressed', 'true'); button.title = series.name;
      button.dataset.series=String(index);
      const swatch = svgElement('svg', { width: 16, height: 8, 'aria-hidden': 'true' }); swatch.append(svgElement('line', { x1: 0, y1: 4, x2: 16, y2: 4, stroke: colors[index % colors.length], 'stroke-width': 3 }));
      button.append(swatch, document.createTextNode(`${series.name}${series.standardDeviation ? ' · mean ± 1 SD' : ''}`));
      button.addEventListener('click', () => { if(this.onSelect){this.onSelect(index);return;} if (this.visible.has(index)) this.visible.delete(index); else this.visible.add(index); button.setAttribute('aria-pressed', String(this.visible.has(index))); this.draw(); });
      this.legend.append(button);
    });
    this.draw();
  }

  highlight(indices=null){
    this.highlighted=indices?.length?new Set(indices):null;
    for(const path of this.svg.querySelectorAll('[data-series]')){const selected=!this.highlighted||this.highlighted.has(Number(path.getAttribute('data-series')));path.setAttribute('opacity',selected?'1':'.18');path.setAttribute('data-selected',String(Boolean(this.highlighted&&selected)));}
    if(this.onSelect)for(const button of this.legend.querySelectorAll('button')){const selected=Boolean(this.highlighted?.has(Number(button.dataset.series)));button.setAttribute('aria-pressed',String(selected));button.classList.toggle('linked-selected',selected);}
  }

  draw() {
    this.hideCursor();
    const svg = this.svg, run = this.run;
    svg.replaceChildren();
    if (!run?.times.length) return;
    const bounds = this.bounds = extent(run, this.visible, this.observations);
    const x = value => left + (value - bounds.x0) / (bounds.x1 - bounds.x0) * (width - left - right);
    const y = value => height - bottom - (value - bounds.y0) / (bounds.y1 - bounds.y0) * (height - top - bottom);
    this.x = x; this.y = y;
    const population = ['cme', 'cmesundials', 'lna', 'mc', 'ssa'].includes(this.settings.simulator);
    svg.append(svgElement('title', {}, population ? 'Population over time' : 'Concentration over time'), svgElement('rect', { x: 0, y: 0, width, height, fill: '#fff' }));
    for (const value of ticks(bounds.y0, bounds.y1)) { svg.append(svgElement('line', { x1: left, x2: width - right, y1: y(value), y2: y(value), class: 'chart-grid' }), svgElement('text', { x: left - 12, y: y(value) + 3, 'text-anchor': 'end', class: 'chart-label' }, numberLabel(value))); }
    for (const value of ticks(bounds.x0, bounds.x1)) { svg.append(svgElement('line', { x1: x(value), x2: x(value), y1: top, y2: height - bottom, class: 'chart-grid' }), svgElement('text', { x: x(value), y: height - bottom + 23, 'text-anchor': 'middle', class: 'chart-label' }, numberLabel(value))); }
    svg.append(svgElement('path', { d: `M${left} ${top}V${height - bottom}H${width - right}`, fill: 'none', class: 'chart-axis' }));
    svg.append(svgElement('text', { x: (width + left - right) / 2, y: height - 12, 'text-anchor': 'middle', class: 'chart-axis-title' }, `Time${this.settings.timeUnit ? ` (${this.settings.timeUnit})` : ''}`));
    svg.append(svgElement('text', { transform: `translate(16 ${(height - bottom + top) / 2}) rotate(-90)`, 'text-anchor': 'middle', class: 'chart-axis-title' }, population ? 'Population (molecules)' : `Concentration${this.settings.concentrationUnit ? ` (${this.settings.concentrationUnit})` : ''}`));
    run.series.forEach((series, index) => {
      if (!this.visible.has(index)) return;
      const indices = sampledIndices(series.values);
      if (series.standardDeviation) {
        const upper = series.values.map((value, row) => value + series.standardDeviation[row]), lower = series.values.map((value, row) => value - series.standardDeviation[row]);
        const bandIndices = [...new Set([...sampledIndices(upper), ...sampledIndices(lower)])].sort((a, b) => a - b);
        const edge = (points, values, first) => points.map((point, position) => `${first && position === 0 ? 'M' : 'L'}${x(run.times[point]).toFixed(3)} ${y(values[point]).toFixed(3)}`).join('');
        svg.append(svgElement('path', { d: `${edge(bandIndices, upper, true)}${edge([...bandIndices].reverse(), lower, false)}Z`, fill: colors[index % colors.length], 'fill-opacity': .13, 'data-uncertainty': index }));
      }
      const mode = series.mode ?? run.mode;
      const path = indices.map((point, position) => `${position ? mode==='step'?'H':'L' : 'M'}${x(run.times[point]).toFixed(3)}${position&&mode==='step'?'V':' '}${y(series.values[point]).toFixed(3)}`).join('');
      svg.append(svgElement('path', { d: path, stroke: colors[index % colors.length], class: 'chart-series', 'data-series': index }));
      if (run.times.length === 1) svg.append(svgElement('circle', { cx: x(run.times[0]), cy: y(series.values[0]), r: 3, fill: colors[index % colors.length] }));
      const observed = this.observations?.series.find(column => column.name === series.name);
      if (observed) this.observations.times.forEach((time, row) => svg.append(svgElement('circle', { cx: x(time), cy: y(observed.values[row]), r: 3.5, fill: '#fff', stroke: colors[index % colors.length], 'stroke-width': 1.7, 'data-observation': index })));
    });
    this.cursor = svgElement('g', { visibility: 'hidden', 'aria-hidden': 'true' }); svg.append(this.cursor);
    this.highlight(this.highlighted?[...this.highlighted]:null);
  }

  showCursor(index) {
    if (index < 0 || !this.cursor) return;
    this.index = index;
    this.cursor.replaceChildren(svgElement('line', { x1: this.x(this.run.times[index]), x2: this.x(this.run.times[index]), y1: top, y2: height - bottom, class: 'chart-cursor' }));
    this.cursor.setAttribute('visibility', 'visible');
    const title = document.createElement('strong'); title.textContent = `Time ${numberLabel(this.run.times[index])}`;
    this.tooltip.replaceChildren(title);
    this.run.series.forEach((series, seriesIndex) => {
      if (!this.visible.has(seriesIndex)) return;
      this.cursor.append(svgElement('circle', { cx: this.x(this.run.times[index]), cy: this.y(series.values[index]), r: 3, fill: colors[seriesIndex % colors.length], stroke: '#fff', 'stroke-width': 1.5 }));
      const row = document.createElement('div'), name = document.createElement('span'), value = document.createElement('span');
      name.className = 'tooltip-name'; name.textContent = series.name; value.textContent = `${numberLabel(series.values[index])}${series.standardDeviation ? ` ± ${numberLabel(series.standardDeviation[index])} SD` : ''}`; row.append(name, value); this.tooltip.append(row);
    });
    this.tooltip.hidden = false;
  }

  hideCursor() { this.tooltip.hidden = true; this.cursor?.setAttribute('visibility', 'hidden'); }

  exportSvg() {
    const copy = this.svg.cloneNode(true);
    const visible = this.run.series.map((series, index) => ({ ...series, index })).filter(series => this.visible.has(series.index));
    const exportHeight = height + visible.length * 20 + 20;
    copy.setAttribute('xmlns', ns); copy.setAttribute('width', String(width)); copy.setAttribute('height', String(exportHeight)); copy.setAttribute('viewBox', `0 0 ${width} ${exportHeight}`);
    copy.querySelector('rect')?.setAttribute('height', String(exportHeight));
    copy.removeAttribute('tabindex'); copy.removeAttribute('aria-label');
    copy.querySelector('[aria-hidden="true"]')?.remove();
    const style = svgElement('style', {}, '.chart-grid{stroke:#e9eeeb;stroke-width:1;stroke-dasharray:3 4}.chart-axis{stroke:#d8e1dd;stroke-width:1}.chart-label{fill:#829589;font:10px sans-serif}.chart-axis-title{fill:#677d6e;font:10px sans-serif}.chart-series{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}');
    copy.prepend(style);
    visible.forEach((series, index) => {
      const y = height + index * 20 + 6;
      copy.append(svgElement('line', { x1: left, x2: left + 18, y1: y, y2: y, stroke: colors[series.index % colors.length], 'stroke-width': 3 }), svgElement('text', { x: left + 28, y: y + 4, fill: '#536e5c', 'font-family': 'sans-serif', 'font-size': 11 }, `${series.name}${series.standardDeviation ? ' · mean ± 1 SD' : ''}${this.observations ? ' · circles: observations' : ''}`));
    });
    return new XMLSerializer().serializeToString(copy);
  }
}
