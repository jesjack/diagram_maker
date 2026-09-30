// Render: resultado del layout -> texto SVG autocontenido (estilos en línea, listo para exportar).

const THEME = {
  background: null, // null = transparente: el diagrama se funde con el fondo del visor
  nodeFill: "#ffffff",
  nodeStroke: "#1f2328",
  nodeStrokeWidth: 1.5,
  text: "#1f2328",
  edge: "#1f2328",
  edgeWidth: 1.5,
  labelText: "#1f2328",
  labelBackground: "#ffffff",
  title: "#656d76", // título de cada subgraph, encima de su diagrama
  refDash: "5 3", // borde de los nodos de referencia a otro diagrama
  padding: 40,
  // Sombra difuminada bajo todas las formas. null = sin sombra.
  shadow: { dx: 0, dy: 1, blur: 1.5, color: "#000000", opacity: 0.18 },
};

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const fmt = (n) => Number(n.toFixed(2));

// Área del SVG: la caja del layout más el margen.
function frame(layout, theme) {
  const { bounds } = layout;
  const pad = theme.padding;
  const x0 = bounds.minX - pad;
  const y0 = bounds.minY - pad;
  const width = bounds.maxX - bounds.minX + 2 * pad;
  const height = bounds.maxY - bounds.minY + 2 * pad;
  const open = (attrs = "") =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x0)} ${fmt(y0)} ${fmt(width)} ${fmt(height)}" ` +
    `width="${fmt(width)}" height="${fmt(height)}"${attrs}>`;
  return { x0, y0, width, height, open };
}

// Con { shadow: false } se omite la sombra: el visor la dibuja aparte (ver renderShadowSvg).
function renderSvg(layout, theme = THEME, { shadow = true } = {}) {
  const { nodes, edges, options: opts } = layout;
  const f = frame(layout, theme);

  const parts = [];
  parts.push(f.open(` font-family="${escapeXml(opts.fontFamily)}" font-size="${opts.fontSize}"`));
  parts.push(
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" ` +
      `markerUnits="userSpaceOnUse" orient="auto-start-reverse">` +
      `<path d="M0,0 L10,5 L0,10 z" fill="${theme.edge}"/></marker>` +
      (theme.shadow && shadow ? shadowFilter(f, theme.shadow) : "") +
      `</defs>`
  );
  if (theme.background) {
    parts.push(`<rect x="${fmt(f.x0)}" y="${fmt(f.y0)}" width="${fmt(f.width)}" height="${fmt(f.height)}" fill="${theme.background}"/>`);
  }

  if (theme.shadow && shadow) parts.push(renderShadows(layout, theme));

  // Aristas debajo de los nodos, etiquetas encima de todo.
  parts.push(`<g class="edges">`);
  for (const e of edges) parts.push(renderEdge(e, theme));
  parts.push(`</g><g class="nodes">`);
  for (const n of nodes) parts.push(renderNode(n, theme, opts));
  parts.push(`</g><g class="labels">`);
  for (const e of edges) if (e.labelBox) parts.push(renderLabel(e, theme));
  parts.push(`</g>`);
  if (layout.titles && layout.titles.length) {
    parts.push(`<g class="titles">`);
    for (const t of layout.titles) {
      parts.push(
        `<text x="${fmt(t.x)}" y="${fmt(t.y)}" dominant-baseline="central" font-weight="600" fill="${theme.title}">` +
          `${escapeXml(t.text)}</text>`
      );
    }
    parts.push(`</g>`);
  }
  parts.push(`</svg>`);
  return parts.join("\n");
}

// Solo la sombra, como SVG del mismo tamaño que el diagrama. El visor la pinta una vez en un
// mapa de bits y la pone debajo del SVG sin sombra: un filtro de desenfoque dentro del SVG se
// recalcula en cada repintado y con zoom alto hacía caer los fps; el mapa de bits solo se escala
// (al ser difusa no se nota la pérdida de resolución).
function renderShadowSvg(layout, theme = THEME) {
  const f = frame(layout, theme);
  return `${f.open()}<defs>${shadowFilter(f, theme.shadow)}</defs>${renderShadows(layout, theme)}</svg>`;
}

