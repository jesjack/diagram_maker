// Layout: grafo parseado -> posiciones.
//
// Cada nodo ocupa una celda (col, row) de una rejilla. Un hijo se coloca en la celda vecina
// de su padre según la dirección de la arista (reglas en SPEC.md). Después, el ancho de cada
// columna y el alto de cada fila se ajustan al nodo más grande que contienen.
//
// Cada subgraph es un diagrama aparte, colocado a la derecha del anterior (ver SPEC.md).

// En el navegador todos los scripts comparten ámbito global; en Node se importa del parser.
const layoutDeps = typeof module !== "undefined" ? require("./parser.js") : { DiagramError };

const LAYOUT_DEFAULTS = {
  fontSize: 14,
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  lineHeight: 18,
  colGap: 70,
  rowGap: 60,
  // Ancho máximo del texto antes de partirlo en líneas, por forma.
  wrapWidth: {
    rect: 170,
    round: 170,
    stadium: 170,
    parallelogram: 170,
    "parallelogram-alt": 170,
    diamond: 110,
    circle: 90,
    cylinder: 110,
  },
  diagramGap: 120, // separación horizontal entre los diagramas de cada subgraph
  titleGap: 16, // separación entre el título de un diagrama y sus nodos
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
const OPPOSITE = { down: "up", up: "down", left: "right", right: "left" };

function layoutDiagram(graph, options = {}) {
  const opts = { ...LAYOUT_DEFAULTS, ...options };
  opts.wrapWidth = { ...LAYOUT_DEFAULTS.wrapWidth, ...options.wrapWidth };
  const measure = opts.measure || ((text) => text.length * opts.fontSize * 0.52);
  const warnings = [...(graph.warnings || [])];

  if (!graph.subgraphs || !graph.subgraphs.length) {
    return { ...layoutSingle(graph, measure, opts, warnings), titles: [], warnings, options: opts };
  }

  // Un diagrama por grupo (el nivel superior y cada subgraph), de izquierda a derecha.
  const parts = splitBySubgraph(graph, warnings);
  const nodes = [];
  const edges = [];
  const titles = [];
  let bounds = null;
  let cursor = 0;
  for (const part of parts) {
    const r = layoutSingle(part, measure, opts, warnings);
    const titleH = part.title ? opts.lineHeight + opts.titleGap : 0;
    const titleW = part.title ? measure(part.title) : 0;
    const dx = cursor - r.bounds.minX;
    const dy = titleH - r.bounds.minY;
    for (const n of r.nodes) {
      n.x += dx;
      n.y += dy;
      nodes.push(n);
    }
    for (const e of r.edges) {
      for (const p of e.points) {
        p.x += dx;
        p.y += dy;
      }
      if (e.labelBox) {
        e.labelBox.x += dx;
        e.labelBox.y += dy;
      }
      edges.push(e);
    }
    const width = Math.max(r.bounds.maxX - r.bounds.minX, titleW);
    if (part.title) titles.push({ text: part.title, x: cursor, y: opts.lineHeight / 2 });
    const b = { minX: cursor, minY: 0, maxX: cursor + width, maxY: titleH + r.bounds.maxY - r.bounds.minY };
    bounds = bounds
      ? { minX: bounds.minX, minY: 0, maxX: b.maxX, maxY: Math.max(bounds.maxY, b.maxY) }
      : b;
    cursor += width + opts.diagramGap;
  }
  return { nodes, edges, bounds: bounds || { minX: 0, minY: 0, maxX: 0, maxY: 0 }, titles, warnings, options: opts };
}

// Separa el grafo en un grafo por grupo. Una arista entre dos grupos se dibuja en los dos: en
// cada uno, el extremo ajeno se sustituye por un nodo de referencia (paralelogramo con borde
// discontinuo) con el texto del nodo real. Una arista hacia o desde un subgraph entero se
// dibuja solo en el grupo del nodo, con una referencia que lleva el título del subgraph.
function splitBySubgraph(graph, warnings) {
  const byId = new Map(graph.subgraphs.map((s) => [s.id, s]));
  const fullTitle = (sg) => (sg.parent ? `${fullTitle(byId.get(sg.parent))} › ${sg.title}` : sg.title);
  const groups = [null, ...graph.subgraphs.map((s) => s.id)];
  const parts = new Map(
    groups.map((g) => [
      g,
      { group: g, nodes: new Map(), edges: [], meta: { dirs: [] }, title: g ? fullTitle(byId.get(g)) : null },
    ])
  );
  // Nodo absorbido: está fuera de todo subgraph y todas sus aristas van a nodos de subgraphs. Su
  // propio diagrama solo repetiría lo que ya se ve dentro, así que no se dibuja ahí: aparece solo
  // dentro de esos subgraphs, con su forma normal (no es referencia a nada dibujado en otro sitio).
  const absorbed = new Set();
  for (const n of graph.nodes.values()) {
    if (n.group !== null) continue;
    const own = graph.edges.filter((e) => e.from === n.id || e.to === n.id);
    const insideOnly = own.every((e) => {
      const other = graph.nodes.get(e.from === n.id ? e.to : e.from);
      return other && other.group !== null;
    });
    if (own.length && insideOnly) absorbed.add(n.id);
  }
  for (const n of graph.nodes.values()) if (!absorbed.has(n.id)) parts.get(n.group).nodes.set(n.id, n);

  // Aristas de cada nodo absorbido dentro de cada grupo.
  const absorbedEdges = new Map();
  for (const e of graph.edges) {
    for (const [end, other] of [[e.from, e.to], [e.to, e.from]]) {
      if (!absorbed.has(end)) continue;
      const key = `${end}\u0000${graph.nodes.get(other).group}`;
      absorbedEdges.set(key, (absorbedEdges.get(key) || 0) + 1);
    }
  }

  const ref = (part, e, target) => {
    const real = graph.nodes.get(target);
    // Un nodo absorbido con varias aristas en este diagrama se dibuja una sola vez, como nodo
    // normal (puede tener hasta 3 salidas, como cualquiera). Con una sola arista se trata como
    // una referencia pegada a su destino.
    if (absorbed.has(target) && absorbedEdges.get(`${target}\u0000${part.group}`) > 1) {
      if (!part.nodes.has(target)) part.nodes.set(target, { ...real, group: part.group, absorbed: true });
      return target;
    }
    const id = `${target}\u2197${e.index}`; // no puede chocar con un id escrito (\u2197 no es válido en ids)
    const text = real ? real.text : byId.get(target).title;
    const node = absorbed.has(target)
      ? { id, shape: real.shape, text, line: e.line, group: null, ref: true, absorbed: true, realId: target }
      : { id, shape: "parallelogram", text, line: e.line, group: null, ref: true, realId: target };
    part.nodes.set(id, node);
    return id;
  };
  // Cada copia de una arista hereda su @dir.
  const dirsOf = (e) => graph.meta.dirs.filter((d) => d.from === e.from && d.to === e.to);
  // attached: la arista sale de una referencia; la referencia se coloca pegada a su destino.
  const add = (group, e, from, to) => {
    const part = parts.get(group);
    part.edges.push({ ...e, from, to, attached: from !== e.from, refEdge: from !== e.from });
    for (const d of dirsOf(e)) part.meta.dirs.push({ ...d, from, to });
  };

  for (const e of graph.edges) {
    const a = graph.nodes.get(e.from);
    const b = graph.nodes.get(e.to);
    if (a && b) {
      if (a.group === b.group) add(a.group, e, e.from, e.to);
      else {
        if (!absorbed.has(e.from)) add(a.group, e, e.from, ref(parts.get(a.group), e, e.to));
        if (!absorbed.has(e.to)) add(b.group, e, ref(parts.get(b.group), e, e.from), e.to);
      }
    } else if (a) add(a.group, e, e.from, ref(parts.get(a.group), e, e.to));
    else if (b) add(b.group, e, ref(parts.get(b.group), e, e.from), e.to);
    else warnings.push({ line: e.line, message: `Arista entre dos subgraphs ('${e.from}' y '${e.to}') ignorada` });
  }
  return [...parts.values()].filter((p) => p.nodes.size);
}

function layoutSingle(graph, measure, opts, warnings) {
  const nodes = new Map();
  for (const n of graph.nodes.values()) nodes.set(n.id, { ...n, ...sizeNode(n, measure, opts) });

  const edges = graph.edges.map((e) => ({ ...e }));
  const ctx = assignDirections(nodes, edges, graph.meta.dirs);
  placeInGrid(nodes, edges, warnings, ctx);
  const bounds = computeCoordinates(nodes, edges, measure, opts);
  for (const e of edges) routeEdge(e, nodes.get(e.from), nodes.get(e.to), measure, opts);

  return { nodes: [...nodes.values()], edges, bounds };
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
    case "stadium":
      // Los extremos son semicírculos: se deja medio alto a cada lado para que el texto no toque la curva.
      h = Math.max(th + 20, 40);
      w = Math.max(tw + h * 0.8 + 16, 90);
      break;
    case "parallelogram":
    case "parallelogram-alt": {
      // skew: desplazamiento horizontal de los lados inclinados (lo usa también render.js).
      h = Math.max(th + 20, 40);
      const skew = h * 0.35;
      w = Math.max(tw + 32 + skew, 90);
      return { lines, w, h, skew };
    }
    default:
      w = Math.max(tw + 32, 90);
      h = Math.max(th + 20, 40);
  }
  return { lines, w, h };
}

