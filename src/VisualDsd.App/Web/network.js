import { populationLabel, rateLabel } from './model.js';

const ns = 'http://www.w3.org/2000/svg';
const svgNode = (tag, attributes = {}, text) => { const node = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value)); if (text !== undefined) node.textContent = text; return node; };
const htmlNode = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
const populated = item => item.initial != null && String(item.initial).trim() !== '' && Number(item.initial) !== 0;
const defaults = { direction: 'down', routing: 'sugiyamasplines', labels: 'molecules', rates: true };

export function graphFor(model, focus = '', maximum = Infinity) {
  const canonicalSpecies = model.species.filter(item => !item.sourceId);
  const species = new Map(canonicalSpecies.map(item => [item.id, item]));
  const initial = new Set(model.species.filter(populated).map(item => item.sourceId || item.id));
  const nodes = new Map(), edges = [];
  const addSpecies = id => {
    if (!species.has(id)) throw new Error('The network refers to an unknown species.');
    if (!nodes.has(`s:${id}`)) nodes.set(`s:${id}`, { id: `s:${id}`, kind: 'species', label: species.get(id).name || id, species: species.get(id), initial: initial.has(id) });
  };
  if (focus && species.has(focus)) addSpecies(focus);
  let reactionCount = 0, omitted = false;
  model.reactions.forEach((reaction, index) => {
    const participants = [...reaction.reactants, ...reaction.products, ...reaction.catalysts];
    if (focus && !participants.some(item => item.speciesId === focus)) return;
    const needed = new Set(participants.map(item => `s:${item.speciesId}`).filter(id => !nodes.has(id)));
    if (nodes.size + needed.size + 1 > maximum) { omitted = true; return; }
    for (const item of participants) addSpecies(item.speciesId);
    const id = `r:${index}`;
    nodes.set(id, { id, kind: 'reaction', label: `r${index + 1}`, reaction, index }); reactionCount++;
    for (const role of ['reactants', 'products', 'catalysts']) for (const participant of reaction[role]) {
      const source = role === 'products' ? id : `s:${participant.speciesId}`, target = role === 'products' ? `s:${participant.speciesId}` : id;
      edges.push({ id: `e:${edges.length}`, source, target, multiplicity: participant.multiplicity, role, reversible: role !== 'catalysts' && Boolean(reaction.reverseRate) });
    }
  });
  if (!focus) for (const item of canonicalSpecies) if (nodes.size < maximum || nodes.has(`s:${item.id}`)) addSpecies(item.id);
  return { nodes: [...nodes.values()], edges, speciesCount: [...nodes.values()].filter(node => node.kind === 'species').length, reactionCount, totalSpecies: canonicalSpecies.length, totalReactions: model.reactions.length, limited: omitted || (!focus && nodes.size < canonicalSpecies.length + model.reactions.length), focus };
}

export function svgDimensions(source) {
  const root = String(source || '').match(/<svg\b[^>]*>/i)?.[0] || '';
  const attribute = name => root.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
  const view = attribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const valid = value => Number.isFinite(value) && value > 0 && value <= 1e6;
  const dimension = name => { const raw = attribute(name); return raw && /^\d*\.?\d+(?:px)?$/.test(raw) ? Number.parseFloat(raw) : NaN; };
  const width = dimension('width'), height = dimension('height');
  if (valid(width) && valid(height)) return { width, height };
  if (view?.length === 4 && view.every(Number.isFinite) && valid(view[2]) && valid(view[3])) return { width: view[2], height: view[3] };
  return { width: 160, height: 48 };
}

export function nodeContent(node, settings = {}, measure = (text, size) => [...String(text)].length * size * .62) {
  const options = { ...defaults, ...settings };
  if (node.kind === 'reaction') {
    const lines = options.rates ? [rateLabel(node.reaction.rate.expression), ...(node.reaction.reverseRate ? [rateLabel(node.reaction.reverseRate.expression)] : [])] : [];
    return { lines, width: Math.max(10, ...lines.map(text => measure(text, 12))) + 10, height: Math.max(12, lines.length * 16 + 6), fontSize: 12 };
  }
  const graphic = options.labels === 'molecules' && node.species.svg ? svgDimensions(node.species.svg) : null;
  const lines = options.labels === 'structure' ? [node.species.structure || node.label, node.label] : [node.label];
  return { graphic, lines, width: Math.max(48, graphic?.width || 0, ...lines.map(text => measure(text, 14))) + 20, height: (graphic?.height || 0) + lines.length * 20 + 16, fontSize: 14 };
}