// Región del filtro en coordenadas del diagrama: con la predeterminada (relativa a la caja del
// elemento) una línea recta horizontal o vertical tiene alto o ancho 0 y desaparece.
function shadowFilter(f, sh) {
  return (
    `<filter id="shadow" filterUnits="userSpaceOnUse" x="${fmt(f.x0)}" y="${fmt(f.y0)}" ` +
    `width="${fmt(f.width)}" height="${fmt(f.height)}"><feGaussianBlur stdDeviation="${sh.blur}"/></filter>`
  );
}

// Copia de todas las formas en el color de la sombra, desplazada y difuminada. Va en un solo
// grupo debajo del resto, así nunca tapa una línea o un nodo.
function renderShadows({ nodes, edges }, theme) {
  const sh = theme.shadow;
  const edgeTheme = { ...theme, edge: sh.color };
  const style = `fill="${sh.color}" stroke="${sh.color}" stroke-width="${theme.nodeStrokeWidth}"`;
  const parts = [
    `<g class="shadows" transform="translate(${sh.dx} ${sh.dy})" opacity="${sh.opacity}" filter="url(#shadow)">`,
  ];
  for (const e of edges) parts.push(renderEdge({ ...e, arrowStart: false, arrowEnd: false }, edgeTheme));
  for (const n of nodes) parts.push(nodeShape(n, style, sh.color, theme.nodeStrokeWidth));
  for (const e of edges) {
    if (!e.labelBox) continue;
    const b = e.labelBox;
    parts.push(`<rect x="${fmt(b.x - b.w / 2)}" y="${fmt(b.y - b.h / 2)}" width="${fmt(b.w)}" height="${fmt(b.h)}" rx="3" ${style}/>`);
  }
  parts.push(`</g>`);
  return parts.join("");
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
  const dash = n.ref && !n.absorbed ? ` stroke-dasharray="${theme.refDash}"` : "";
  const style = `fill="${theme.nodeFill}" stroke="${theme.nodeStroke}" stroke-width="${theme.nodeStrokeWidth}"${dash}`;
  const shape = nodeShape(n, style, theme.nodeStroke, theme.nodeStrokeWidth);
  // En el cilindro el texto se centra en el cuerpo, bajo la tapa.
  const textY = n.shape === "cylinder" ? n.y + n.w * 0.06 : n.y;
  return `<g class="node" data-id="${escapeXml(n.id)}">${shape}${renderText(n.lines, n.x, textY, theme.text, opts)}</g>`;
}

function nodeShape(n, style, stroke, strokeWidth) {
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
    case "parallelogram":
    case "parallelogram-alt": {
      const l = n.x - hw;
      const r = n.x + hw;
      const t = n.y - hh;
      const b = n.y + hh;
      const k = n.skew;
      // parallelogram = [/ /] (inclinado a la derecha); alt = [\ \] (a la izquierda).
      const pts =
        n.shape === "parallelogram"
          ? [[l + k, t], [r, t], [r - k, b], [l, b]]
          : [[l, t], [r - k, t], [r, b], [l + k, b]];
      shape = `<polygon points="${pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ")}" ${style}/>`;
      break;
    }
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
        `stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
      break;
    }
    default: {
      const rx = n.shape === "stadium" ? hh : n.shape === "round" ? 12 : 2;
      shape = `<rect x="${fmt(n.x - hw)}" y="${fmt(n.y - hh)}" width="${fmt(n.w)}" height="${fmt(n.h)}" rx="${rx}" ${style}/>`;
    }
  }
  return shape;
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

if (typeof module !== "undefined") module.exports = { renderSvg, renderShadowSvg, THEME };