// ---------------------------------------------------------------- direcciones

// Las referencias entrantes (arista "attached": ref -> nodo) ocupan un hueco del nodo destino como si
// fueran una salida más, en el orden de declaración de las aristas (salvo la que hace de padre, arriba).
// e.slot es el lado del nodo donde va la referencia; e.dir sigue siendo la dirección de la flecha.
function assignDirections(nodes, edges, metaDirs) {
  const ctx = { nodes, edges, overrides: new Map(metaDirs.map((d) => [`${d.from}\u0000${d.to}`, d])) };
  const deferred = [];
  for (const node of nodes.values()) {
    if (node.ref && edges.some((e) => e.attached && e.from === node.id)) continue;
    deferred.push(...assignSlots(node, ctx));
  }
  for (const d of deferred) resolveDeferred(d, ctx);
  return ctx;
}

// Reparte los lados de un nodo entre sus conexiones. anchor = { edge, side }: una salida que ya
// tiene lado fijo porque el nodo se colocó pegado a ese hijo (ver placeInGrid).
function assignSlots(node, ctx, anchor = null) {
  const { nodes, edges, overrides } = ctx;
  const out = edges.filter((e) => e.from === node.id);
  const att = edges.filter((e) => e.refEdge && e.to === node.id);
  if (out.length > MAX_OUTGOING) {
    throw new layoutDeps.DiagramError(
      `El nodo '${node.id}' tiene ${out.length} salidas; el máximo es ${MAX_OUTGOING}`,
      out[MAX_OUTGOING].line
    );
  }
  for (const e of [...out, ...att]) {
    delete e.dir;
    delete e.slot;
    if (e.refEdge) e.attached = true;
  }

  const used = new Map(); // lado del nodo -> arista que lo ocupa
  const other = (e) => (e.attached ? nodeLabel(nodes.get(e.from)) : `'${e.to}'`);
  const take = (edge, side, line) => {
    if (used.has(side)) {
      throw new layoutDeps.DiagramError(
        `El nodo '${node.id}' tiene dos ${used.get(side).attached || edge.attached ? "conexiones" : "salidas"} ` +
          `hacia '${side}': ${other(used.get(side))} y ${other(edge)}`,
        line
      );
    }
    used.set(side, edge);
    if (edge.attached) {
      edge.slot = side;
      edge.dir = OPPOSITE[side];
    } else edge.dir = side;
  };

  if (anchor) take(anchor.edge, anchor.side, anchor.edge.line);
  // Primero los @dir explícitos (en una referencia, el @dir es la dirección de la flecha
  // ref -> nodo, así que la referencia va al lado opuesto); luego el resto recibe los
  // valores por defecto libres, en orden de declaración.
  const conns = [...out, ...att].sort((a, b) => a.index - b.index);
  for (const e of conns) {
    const o = overrides.get(`${e.from}\u0000${e.to}`);
    if (o && !e.dir) {
      take(e, e.attached ? OPPOSITE[o.dir] : o.dir, o.line);
      e.explicit = true;
    }
  }
  // Un nodo sin padre real (p. ej. el primero de un subgraph) toma su primera referencia
  // entrante como padre: va arriba y el flujo sigue hacia abajo, como en "iArr --> S1 --> S2".
  // Si el nodo está anclado a su primer hijo, ese hijo hace de padre y la referencia es una salida más.
  const hasRealParent = anchor || edges.some((e) => !e.attached && e.to === node.id && e.from !== node.id);
  const firstAtt = att.find((e) => !e.dir);
  if (!hasRealParent && firstAtt && !used.has("up")) take(firstAtt, "up", firstAtt.line);

  const defaults = DEFAULT_DIRS[node.shape === "diamond" ? "diamond" : "other"];
  const free = defaults.filter((d) => !used.has(d));
  let pendingOut = out.filter((e) => !e.dir).length;
  const deferred = [];
  for (const e of conns) {
    if (e.dir) continue;
    if (!e.attached) {
      // Sin hueco por defecto (solo pasa si el ancla ocupó uno): cualquier lado libre.
      take(e, free.shift() || ["down", "right", "left", "up"].find((d) => !used.has(d)), e.line);
      pendingOut--;
    } else if (free.length > pendingOut) {
      // Una referencia solo toma un hueco si quedan suficientes para las salidas reales.
      take(e, free.shift(), e.line);
    } else deferred.push({ e, node, used });
  }
  return deferred;
}