// The original viewer's graph/boundary protocol. MSAGL performs crossing
// reduction, obstacle-aware routing and label placement in an offline worker.
export function geometryFor(graph, settings = {}, measure) {
  const options = { ...defaults, ...settings };
  const nodes = graph.nodes.map(node => {
    const content = nodeContent(node, options, measure);
    return { id: node.id, label: { content: '', bounds: { x: 0, y: 0, width: content.width - 10, height: content.height - 10 } },
      shape: { shape: 'rect', radiusX: node.kind === 'species' ? 3 : 0, radiusY: node.kind === 'species' ? 3 : 0 },
      boundaryCurve: { curvetype: 'RoundedRect', bounds: { x: 0, y: 0, width: content.width, height: content.height }, radiusX: 3, radiusY: 3 } };
  });
  const arrow = { closed: true, fill: true };
  return { nodes, edges: graph.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target,
    ...(edge.role === 'products' ? { arrowHeadAtTarget: arrow } : {}),
    ...(edge.role === 'reactants' && edge.reversible ? { arrowHeadAtSource: arrow } : {}),
    ...(edge.role === 'catalysts' ? { arrowHeadAtTarget: { style: 'diamond', fill: true } } : {}),
    ...(edge.multiplicity !== 1 ? { label: { content: String(edge.multiplicity), bounds: { x: 0, y: 0, width: String(edge.multiplicity).length * 8 + 4, height: 16 } } } : {}) })),
    settings: { layout: 'sugiyama', routing: options.routing, transformation: options.direction === 'right' ? { m00: 0, m01: -1, m02: 0, m10: 1, m11: 0, m12: 0 } : { m00: -1, m01: 0, m02: 0, m10: 0, m11: -1, m12: 0 }, aspectRatio: 0, upDownConstraints: [] } };
}

const point = p => `${p.x} ${p.y}`;
export function curvePath(curve, continuous = false) {
  if (!curve) throw new Error('The layout engine returned an edge without a route.');
  switch (curve.curvetype) {
    case 'SegmentedCurve': return curve.segments.map((part, i) => curvePath(part, continuous || i > 0)).join(' ');
    case 'Line': return `${continuous ? 'L' : 'M'}${point(curve.start)} L${point(curve.end)}`;
    case 'Bezier': return `${continuous ? 'L' : 'M'}${point(curve.start)} C${point(curve.p1)} ${point(curve.p2)} ${point(curve.p3)}`;
    case 'Polyline': return `${continuous ? 'L' : 'M'}${point(curve.start)} ${curve.points.map(p => `L${point(p)}`).join(' ')}${curve.closed ? ' Z' : ''}`;
    case 'Ellipse': {
      const { axisA: a, axisB: b, center: c, parStart: start, parEnd: end } = curve;
      if (Math.abs(end - start) > Math.PI * 1.99) { const middle = (start + end) / 2; return curvePath({ ...curve, parEnd: middle }, continuous) + ' ' + curvePath({ ...curve, parStart: middle }, true); }
      const at = t => ({ x: c.x + a.x * Math.cos(t) + b.x * Math.sin(t), y: c.y + a.y * Math.cos(t) + b.y * Math.sin(t) });
      return `${continuous ? 'L' : 'M'}${point(at(start))} A${Math.hypot(a.x, a.y)} ${Math.hypot(b.x, b.y)} ${Math.atan2(a.y, a.x) * 180 / Math.PI} ${Math.abs(end - start) > Math.PI ? 1 : 0} ${(a.x * b.y - a.y * b.x) * (end - start) > 0 ? 1 : 0} ${point(at(end))}`;
    }
    default: throw new Error(`Unsupported network curve: ${curve.curvetype}`);
  }
}

