import { populationLabel } from './model.js';

export const MAX_GRAPH_NODES = 140;
const ns = 'http://www.w3.org/2000/svg';
const svgNode = (tag, attributes = {}, text) => { const node = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value)); if (text !== undefined) node.textContent = text; return node; };
const htmlNode = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };

export function graphFor(model, focus = '', maximum = MAX_GRAPH_NODES) {
  const species = new Map(model.species.map(item => [item.id, item]));
  const nodes = new Map(), edges = [];
  const addSpecies = id => { if (!species.has(id)) throw new Error('The network refers to an unknown species.'); nodes.set(`s:${id}`, { id: `s:${id}`, kind: 'species', label: species.get(id).name || id, species: species.get(id) }); };
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
  if (!focus) for (const item of model.species) if (nodes.size < maximum) addSpecies(item.id);
  return { nodes: [...nodes.values()], edges, speciesCount: [...nodes.values()].filter(node => node.kind === 'species').length, reactionCount, totalSpecies: model.species.length, totalReactions: model.reactions.length, limited: omitted || (!focus && nodes.size < model.species.length + model.reactions.length), focus };
}

export function layoutGraph(graph) {
  const nodes = graph.nodes.map((node, index) => {
    const angle = index * 2.399963229728653, radius = Math.sqrt((index + 1) / Math.max(1, graph.nodes.length)) * 235;
    return { ...node, x: 500 + Math.cos(angle) * radius * 1.6, y: 320 + Math.sin(angle) * radius, dx: 0, dy: 0 };
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (let step = 0; step < 180; step++) {
    for (const node of nodes) { node.dx = (500 - node.x) * .003; node.dy = (320 - node.y) * .006; }
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      const first = nodes[a], second = nodes[b], dx = first.x - second.x, dy = first.y - second.y, square = Math.max(20, dx * dx + dy * dy), distance = Math.sqrt(square);
      const force = 2600 / square + Math.max(0, (first.kind === 'species' || second.kind === 'species' ? 85 : 40) - distance) * .07;
      first.dx += dx / distance * force; first.dy += dy / distance * force; second.dx -= dx / distance * force; second.dy -= dy / distance * force;
    }
    for (const edge of graph.edges) {
      const source = byId.get(edge.source), target = byId.get(edge.target), dx = target.x - source.x, dy = target.y - source.y, distance = Math.max(1, Math.hypot(dx, dy)), force = (distance - 130) * .014;
      source.dx += dx / distance * force; source.dy += dy / distance * force; target.dx -= dx / distance * force; target.dy -= dy / distance * force;
    }
    const speed = 1 - step / 220;
    for (const node of nodes) { node.x = Math.max(65, Math.min(935, node.x + Math.max(-12, Math.min(12, node.dx)) * speed)); node.y = Math.max(55, Math.min(585, node.y + Math.max(-12, Math.min(12, node.dy)) * speed)); }
  }
  return nodes;
}

export function edgeGeometry(edge, nodes, parallel = false) {
  const source = nodes.get(edge.source), target = nodes.get(edge.target);
  const dx = target.x - source.x, dy = target.y - source.y, distance = Math.max(1, Math.hypot(dx, dy));
  const r1 = source.kind === 'species' ? 30 : 12, r2 = target.kind === 'species' ? 30 : 12;
  const x1 = source.x + dx / distance * r1, y1 = source.y + dy / distance * r1, x2 = target.x - dx / distance * r2, y2 = target.y - dy / distance * r2;
  const bend = parallel ? 25 : 0, cx = (x1 + x2) / 2 - dy / distance * bend, cy = (y1 + y2) / 2 + dx / distance * bend;
  return { path: `M${x1.toFixed(2)} ${y1.toFixed(2)}Q${cx.toFixed(2)} ${cy.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`, x: .25 * x1 + .5 * cx + .25 * x2, y: .25 * y1 + .5 * cy + .25 * y2 };
}

export function fitView(nodes) {
  if (!nodes.length) return [0, 0, 1000, 640];
  const xs = nodes.map(node => node.x), ys = nodes.map(node => node.y), lowX = Math.min(...xs), highX = Math.max(...xs), lowY = Math.min(...ys), highY = Math.max(...ys);
  const width = Math.max(400, highX - lowX + 110, (highY - lowY + 100) * 1000 / 640), height = width * 640 / 1000;
  return [(lowX + highX - width) / 2, (lowY + highY - height) / 2, width, height];
}

export class ReactionNetwork {
  constructor(svg, details, caption) {
    this.svg = svg; this.details = details; this.caption = caption; this.view = [0, 0, 1000, 640]; this.model = null;
    let drag;
    svg.addEventListener('pointerdown', event => { if (event.button !== 0) return; drag = { x: event.clientX, y: event.clientY, view: [...this.view], moved: false, nodeId: event.target.closest('[data-node]')?.dataset.node }; svg.setPointerCapture(event.pointerId); });
    svg.addEventListener('pointermove', event => { if (!drag) return; const scale = drag.view[2] / svg.getBoundingClientRect().width; drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4; if (drag.moved) { this.view = [drag.view[0] - (event.clientX - drag.x) * scale, drag.view[1] - (event.clientY - drag.y) * scale, drag.view[2], drag.view[3]]; this.setView(); } });
    svg.addEventListener('pointerup', () => { const ended = drag; drag = null; if (ended && !ended.moved && ended.nodeId) this.select(ended.nodeId); });
    svg.addEventListener('pointercancel', () => { drag = null; });
    svg.addEventListener('wheel', event => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); this.zoom(event.deltaY > 0 ? 1.2 : 1 / 1.2); }, { passive: false });
    svg.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key) && event.target.dataset.node) { event.preventDefault(); this.select(event.target.dataset.node); } });
  }
  setView() { this.svg.setAttribute('viewBox', this.view.join(' ')); }
  zoom(factor) { const [x, y, width, height] = this.view, next = Math.max(200, Math.min(3000, width * factor)), ratio = next / width; this.view = [x + width * (1 - ratio) / 2, y + height * (1 - ratio) / 2, next, height * ratio]; this.setView(); }
  fit() { this.view = fitView(this.nodes || []); this.setView(); }
  render(model, focus = '') {
    if (this.model === model && this.focus === focus) return;
    this.model = model; this.focus = focus; this.graph = graphFor(model, focus); this.nodes = layoutGraph(this.graph); this.fit(); this.svg.replaceChildren(); this.details.replaceChildren();
    this.caption.textContent = `${this.graph.speciesCount} of ${this.graph.totalSpecies} species · ${this.graph.reactionCount} of ${this.graph.totalReactions} reactions${focus ? ' · one-hop neighbourhood' : ''}${this.graph.limited ? ' · overview limited; choose a species to explore' : ''}`;
    const definitions = svgNode('defs'), marker = svgNode('marker', { id: 'network-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' });
    marker.append(svgNode('path', { d: 'M0 1L9 5L0 9', fill: 'none', stroke: '#92a69b', 'stroke-width': 1.6 })); definitions.append(marker); this.svg.append(definitions, svgNode('title', {}, 'Strand displacement reaction network'));
    const byId = new Map(this.nodes.map(node => [node.id, node])), pairs = new Map();
    for (const edge of this.graph.edges) { const pair = [edge.source, edge.target].sort().join('\0'); pairs.set(pair, (pairs.get(pair) || 0) + 1); }
    for (const edge of this.graph.edges) {
      const geometry = edgeGeometry(edge, byId, pairs.get([edge.source, edge.target].sort().join('\0')) > 1), group = svgNode('g', { 'data-edge': edge.id });
      const path = svgNode('path', { d: geometry.path, fill: 'none', stroke: edge.role === 'catalysts' ? '#b39764' : '#aabcb1', 'stroke-width': 1.5, 'marker-end': 'url(#network-arrow)', ...(edge.reversible ? { 'marker-start': 'url(#network-arrow)' } : {}), ...(edge.role === 'catalysts' ? { 'stroke-dasharray': '5 4' } : {}) });
      path.append(svgNode('title', {}, `${edge.role} · multiplicity ${edge.multiplicity}${edge.reversible ? ' · reversible' : ''}`)); group.append(path);
      if (edge.multiplicity !== 1) group.append(svgNode('text', { x: geometry.x, y: geometry.y - 5, fill: '#6f8376', 'font-size': 12, 'text-anchor': 'middle' }, edge.multiplicity));
      this.svg.append(group);
    }
    for (const node of this.nodes) {
      const group = svgNode('g', { 'data-node': node.id, transform: `translate(${node.x.toFixed(2)} ${node.y.toFixed(2)})`, role: 'button', tabindex: 0, 'aria-label': `${node.kind === 'species' ? 'Species' : 'Reaction'} ${node.label}`, 'aria-pressed': 'false' });
      group.append(svgNode('title', {}, node.kind === 'species' ? node.species.structure : `Reaction ${node.index + 1}`));
      group.append(node.kind === 'species' ? svgNode('circle', { r: 29, fill: '#f1f8f3', stroke: '#a8c8b4', 'stroke-width': 1.5 }) : svgNode('rect', { x: -12, y: -12, width: 24, height: 24, rx: 4, fill: '#fff8ec', stroke: '#d9c39a', 'stroke-width': 1.5 }));
      group.append(svgNode('text', { x: node.kind === 'species' ? 0 : 21, y: 4, fill: '#456552', 'font-size': node.kind === 'species' ? 12 : 10, 'text-anchor': node.kind === 'species' ? 'middle' : 'start' }, node.label.length > 10 ? `${node.label.slice(0, 9)}…` : node.label)); this.svg.append(group);
    }
    this.details.append(htmlNode('p', 'Select a species or reaction to inspect it. Drag to pan; use the buttons or Ctrl + scroll to zoom.'));
  }
  select(id) {
    const node = this.nodes.find(item => item.id === id); if (!node) return;
    for (const group of this.svg.querySelectorAll('[data-node]')) { const selected = group.dataset.node === id; group.setAttribute('aria-pressed', String(selected)); group.classList.toggle('network-selected', selected); }
    this.details.replaceChildren(htmlNode('strong', node.kind === 'species' ? node.label : `Reaction ${node.index + 1}`));
    if (node.kind === 'species') {
      const item = node.species;
      if (item.svg) { const image = htmlNode('img'); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(item.svg)}`; image.alt = item.structure; this.details.append(image); }
      this.details.append(htmlNode('code', item.structure), htmlNode('p', populationLabel(item)));
    } else {
      const reaction = node.reaction;
      const side = values => values.map(item => `${item.multiplicity === 1 ? '' : `${item.multiplicity} `}${item.speciesId}`).join(' + ') || '∅';
      this.details.append(htmlNode('code', `${side(reaction.reactants)} ${reaction.reverseRate ? '⇌' : '→'} ${side(reaction.products)}`), htmlNode('p', `Rate: ${reaction.rate.expression}${reaction.reverseRate ? ` · reverse: ${reaction.reverseRate.expression}` : ''}`));
      if (reaction.catalysts.length) this.details.append(htmlNode('p', `Catalysts: ${side(reaction.catalysts)}`));
    }
  }
  exportSvg() {
    const [x, y, width, height] = fitView(this.nodes), scale = width / 1000;
    const copy = this.svg.cloneNode(true); copy.setAttribute('xmlns', ns); copy.setAttribute('viewBox', [x, y, width, height + 80 * scale].join(' ')); copy.setAttribute('width', '1000'); copy.setAttribute('height', '720');
    for (const node of copy.querySelectorAll('[tabindex]')) { node.removeAttribute('tabindex'); node.removeAttribute('role'); }
    copy.prepend(svgNode('rect', { x, y, width, height: height + 80 * scale, fill: '#fff' }));
    copy.append(svgNode('text', { x: x + 30 * scale, y: y + height + 35 * scale, fill: '#52715c', 'font-size': 14 * scale }, this.caption.textContent), svgNode('text', { x: x + 30 * scale, y: y + height + 60 * scale, fill: '#7d8d81', 'font-size': 12 * scale }, 'Circles: species · Squares: reactions · Dashed edges: catalysts · Double arrows: reversible'));
    return new XMLSerializer().serializeToString(copy);
  }
}