// Referencia sin hueco: prueba cualquier lado libre (también arriba, si no llega por ahí
// ninguna arista); si no queda ninguno, se dibuja suelta.
function resolveDeferred({ e, node, used }, { edges, overrides }) {
  const busy = new Set(used.keys());
  for (const x of edges) if (!x.attached && x.to === node.id && x.dir) busy.add(OPPOSITE[x.dir]);
  for (const x of edges) if (x.attached && x.to === node.id && x.slot) busy.add(x.slot);
  const side = ["down", "right", "left", "up"].find((d) => !busy.has(d));
  if (side) {
    e.slot = side;
    e.dir = OPPOSITE[side];
  } else {
    e.attached = false;
    const o = overrides.get(`${e.from}\u0000${e.to}`);
    e.dir = o ? o.dir : "down";
  }
}

const nodeLabel = (n) =>
  n.absorbed ? `'${n.realId}'` : n.ref ? `la referencia a '${n.text.replace(/\n/g, " ")}'` : `'${n.id}'`;

// ---------------------------------------------------------------- rejilla

function placeInGrid(nodes, edges, warnings, ctx) {
  const occupied = new Map(); // "col,row" -> nodo
  // Las referencias no cuentan como entrada: las pegadas se colocan junto a su destino y las
  // sueltas (sin lado libre) al final, cuando su destino ya está colocado.
  const hasIncoming = new Set(edges.filter((e) => !e.refEdge).map((e) => e.to));
  const isAttachedRef = (n) => edges.some((e) => e.attached && e.from === n.id);
  let nextComponentCol = 0;

  const place = (node, col, row) => {
    node.col = col;
    node.row = row;
    const key = `${col},${row}`;
    if (occupied.has(key)) {
      // TODO (SPEC): resolver choques entre ramas. Por ahora solo se avisa.
      warnings.push({
        line: node.line,
        message: `Choque: ${nodeLabel(node)} ocupa la misma posición que ${nodeLabel(occupied.get(key))}`,
      });
    } else {
      occupied.set(key, node);
    }
  };

  // Coloca un hijo (o una referencia pegada) junto a su padre, en el lado que le tocó. Si esa celda
  // ya está ocupada (p. ej. por el propio padre del padre), prueba los demás lados del padre que
  // no estén reservados para otra conexión: abajo, derecha, izquierda, arriba. Un @dir se respeta.
  const sideOf = (e) => (e.attached ? e.slot : e.dir);
  const cellAt = (n, side) => `${n.col + DIR_VECTORS[side].dc},${n.row + DIR_VECTORS[side].dr}`;
  const placeNextTo = (parent, node, e) => {
    let side = sideOf(e);
    if (occupied.has(cellAt(parent, side)) && !e.explicit) {
      const reserved = new Set(
        edges.filter((x) => x !== e && (x.from === parent.id || (x.attached && x.to === parent.id))).map(sideOf)
      );
      const alt = ["down", "right", "left", "up"].find((d) => !reserved.has(d) && !occupied.has(cellAt(parent, d)));
      if (alt) {
        side = alt;
        if (e.attached) {
          e.slot = alt;
          e.dir = OPPOSITE[alt];
        } else e.dir = alt;
      }
    }
    const v = DIR_VECTORS[side];
    place(node, parent.col + v.dc, parent.row + v.dr);
  };

  // Un nodo sin padre real que no es el primero en colocarse no forma un grupo desconectado si
  // alguno de sus hijos ya está colocado: se pega al primero de ellos (en orden de declaración) en
  // su primer lado libre. Ese hijo hace de padre, sin cambiar el sentido de la flecha; las
  // referencias entrantes del nodo pasan a ser salidas más. Un @dir en esa arista elige el lado.
  const findAnchor = (node) => {
    if (edges.some((e) => !e.refEdge && e.to === node.id)) return null; // tiene padre real
    const edge = edges
      .filter((e) => e.from === node.id && !nodes.get(e.to).ref && nodes.get(e.to).col !== undefined)
      .sort((a, b) => a.index - b.index)[0];
    const child = edge && nodes.get(edge.to);
    if (!child) return null;
    const o = ctx.overrides.get(`${edge.from}\u0000${edge.to}`);
    if (o) return { edge, child, cell: OPPOSITE[o.dir] };
    const order = [...DEFAULT_DIRS[child.shape === "diamond" ? "diamond" : "other"], "up"];
    const cell = order.find((d) => !occupied.has(`${child.col + DIR_VECTORS[d].dc},${child.row + DIR_VECTORS[d].dr}`));
    return cell ? { edge, child, cell } : null;
  };

  // Raíces: primero los nodos sin aristas entrantes (en orden de declaración), luego el resto,
  // por si queda algún ciclo sin alcanzar.
  const all = [...nodes.values()];
  const real = all.filter((n) => !n.ref);
  const roots = [...real.filter((n) => !hasIncoming.has(n.id)), ...real, ...all.filter((n) => n.ref)];

  for (const root of roots) {
    if (root.col !== undefined || isAttachedRef(root)) continue;
    const anchor = findAnchor(root);
    if (anchor) {
      const v = DIR_VECTORS[anchor.cell];
      place(root, anchor.child.col + v.dc, anchor.child.row + v.dr);
      assignSlots(root, ctx, { edge: anchor.edge, side: OPPOSITE[anchor.cell] }).forEach((d) => resolveDeferred(d, ctx));
    } else {
      place(root, nextComponentCol, 0);
    }

    // Recorrido en anchura siguiendo las salidas en orden de declaración.
    const queue = [root];
    while (queue.length) {
      const parent = queue.shift();
      for (const e of edges) {
        if (e.attached && e.to === parent.id) {
          const ref = nodes.get(e.from);
          if (ref.col === undefined) placeNextTo(parent, ref, e);
          continue;
        }
        if (e.from !== parent.id || e.attached) continue;
        const child = nodes.get(e.to);
        if (child.col !== undefined) continue; // TODO (SPEC): bucles / varios padres
        placeNextTo(parent, child, e);
        queue.push(child);
      }
    }

    // El siguiente componente desconectado va a la derecha de todo lo colocado.
    const maxCol = Math.max(...[...nodes.values()].filter((n) => n.col !== undefined).map((n) => n.col));
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
    case "parallelogram":
    case "parallelogram-alt": {
      // A media altura los lados inclinados quedan a skew/2 hacia dentro.
      const sx = hw - node.skew / 2;
      return Math.min(ax ? sx / ax : Infinity, ay ? hh / ay : Infinity);
    }
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
