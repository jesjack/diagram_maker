// Layout: de la rejilla a coordenadas (ancho de columnas, alto de filas) y trazado de aristas.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./text.js"), require("../shapes.js"));
  else root.LayoutGeometry = factory(root.LayoutText, root.Shapes);
})(typeof self !== "undefined" ? self : this, function ({ textMetrics }, Shapes) {
function computeCoordinates(nodes, edges, measure, opts) {
  const colWidth = new Map();
  const rowHeight = new Map();
  for (const n of nodes.values()) {
    colWidth.set(n.col, Math.max(colWidth.get(n.col) || 0, n.w));
    rowHeight.set(n.row, Math.max(rowHeight.get(n.row) || 0, n.h));
  }

  // Los huecos entre columnas/filas vecinas crecen si una etiqueta de arista no cabe.
  const colGapAfter = new Map();
  const rowGapAfter = new Map();
  for (const e of edges) {
    if (!e.label) continue;
    const a = nodes.get(e.from);
    const b = nodes.get(e.to);
    const tm = textMetrics(e.css, measure, opts);
    const labelLines = e.label.split("\n");
    const labelW = Math.max(...labelLines.map((l) => tm.measure(l))) + 24;
    const labelH = tm.lineHeight * labelLines.length + 16;
    if (a.row === b.row && Math.abs(a.col - b.col) === 1) {
      const c = Math.min(a.col, b.col);
      colGapAfter.set(c, Math.max(colGapAfter.get(c) || 0, labelW));
    } else if (a.col === b.col && Math.abs(a.row - b.row) === 1) {
      const r = Math.min(a.row, b.row);
      rowGapAfter.set(r, Math.max(rowGapAfter.get(r) || 0, labelH));
    }
  }

  const centers = (sizes, gapAfter, baseGap) => {
    const keys = [...sizes.keys()];
    const min = Math.min(...keys);
    const max = Math.max(...keys);
    const result = new Map();
    let cursor = 0;
    for (let k = min; k <= max; k++) {
      const size = sizes.get(k) || 0; // columnas/filas vacías no ocupan espacio
      result.set(k, cursor + size / 2);
      if (sizes.has(k)) cursor += size + Math.max(baseGap, gapAfter.get(k) || 0);
    }
    return result;
  };

  const colX = centers(colWidth, colGapAfter, opts.colGap);
  const rowY = centers(rowHeight, rowGapAfter, opts.rowGap);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes.values()) {
    n.x = colX.get(n.col);
    n.y = rowY.get(n.row);
    minX = Math.min(minX, n.x - n.w / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  }
  if (!nodes.size) minX = minY = maxX = maxY = 0;
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------- aristas

// Distancia del centro al borde de la forma en la dirección (ux, uy) unitaria.
function borderDistance(node, ux, uy) {
  const hw = node.w / 2;
  const hh = node.h / 2;
  const ax = Math.abs(ux);
  const ay = Math.abs(uy);
  if (Shapes.isRound(node.shape)) return hw;
  switch (node.shape) {
    case "circle":
      return hw;
    case "diamond":
      return 1 / (ax / hw + ay / hh);
    case "parallelogram":
    case "parallelogram-alt": {
      // A media altura los lados inclinados quedan a skew/2 hacia dentro.
      const sx = hw - node.skew / 2;
      return Math.min(ax ? sx / ax : Infinity, ay ? hh / ay : Infinity);
    }
    default: {
      // inset (formas de shapes.js): cuánto entra el contorno en el centro de cada lado de la caja.
      const i = node.inset || {};
      const sx = hw - ((ux > 0 ? i.r : i.l) || 0);
      const sy = hh - ((uy > 0 ? i.b : i.t) || 0);
      return Math.min(ax ? sx / ax : Infinity, ay ? sy / ay : Infinity);
    }
  }
}

function routeEdge(edge, a, b, measure, opts) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const da = borderDistance(a, ux, uy);
  const db = borderDistance(b, ux, uy);
  edge.points = [
    { x: a.x + ux * da, y: a.y + uy * da },
    { x: b.x - ux * db, y: b.y - uy * db },
  ];
  if (edge.label) {
    const [p, q] = edge.points;
    const tm = textMetrics(edge.css, measure, opts);
    const lines = edge.label.split("\n"); // "<br>" en la etiqueta: varias líneas
    edge.labelBox = {
      x: (p.x + q.x) / 2,
      y: (p.y + q.y) / 2,
      w: Math.max(...lines.map((l) => tm.measure(l))) + 12,
      h: tm.lineHeight * lines.length + 4,
      lineHeight: tm.lineHeight,
    };
  }
}

return { computeCoordinates, routeEdge };
});
