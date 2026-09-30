// Render: resultado del layout -> texto SVG autocontenido (estilos en línea, listo para exportar).

const THEME = {
  background: "#ffffff",
  nodeFill: "#ffffff",
  nodeStroke: "#1f2328",
  nodeStrokeWidth: 1.5,
  text: "#1f2328",
  edge: "#1f2328",
  edgeWidth: 1.5,
  labelText: "#1f2328",
  labelBackground: "#ffffff",
  padding: 40,
};

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const fmt = (n) => Number(n.toFixed(2));

function renderSvg(layout, theme = THEME) {
  const { nodes, edges, bounds, options: opts } = layout;
  const pad = theme.padding;
  const x0 = bounds.minX - pad;
  const y0 = bounds.minY - pad;
  const width = bounds.maxX - bounds.minX + 2 * pad;
  const height = bounds.maxY - bounds.minY + 2 * pad;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x0)} ${fmt(y0)} ${fmt(width)} ${fmt(height)}" ` +
      `width="${fmt(width)}" height="${fmt(height)}" font-family="${escapeXml(opts.fontFamily)}" font-size="${opts.fontSize}">`
  );
  parts.push(
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" ` +
      `markerUnits="userSpaceOnUse" orient="auto-start-reverse">` +
      `<path d="M0,0 L10,5 L0,10 z" fill="${theme.edge}"/></marker></defs>`
  );
  parts.push(`<rect x="${fmt(x0)}" y="${fmt(y0)}" width="${fmt(width)}" height="${fmt(height)}" fill="${theme.background}"/>`);

  // Aristas debajo de los nodos, etiquetas encima de todo.
  parts.push(`<g class="edges">`);
  for (const e of edges) parts.push(renderEdge(e, theme));
  parts.push(`</g><g class="nodes">`);
  for (const n of nodes) parts.push(renderNode(n, theme, opts));
  parts.push(`</g><g class="labels">`);
  for (const e of edges) if (e.labelBox) parts.push(renderLabel(e, theme));
  parts.push(`</g></svg>`);
  return parts.join("\n");
}

function renderEdge(e, theme) {
  const [p, q] = e.points;
  const width = e.style === "thick" ? theme.edgeWidth * 2 : theme.edgeWidth;
  const dash = e.style === "dotted" ? ` stroke-dasharray="4 4"` : "";
  const start = e.arrowStart ? ` marker-start="url(#arrow)"` : "";
  const end = e.arrowEnd ? ` marker-end="url(#arrow)"` : "";
  return (
    `<line data-from="${escapeXml(e.from)}" data-to="${escapeXml(e.to)}" x1="${fmt(p.x)}" y1="${fmt(p.y)}" ` +
    `x2="${fmt(q.x)}" y2="${fmt(q.y)}" stroke="${theme.edge}" stroke-width="${width}"${dash}${start}${end}/>`
  );
}

function renderNode(n, theme, opts) {
  const style = `fill="${theme.nodeFill}" stroke="${theme.nodeStroke}" stroke-width="${theme.nodeStrokeWidth}"`;
  const hw = n.w / 2;
  const hh = n.h / 2;
  let shape;
  switch (n.shape) {
    case "circle":
      shape = `<circle cx="${fmt(n.x)}" cy="${fmt(n.y)}" r="${fmt(hw)}" ${style}/>`;
      break;
    case "diamond":
      shape =
        `<polygon points="${fmt(n.x)},${fmt(n.y - hh)} ${fmt(n.x + hw)},${fmt(n.y)} ` +
        `${fmt(n.x)},${fmt(n.y + hh)} ${fmt(n.x - hw)},${fmt(n.y)}" ${style}/>`;
      break;
    case "cylinder": {
      const ry = n.w * 0.12;
      const top = n.y - hh + ry;
      const bottom = n.y + hh - ry;
      const l = n.x - hw;
      const r = n.x + hw;
      shape =
        `<path d="M${fmt(l)},${fmt(top)} L${fmt(l)},${fmt(bottom)} A${fmt(hw)},${fmt(ry)} 0 0 0 ${fmt(r)},${fmt(bottom)} ` +
        `L${fmt(r)},${fmt(top)} A${fmt(hw)},${fmt(ry)} 0 0 0 ${fmt(l)},${fmt(top)} Z" ${style}/>` +
        `<path d="M${fmt(l)},${fmt(top)} A${fmt(hw)},${fmt(ry)} 0 0 0 ${fmt(r)},${fmt(top)}" fill="none" ` +
        `stroke="${theme.nodeStroke}" stroke-width="${theme.nodeStrokeWidth}"/>`;
      break;
    }
    default: {
      const rx = n.shape === "round" ? 12 : 2;
      shape = `<rect x="${fmt(n.x - hw)}" y="${fmt(n.y - hh)}" width="${fmt(n.w)}" height="${fmt(n.h)}" rx="${rx}" ${style}/>`;
    }
  }
  // En el cilindro el texto se centra en el cuerpo, bajo la tapa.
  const textY = n.shape === "cylinder" ? n.y + n.w * 0.06 : n.y;
  return `<g class="node" data-id="${escapeXml(n.id)}">${shape}${renderText(n.lines, n.x, textY, theme.text, opts)}</g>`;
}

function renderText(lines, x, y, color, opts) {
  const firstY = y - ((lines.length - 1) * opts.lineHeight) / 2;
  const spans = lines
    .map((l, i) => `<tspan x="${fmt(x)}" y="${fmt(firstY + i * opts.lineHeight)}">${escapeXml(l)}</tspan>`)
    .join("");
  return `<text text-anchor="middle" dominant-baseline="central" fill="${color}">${spans}</text>`;
}

function renderLabel(e, theme) {
  const b = e.labelBox;
  return (
    `<g class="label"><rect x="${fmt(b.x - b.w / 2)}" y="${fmt(b.y - b.h / 2)}" width="${fmt(b.w)}" height="${fmt(b.h)}" ` +
    `rx="3" fill="${theme.labelBackground}"/>` +
    `<text x="${fmt(b.x)}" y="${fmt(b.y)}" text-anchor="middle" dominant-baseline="central" fill="${theme.labelText}">` +
    `${escapeXml(e.label)}</text></g>`
  );
}

if (typeof module !== "undefined") module.exports = { renderSvg, THEME };
