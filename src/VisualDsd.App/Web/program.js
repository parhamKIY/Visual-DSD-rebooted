import { escapeHtml } from './model.js';

export const locationLabel = location => `${location.nodeId || 'Model'}${location.systemId ? ` · ${location.systemId}` : ''}`;

export function programSvg(program) {
  const pending = new Set(program.nodes.map(node => node.id)), positions = new Map();
  let level = 0, rows = 1;
  while (pending.size) {
    const roots = [...pending].filter(id => program.edges.every(edge => edge.target.nodeId !== id || !pending.has(edge.source.nodeId)));
    if (!roots.length) throw new Error('Model links contain a cycle.');
    roots.forEach((id, row) => { positions.set(id, { x: 24 + level * 240, y: 24 + row * 100 }); pending.delete(id); });
    rows = Math.max(rows, roots.length); level++;
  }
  const edges = program.edges.map(edge => {
    const from = positions.get(edge.source.nodeId), to = positions.get(edge.target.nodeId);
    if (!from || !to) throw new Error('A model link has an unknown endpoint.');
    const title = `${locationLabel(edge.source)} → ${locationLabel(edge.target)}: ${edge.parameters.map(p => `${p.sourceParameter} → ${p.targetParameter} (${p.kind})`).join(', ')}`;
    return `<path d="M${from.x + 180} ${from.y + 30} C${from.x + 210} ${from.y + 30} ${to.x - 30} ${to.y + 30} ${to.x} ${to.y + 30}" fill="none" stroke="#89a89a" marker-end="url(#program-arrow)"><title>${escapeHtml(title)}</title></path>`;
  }).join('');
  const nodes = program.nodes.map(node => {
    const { x, y } = positions.get(node.id), selected = node.id === program.selectedNodeId;
    const title = node.id || 'Model', count = node.systems.filter(system => system.id).length;
    return `<g><title>${escapeHtml(title)}</title><rect x="${x}" y="${y}" width="180" height="62" rx="8" fill="${selected ? '#e0f1e9' : '#f6f9f7'}" stroke="${selected ? '#0b6e63' : '#cdded4'}"/><text x="${x + 12}" y="${y + 25}" font-size="13" fill="#173f32">${escapeHtml(title.slice(0, 22))}</text><text x="${x + 12}" y="${y + 45}" font-size="10" fill="#647d70">${count ? `${count} system${count === 1 ? '' : 's'}` : 'Top-level network'}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(240, level * 240)} ${rows * 100}" role="img" aria-label="Model dependency graph"><defs><marker id="program-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#89a89a"/></marker></defs>${edges}${nodes}</svg>`;
}