export function fitView(nodes, aspect = 1000 / 640, bounds) {
  if (!nodes.length) return [0, 0, 1000, 640];
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const node of nodes) { const b = node.boundaryCurve?.bounds || { x: node.x - node.width / 2, y: node.y - node.height / 2, width: node.width, height: node.height }; left = Math.min(left, b.x); top = Math.min(top, b.y); right = Math.max(right, b.x + b.width); bottom = Math.max(bottom, b.y + b.height); }
  if (bounds) { left = Math.min(left, bounds.x); top = Math.min(top, bounds.y); right = Math.max(right, bounds.x + bounds.width); bottom = Math.max(bottom, bounds.y + bounds.height); }
  const width = Math.max(160, right - left + 48, (bottom - top + 48) * aspect), height = width / aspect;
  return [(left + right - width) / 2, (top + bottom - height) / 2, width, height];
}

export function zoomView(view, factor, anchor = { x: view[0] + view[2] / 2, y: view[1] + view[3] / 2 }) {
  const ratio = Math.max(32, Math.min(1e9, view[2] * factor)) / view[2];
  return [anchor.x + (view[0] - anchor.x) * ratio, anchor.y + (view[1] - anchor.y) * ratio, view[2] * ratio, view[3] * ratio];
}

export class ReactionNetwork {
  constructor(svg, details, caption) {
    this.svg = svg; this.details = details; this.caption = caption; this.view = [0, 0, 1000, 640]; this.options = { ...defaults }; this.generation = 0; this.ready = false;
    const context = document.createElement('canvas').getContext('2d');
    this.measure = (text, size) => { context.font = `${size}px Verdana, Arial, sans-serif`; return context.measureText(String(text)).width; };
    let drag;
    const position = event => new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    svg.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !this.ready) return;
      const nodeId = event.target.closest('[data-node]')?.dataset.node;
      drag = { x: event.clientX, y: event.clientY, start: position(event), view: [...this.view], moved: false, nodeId, edit: this.editing && Boolean(nodeId) };
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove', event => {
      if (!drag) return;
      drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4;
      if (!drag.moved) return;
      if (drag.edit) { const p = position(event); drag.delta = { x: p.x - drag.start.x, y: p.y - drag.start.y }; this.nodeGroups.get(drag.nodeId)?.setAttribute('transform', `translate(${drag.delta.x} ${drag.delta.y})`); }
      else { const scale = 1 / svg.getScreenCTM().a; this.view = [drag.view[0] - (event.clientX - drag.x) * scale, drag.view[1] - (event.clientY - drag.y) * scale, drag.view[2], drag.view[3]]; this.fitted = false; this.setView(); }
    });
    svg.addEventListener('pointerup', () => { const ended = drag; drag = null; if (ended?.edit && ended.moved) this.moveNode(ended.nodeId, ended.delta); else if (ended && !ended.moved && ended.nodeId) this.select(ended.nodeId); });
    svg.addEventListener('pointercancel', () => { if (drag?.edit) this.draw(); drag = null; });
    svg.addEventListener('wheel', event => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); this.zoom(event.deltaY > 0 ? 1.2 : 1 / 1.2, position(event)); }, { passive: false });
    svg.addEventListener('keydown', event => {
      if (['Enter', ' '].includes(event.key) && event.target.dataset.node) { event.preventDefault(); this.select(event.target.dataset.node); }
      else if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); this.zoom(event.key === '-' ? 1.3 : 1 / 1.3); }
      else if (event.key === 'Home') { event.preventDefault(); this.fit(); }
      else if (event.key === 'Escape') this.select(null);
    });
    new ResizeObserver(() => { const rect = svg.getBoundingClientRect(); if (rect.width <= 0 || rect.height <= 0) return; if (this.fitted) this.fit(); else { const h = this.view[2] * rect.height / rect.width; this.view[1] += (this.view[3] - h) / 2; this.view[3] = h; this.setView(); } }).observe(svg);
  }
  setView() { this.svg.setAttribute('viewBox', this.view.join(' ')); this.onChange?.(); }
  zoom(factor, anchor) { this.fitted = false; this.view = zoomView(this.view, factor, anchor); this.setView(); }
  zoomPercent(value) { if (Number.isFinite(value) && value > 0) this.zoom(this.zoomLevel / value); }
  get zoomLevel() { return (this.svg.getBoundingClientRect().width || 1000) / this.view[2] * 100; }
  fit() { const rect = this.svg.getBoundingClientRect(); this.fitted = true; this.view = fitView(this.geometry?.nodes || [], rect.width && rect.height ? rect.width / rect.height : 1000 / 640, this.geometry?.boundingBox); this.setView(); }
  setOptions(options) { this.options = { ...this.options, ...options }; return this.render(this.model, this.focus, true); }
  async render(model, focus = '', force = false) {
    if (!model || (!force && this.model === model && this.focus === focus && (this.ready || this.worker))) return;
    this.model = model; this.focus = focus; this.graph = graphFor(model, focus); this.geometry = null; this.ready = false; this.selected = null;
    this.svg.replaceChildren(); this.details.replaceChildren();
    this.caption.textContent = `Laying out ${this.graph.speciesCount} species · ${this.graph.reactionCount} reactions…`;
    this.onChange?.();
    const generation = ++this.generation;
    try {
      const result = await this.layout(geometryFor(this.graph, this.options, this.measure));
      if (generation !== this.generation) return;
      this.geometry = result; this.ready = true; this.draw(); this.fit(); this.describe();
    } catch (error) { if (generation === this.generation) { this.ready = false; this.caption.textContent = `Network layout failed: ${error.message}. Try another routing option.`; this.onChange?.(); } }
  }
  layout(geometry, msgtype = 'RunLayout') {
    this.cancelLayout?.();
    if (!geometry.nodes.length) return Promise.resolve(geometry);
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./msagl.worker.js', import.meta.url));
      let timer, finished = false;
      const finish = (error, result) => { if (finished) return; finished = true; clearTimeout(timer); worker.terminate(); if (this.worker === worker) { this.worker = null; this.cancelLayout = null; } error ? reject(error) : resolve(result); };
      this.worker = worker; this.cancelLayout = () => finish(new Error('Layout superseded'));
      timer = setTimeout(() => finish(new Error('Layout exceeded two minutes; use Focus to explore a neighbourhood')), 120000);
      worker.onerror = event => finish(new Error(event.message || 'The offline layout worker could not start'));
      worker.onmessage = event => { if (event.data.msgtype === 'Error') finish(new Error(String(event.data.error))); else { try { finish(null, JSON.parse(event.data.graph)); } catch (error) { finish(error); } } };
      worker.postMessage({ msgtype, graph: JSON.stringify(geometry) });
    });
  }
  describe() {
    const g = this.graph;
    this.caption.textContent = `${g.speciesCount} of ${g.totalSpecies} species · ${g.reactionCount} of ${g.totalReactions} reactions · ${this.focus ? 'one-hop neighbourhood' : 'complete network'} · ${this.options.direction === 'right' ? 'left to right' : 'top to bottom'}`;
    this.onChange?.();
  }
  draw() {
    if (!this.geometry) return;
    this.svg.replaceChildren(svgNode('title', {}, 'Visual DSD molecular reaction network'));
    this.svg.append(svgNode('desc', {}, 'Rectangles contain molecular strand diagrams and species names. Bold borders mark initial populations. Reaction boxes show forward and reverse rates. Diamonds mark catalysts.'));
    this.nodeGroups = new Map(); this.edgeGroups = new Map();
    const graphNodes = new Map(this.graph.nodes.map(node => [node.id, node]));
    const graphEdges = new Map(this.graph.edges.map(edge => [edge.id, edge]));
    const edgesLayer = svgNode('g', { 'data-layer': 'edges' });
    for (const geometry of this.geometry.edges) {
      const edge = graphEdges.get(geometry.id), group = svgNode('g', { 'data-edge': edge.id });
      const color = edge.role === 'catalysts' ? '#96713a' : '#727b83';
      const path = svgNode('path', { d: curvePath(geometry.curve), fill: 'none', stroke: color, 'stroke-width': 1.15, ...(edge.role === 'catalysts' ? { 'stroke-dasharray': '5 3' } : {}) });
      group.append(svgNode('title', {}, `${edge.role} · multiplicity ${edge.multiplicity}${edge.reversible ? ' · reversible' : ''}`), path);
      for (const arrow of [geometry.arrowHeadAtSource, geometry.arrowHeadAtTarget].filter(Boolean)) {
        const dx = arrow.end.x - arrow.start.x, dy = arrow.end.y - arrow.start.y, distance = Math.hypot(dx, dy) || 1, w = Math.min(4, distance * .4), px = -dy / distance * w, py = dx / distance * w;
        const sides = [`${arrow.start.x + px},${arrow.start.y + py}`, `${arrow.start.x - px},${arrow.start.y - py}`];
        const points = arrow.style === 'diamond' ? [point(arrow.end).replace(' ', ','), sides[0], `${arrow.start.x - dx},${arrow.start.y - dy}`, sides[1]] : [point(arrow.end).replace(' ', ','), ...sides];
        group.append(svgNode('polygon', { points: points.join(' '), fill: color, stroke: color, 'stroke-width': .6 }));
      }
      if (geometry.label) { const b = geometry.label.bounds; group.append(svgNode('rect', { x: b.x - 2, y: b.y - 1, width: b.width + 4, height: b.height + 2, fill: '#fff' }), svgNode('text', { x: b.x + b.width / 2, y: b.y + 12, 'text-anchor': 'middle', 'font-family': 'Verdana, Arial, sans-serif', 'font-size': 12, fill: '#34404b' }, geometry.label.content)); }
      edgesLayer.append(group); this.edgeGroups.set(edge.id, group);
    }
    this.svg.append(edgesLayer);
    for (const geometry of this.geometry.nodes) {
      const node = graphNodes.get(geometry.id), b = geometry.boundaryCurve.bounds, content = nodeContent(node, this.options, this.measure);
      const group = svgNode('g', { 'data-node': node.id, role: 'button', tabindex: 0, 'aria-label': `${node.kind === 'species' ? 'Species' : 'Reaction'} ${node.label}`, 'aria-pressed': 'false' });
      group.append(svgNode('title', {}, node.kind === 'species' ? `${node.label}\n${node.species.structure}\n${populationLabel(node.species)}` : `Reaction ${node.index + 1}\nForward: ${rateLabel(node.reaction.rate.expression)}${node.reaction.reverseRate ? `\nReverse: ${rateLabel(node.reaction.reverseRate.expression)}` : ''}`));
      group.append(svgNode('rect', { x: b.x, y: b.y, width: b.width, height: b.height, rx: node.kind === 'species' ? 3 : 1, fill: '#fff', stroke: node.kind === 'species' ? node.initial ? '#16232d' : '#9aa4ac' : '#aab2ba', 'stroke-width': node.initial ? 2.3 : .9 }));
      let y = b.y + (node.kind === 'species' ? 8 : 3);
      if (content.graphic) {
        // SVG image documents are inert. Imported projects cannot inject scripts
        // or styles; original domain colours and vectors survive SVG export.
        group.append(svgNode('image', { x: b.x + (b.width - content.graphic.width) / 2, y, width: content.graphic.width, height: content.graphic.height, href: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(node.species.svg)}`, 'pointer-events': 'none' }));
        y += content.graphic.height + 4;
      }
      for (const line of content.lines) { group.append(svgNode('text', { x: b.x + b.width / 2, y: y + content.fontSize, 'text-anchor': 'middle', 'font-family': 'Verdana, Arial, sans-serif', 'font-size': content.fontSize, fill: '#24323e', 'pointer-events': 'none' }, line)); y += node.kind === 'species' ? 20 : 16; }
      this.svg.append(group); this.nodeGroups.set(node.id, group);
    }
    this.select(this.selected);
  }
  select(id) {
    this.selected = id;
    const node = this.graph?.nodes.find(item => item.id === id), neighbours = new Set(node ? [id] : []), incident = new Set();
    if (node) {
      // Highlight entire incident reactions, including their other participants.
      const reactions = new Set(node.kind === 'reaction' ? [id] : this.graph.edges.filter(edge => edge.source === id || edge.target === id).map(edge => edge.source.startsWith('r:') ? edge.source : edge.target));
      for (const edge of this.graph.edges) if (reactions.has(edge.source) || reactions.has(edge.target)) { neighbours.add(edge.source); neighbours.add(edge.target); incident.add(edge.id); }
    }
    for (const [key, group] of this.nodeGroups || []) { group.setAttribute('aria-pressed', String(key === id)); group.classList.toggle('network-selected', key === id); group.classList.toggle('network-muted', Boolean(node) && !neighbours.has(key)); }
    for (const [key, group] of this.edgeGroups || []) group.classList.toggle('network-muted', Boolean(node) && !incident.has(key));
    this.details.replaceChildren();
    if (!node) { this.details.append(htmlNode('p', 'Select a molecule or rate box to inspect a reaction. Drag to pan; Ctrl + scroll zooms at the pointer. Use Expand for a larger workspace, or enable Edit to move nodes.')); return; }
    this.details.append(htmlNode('strong', node.kind === 'species' ? node.label : `Reaction ${node.index + 1}`));
    if (node.kind === 'species') {
      const item = node.species;
      if (item.svg) { const image = htmlNode('img'); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(item.svg)}`; image.alt = item.structure; this.details.append(image); }
      this.details.append(htmlNode('code', item.structure), htmlNode('p', populationLabel(item)));
    } else {
      const reaction = node.reaction, names = new Map(this.graph.nodes.filter(n => n.kind === 'species').map(n => [n.species.id, n.label]));
      const side = values => values.map(item => `${item.multiplicity === 1 ? '' : `${item.multiplicity} `}${names.get(item.speciesId) || item.speciesId}`).join(' + ') || '∅';
      this.details.append(htmlNode('code', `${side(reaction.reactants)} ${reaction.reverseRate ? '⇌' : '→'} ${side(reaction.products)}`), htmlNode('p', `Forward rate: ${rateLabel(reaction.rate.expression)}${reaction.reverseRate ? ` · reverse rate: ${rateLabel(reaction.reverseRate.expression)}` : ''}`));
      if (reaction.catalysts.length) this.details.append(htmlNode('p', `Catalysts: ${side(reaction.catalysts)}`));
    }
  }
  async moveNode(id, delta) {
    if (!delta) return;
    const original = this.geometry, moved = structuredClone(original), node = moved.nodes.find(item => item.id === id);
    node.boundaryCurve.bounds.x += delta.x; node.boundaryCurve.bounds.y += delta.y;
    if (node.label) { node.label.bounds.x += delta.x; node.label.bounds.y += delta.y; }
    const generation = ++this.generation; this.ready = false; this.onChange?.();
    try { const result = await this.layout(moved, 'RouteEdges'); if (generation !== this.generation) return; this.geometry = result; this.ready = true; this.draw(); this.describe(); }
    catch (error) { if (generation === this.generation) { this.geometry = original; this.ready = true; this.draw(); this.caption.textContent = `Could not reroute the moved node: ${error.message}`; this.onChange?.(); } }
  }
  exportSvg() {
    if (!this.ready) throw new Error('Wait for the complete network layout before exporting.');
    const bounds = this.geometry.boundingBox, box = bounds || { x: 0, y: 0, width: 1000, height: 640 };
    const [x, y, width, height] = fitView(this.geometry.nodes, Math.max(.1, Math.max(760, box.width + 48) / (box.height + 48)), bounds);
    const copy = this.svg.cloneNode(true); copy.setAttribute('xmlns', ns); copy.setAttribute('viewBox', [x, y, width, height + 52].join(' ')); copy.setAttribute('width', String(Math.ceil(width))); copy.setAttribute('height', String(Math.ceil(height + 52)));
    copy.removeAttribute('class'); copy.removeAttribute('tabindex'); copy.removeAttribute('aria-busy');
    for (const node of copy.querySelectorAll('[data-node], [data-edge]')) { for (const attribute of ['tabindex', 'role', 'aria-label', 'aria-pressed', 'class']) node.removeAttribute(attribute); }
    copy.prepend(svgNode('rect', { x, y, width, height: height + 52, fill: '#fff' }));
    copy.append(svgNode('text', { x: x + 16, y: y + height + 18, fill: '#34404b', 'font-family': 'Verdana, Arial, sans-serif', 'font-size': 13 }, this.caption.textContent), svgNode('text', { x: x + 16, y: y + height + 38, fill: '#596773', 'font-family': 'Verdana, Arial, sans-serif', 'font-size': 11 }, 'Molecular diagrams: species · Bold border: initial population · Rate boxes: reactions · Diamonds: catalysts'));
    return new XMLSerializer().serializeToString(copy);
  }
}
