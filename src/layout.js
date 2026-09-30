// Layout: grafo parseado -> posiciones.
//
// Cada nodo ocupa una celda (col, row) de una rejilla. Un hijo se coloca en la celda vecina
// de su padre según la dirección de la arista (reglas en SPEC.md). Después, el ancho de cada
// columna y el alto de cada fila se ajustan al nodo más grande que contienen.

// En el navegador todos los scripts comparten ámbito global; en Node se importa del parser.
const layoutDeps = typeof module !== "undefined" ? require("./parser.js") : { DiagramError };

const LAYOUT_DEFAULTS = {
  fontSize: 14,
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  lineHeight: 18,
  colGap: 70,
  rowGap: 60,
  // Ancho máximo del texto antes de partirlo en líneas, por forma.
  wrapWidth: { rect: 170, round: 170, diamond: 110, circle: 90, cylinder: 110 },
  // Si no hay función para medir texto (p. ej. en Node), se estima por carácter.
  measure: null,
};

const DIR_VECTORS = {
  down: { dc: 0, dr: 1 },
  up: { dc: 0, dr: -1 },
  right: { dc: 1, dr: 0 },
  left: { dc: -1, dr: 0 },
};

// Direcciones por defecto según el orden de declaración de las salidas.
const DEFAULT_DIRS = {
  diamond: ["right", "left", "down"],
  other: ["down", "right", "left"],
};

const MAX_OUTGOING = 3;

function layoutDiagram(graph, options = {}) {
  const opts = { ...LAYOUT_DEFAULTS, ...options };
  opts.wrapWidth = { ...LAYOUT_DEFAULTS.wrapWidth, ...options.wrapWidth };
  const measure = opts.measure || ((text) => text.length * opts.fontSize * 0.52);
  const warnings = [...(graph.warnings || [])];

  const nodes = new Map();
  for (const n of graph.nodes.values()) nodes.set(n.id, { ...n, ...sizeNode(n, measure, opts) });

  const edges = graph.edges.map((e) => ({ ...e }));
  assignDirections(nodes, edges, graph.meta.dirs);
  placeInGrid(nodes, edges, warnings);
  const bounds = computeCoordinates(nodes, edges, measure, opts);
  for (const e of edges) routeEdge(e, nodes.get(e.from), nodes.get(e.to), measure, opts);

  return { nodes: [...nodes.values()], edges, bounds, warnings, options: opts };
}

// ---------------------------------------------------------------- tamaño de nodos

function wrapText(text, maxWidth, measure) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && measure(candidate) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

function sizeNode(node, measure, opts) {
  const lines = wrapText(node.text, opts.wrapWidth[node.shape], measure);
  const tw = Math.max(...lines.map((l) => measure(l)), 0);
  const th = lines.length * opts.lineHeight;
  let w;
  let h;
  switch (node.shape) {
    case "circle": {
      const d = Math.max(Math.hypot(tw, th) + 16, 60);
      w = h = d;
      break;
    }
    case "diamond":
      // El rectángulo del texto debe caber dentro del rombo: tw/w + th/h <= 1
      w = Math.max(tw * 1.7 + 20, 80);
      h = Math.max(th * 2.4 + 16, 60);
      break;
    case "cylinder": {
      w = Math.max(tw + 32, 80);
      const ry = w * 0.12;
      h = Math.max(th + 20, 40) + 2 * ry;
      break;
    }
    default:
      w = Math.max(tw + 32, 90);
      h = Math.max(th + 20, 40);
  }
  return { lines, w, h };
}

// ---------------------------------------------------------------- direcciones

function assignDirections(nodes, edges, metaDirs) {
  const overrides = new Map(metaDirs.map((d) => [`${d.from}\u0000${d.to}`, d]));

  for (const node of nodes.values()) {
    const out = edges.filter((e) => e.from === node.id);
    if (out.length > MAX_OUTGOING) {
      throw new layoutDeps.DiagramError(
        `El nodo '${node.id}' tiene ${out.length} salidas; el máximo es ${MAX_OUTGOING}`,
        out[MAX_OUTGOING].line
      );
    }

    const used = new Map(); // dirección -> arista que la ocupa
    const take = (edge, dir, line) => {
      if (used.has(dir)) {
        const other = used.get(dir);
        throw new layoutDeps.DiagramError(
          `El nodo '${node.id}' tiene dos salidas hacia '${dir}': '${other.to}' y '${edge.to}'`,
          line
        );
      }
      used.set(dir, edge);
      edge.dir = dir;
    };

    // Primero los @dir explícitos; luego el resto recibe los valores por defecto libres, en orden.
    for (const e of out) {
      const o = overrides.get(`${e.from}\u0000${e.to}`);
      if (o) take(e, o.dir, o.line);
    }
    const defaults = DEFAULT_DIRS[node.shape === "diamond" ? "diamond" : "other"];
    const free = defaults.filter((d) => ![...used.keys()].includes(d));
    for (const e of out) {
      if (!e.dir) take(e, free.shift(), e.line);
    }
  }
}

// ---------------------------------------------------------------- rejilla

function placeInGrid(nodes, edges, warnings) {
  const occupied = new Map(); // "col,row" -> id
  const hasIncoming = new Set(edges.map((e) => e.to));
  let nextComponentCol = 0;

  const place = (node, col, row) => {
    node.col = col;
    node.row = row;
    const key = `${col},${row}`;
    if (occupied.has(key)) {
      // TODO (SPEC): resolver choques entre ramas. Por ahora solo se avisa.
      warnings.push({
        line: node.line,
        message: `Choque: '${node.id}' ocupa la misma posición que '${occupied.get(key)}'`,
      });
    } else {
      occupied.set(key, node.id);
    }
  };

  // Raíces: primero los nodos sin aristas entrantes (en orden de declaración), luego el resto,
  // por si queda algún ciclo sin alcanzar.
  const all = [...nodes.values()];
  const roots = [...all.filter((n) => !hasIncoming.has(n.id)), ...all];

  for (const root of roots) {
    if (root.col !== undefined) continue;
    place(root, nextComponentCol, 0);

    // Recorrido en anchura siguiendo las salidas en orden de declaración.
    const queue = [root];
    while (queue.length) {
      const parent = queue.shift();
      for (const e of edges) {
        if (e.from !== parent.id) continue;
        const child = nodes.get(e.to);
        if (child.col !== undefined) continue; // TODO (SPEC): bucles / varios padres
        const v = DIR_VECTORS[e.dir];
        place(child, parent.col + v.dc, parent.row + v.dr);
        queue.push(child);
      }
    }

    // El siguiente componente desconectado va a la derecha de todo lo colocado.
    const maxCol = Math.max(...all.filter((n) => n.col !== undefined).map((n) => n.col));
    nextComponentCol = maxCol + 2;
  }
}

// ---------------------------------------------------------------- coordenadas

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
    const labelW = measure(e.label) + 24;
    const labelH = opts.lineHeight + 16;
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
  switch (node.shape) {
    case "circle":
      return hw;
    case "diamond":
      return 1 / (ax / hw + ay / hh);
    default:
      return Math.min(ax ? hw / ax : Infinity, ay ? hh / ay : Infinity);
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
    edge.labelBox = {
      x: (p.x + q.x) / 2,
      y: (p.y + q.y) / 2,
      w: measure(edge.label) + 12,
      h: opts.lineHeight + 4,
    };
  }
}

if (typeof module !== "undefined") module.exports = { layoutDiagram, wrapText, LAYOUT_DEFAULTS };
