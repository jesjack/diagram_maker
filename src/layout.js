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
    hexagon: 170,
    diamond: 110,
    circle: 90,
    cylinder: 110,
  },
  diagramGap: 120, // separación horizontal entre los diagramas de cada subgraph
  titleGap: 16, // separación entre el título de un diagrama y sus nodos
  // measure(texto, fuente) -> ancho en px; fuente = { size, family, weight, style }. Si no hay
  // (p. ej. en Node), se estima por carácter.
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

const MAX_CONNECTIONS = 4; // un nodo solo tiene 4 lados: padres + hijos (incluidas referencias)
const JUNCTION_SIZE = 10; // diámetro del punto de empalme
const OPPOSITE = { down: "up", up: "down", left: "right", right: "left" };

function layoutDiagram(graph, options = {}) {
  const opts = { ...LAYOUT_DEFAULTS, ...options };
  opts.wrapWidth = { ...LAYOUT_DEFAULTS.wrapWidth, ...options.wrapWidth };
  const measure =
    opts.measure || ((text, font) => text.length * (font ? font.size : opts.fontSize) * (font && font.bold ? 0.56 : 0.52));
  const warnings = [...(graph.warnings || [])];

  if (!graph.subgraphs || !graph.subgraphs.length) {
    const single = layoutSingle(graph, measure, opts, warnings);
    const { steps, snapshotAt } = single;
    delete single.steps;
    delete single.snapshotAt;
    const at = (k) => ({ ...snapshotAt(Math.min(k, steps - 1)), titles: [], options: opts });
    return { ...single, titles: [], warnings, options: opts, snapshotAt: at };
  }

  // Un diagrama por grupo (el nivel superior y cada subgraph), de izquierda a derecha.
  const parts = splitBySubgraph(graph, warnings);
  const nodes = [];
  const edges = [];
  const titles = [];
  let bounds = null;
  let cursor = 0;
  let stepOffset = 0; // los pasos de colocación siguen la numeración entre diagramas
  const done = []; // por diagrama: lo necesario para reconstruir sus pasos
  for (const part of parts) {
    const r = layoutSingle(part, measure, opts, warnings);
    const firstStep = stepOffset;
    for (const n of r.nodes) {
      if (n.step === 0) n.why = `${part.title ? `diagrama «${part.title}»` : "nivel superior"}: ${n.why}`;
      n.step += stepOffset;
    }
    stepOffset += r.nodes.length;
    const titleH = part.title ? opts.lineHeight + opts.titleGap : 0;
    const titleW = part.title ? measure(part.title, { ...baseFont(opts), weight: "600", bold: true }) : 0;
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
    done.push({ r, firstStep, steps: r.steps, cursor, titleH, nodes: [...r.nodes], edges: [...r.edges], titles: [...titles] });
    const b = { minX: cursor, minY: 0, maxX: cursor + width, maxY: titleH + r.bounds.maxY - r.bounds.minY };
    bounds = bounds
      ? { minX: bounds.minX, minY: 0, maxX: b.maxX, maxY: Math.max(bounds.maxY, b.maxY) }
      : b;
    cursor += width + opts.diagramGap;
  }
  // Paso k: los diagramas anteriores completos y el del paso k tal como estaba entonces.
  const snapshotAt = (k) => {
    const i = Math.max(0, done.findIndex((d) => k < d.firstStep + d.steps));
    const cur = done[i] || done[done.length - 1];
    const snap = cur.r.snapshotAt(Math.min(k - cur.firstStep, cur.steps - 1));
    const dx = cur.cursor - snap.bounds.minX;
    const dy = cur.titleH - snap.bounds.minY;
    const moved = snap.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy }));
    const movedEdges = snap.edges.map((e) => ({
      ...e,
      points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      labelBox: e.labelBox && { ...e.labelBox, x: e.labelBox.x + dx, y: e.labelBox.y + dy },
    }));
    const before = done.slice(0, done.indexOf(cur));
    const all = [...before.flatMap((d) => d.nodes), ...moved];
    const xs = all.flatMap((n) => [n.x - n.w / 2, n.x + n.w / 2]);
    const ys = all.flatMap((n) => [n.y - n.h / 2, n.y + n.h / 2]);
    return {
      nodes: all,
      edges: [...before.flatMap((d) => d.edges), ...movedEdges],
      bounds: { minX: Math.min(0, ...xs), minY: Math.min(0, ...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) },
      titles: cur.titles,
      options: opts,
    };
  };
  return { nodes, edges, bounds: bounds || { minX: 0, minY: 0, maxX: 0, maxY: 0 }, titles, warnings, options: opts, snapshotAt };
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
    // Las referencias llevan el estilo del nodo real (si es un subgraph entero, ninguno).
    const css = real && real.css;
    const node = absorbed.has(target)
      ? { id, shape: real.shape, text, css, line: e.line, group: null, ref: true, absorbed: true, realId: target }
      : { id, shape: "parallelogram", text, css, line: e.line, group: null, ref: true, realId: target };
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
  const dirs = graph.meta.dirs.map((d) => ({ ...d }));
  addJunctions(nodes, edges, dirs, opts);
  const ctx = assignDirections(nodes, edges, dirs);
  const history = placeInGrid(nodes, edges, warnings, ctx);
  const bounds = computeCoordinates(nodes, edges, measure, opts);
  for (const e of edges) routeEdge(e, nodes.get(e.from), nodes.get(e.to), measure, opts);

  // Coordenadas del diagrama tal como estaba al terminar el paso k (se calculan al pedirlas).
  const snapshotAt = (k) => {
    const h = history[k];
    const snapNodes = new Map(h.pos.map(([n, col, row]) => [n.id, { ...n, col, row }]));
    const snapEdges = h.edges.map((x) => ({ ...x }));
    const b = computeCoordinates(snapNodes, snapEdges, measure, opts);
    for (const x of snapEdges) routeEdge(x, snapNodes.get(x.from), snapNodes.get(x.to), measure, opts);
    return { nodes: [...snapNodes.values()], edges: snapEdges, bounds: b };
  };
  return { nodes: [...nodes.values()], edges, bounds, steps: history.length, snapshotAt };
}

// Crea un empalme de owner y la extensión (línea sin flechas) que los une. Devuelve el empalme.
// index: posición de la extensión en el orden de declaración (justo antes de la conexión movida).
function addJunction(nodes, edges, owner, index, line, lineHeight) {
  let id = `${owner.id}\u25cf`; // no puede chocar con un id escrito (\u25cf no es válido en ids)
  while (nodes.has(id)) id += "\u25cf";
  const junction = {
    id,
    shape: "junction",
    text: "",
    lines: [],
    w: JUNCTION_SIZE,
    h: JUNCTION_SIZE,
    lineHeight,
    line,
    group: owner.group,
    junctionOf: owner.junctionOf || owner.realId || owner.id,
  };
  nodes.set(id, junction);
  edges.push({ index, from: owner.id, to: id, label: null, arrowStart: false, arrowEnd: false, style: "solid", bus: true, line });
  return junction;
}

// Cambia el extremo `from` (un nodo) de la arista e por `to` (un empalme), con su @dir si lo hay.
function moveEnd(e, from, to, dirs = []) {
  for (const d of dirs) if (d.from === e.from && d.to === e.to) d[e.from === from ? "from" : "to"] = to;
  if (e.from === from) e.from = to;
  else e.to = to;
}

// Un nodo solo tiene 4 lados. Si tiene más conexiones (padres + hijos, contando las referencias
// de su diagrama), conserva las 3 primeras en orden de declaración y la 4ª es una extensión: una
// línea sin flecha hasta un punto de empalme, del que salen las demás. El empalme tiene 3 lados
// libres; si no le bastan, se queda con 2 y encadena otro empalme, y así sucesivamente.
function addJunctions(nodes, edges, dirs, opts) {
  const touching = (id) =>
    edges.filter((e) => (e.from === id || e.to === id) && e.from !== e.to).sort((a, b) => a.index - b.index);
  const queue = [...nodes.keys()];
  while (queue.length) {
    const id = queue.shift();
    const conns = touching(id);
    if (conns.length <= MAX_CONNECTIONS) continue;
    const moved = conns.slice(MAX_CONNECTIONS - 1);
    // La extensión ocupa el sitio de la 4ª conexión en el orden de declaración; un @dir de una
    // conexión movida pasa a la rama que sale del empalme.
    const j = addJunction(nodes, edges, nodes.get(id), moved[0].index - 0.5, moved[0].line, opts.lineHeight);
    for (const e of moved) moveEnd(e, id, j.id, dirs);
    queue.push(j.id);
  }
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

// ---------------------------------------------------------------- fuentes

const baseFont = (opts) => ({ size: opts.fontSize, family: opts.fontFamily, weight: "normal", style: "normal", bold: false });

// Tamaño en px de un valor CSS de font-size (px, pt, em, rem, %); null si no se entiende.
function fontSizePx(value, base) {
  const m = String(value).trim().match(/^(\d*\.?\d+)\s*(px|pt|em|rem|%)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return { px: n, "": n, pt: (n * 4) / 3, em: n * base, rem: n * base, "%": (n * base) / 100 }[m[2] || ""];
}

// Medidas de texto según el css de un nodo o arista: el layout tiene que medir con la misma
// fuente con la que se pinta, o el texto no cabe en la forma.
function textMetrics(css, measure, opts) {
  const font = baseFont(opts);
  let spacing = 0;
  for (const [k, v] of css || []) {
    if (k === "font-size") font.size = fontSizePx(v, opts.fontSize) || font.size;
    else if (k === "font-family") font.family = v;
    else if (k === "font-weight") font.weight = v;
    else if (k === "font-style") font.style = v;
    else if (k === "letter-spacing") spacing = fontSizePx(v, font.size) || 0;
  }
  font.bold = /bold|^[6-9]00$/.test(font.weight);
  const k = font.size / opts.fontSize;
  return {
    font,
    scale: k,
    lineHeight: opts.lineHeight * k,
    measure: (text) => measure(text, font) + spacing * text.length,
  };
}

function sizeNode(node, rawMeasure, opts) {
  const tm = textMetrics(node.css, rawMeasure, opts);
  const measure = tm.measure;
  const lines = wrapText(node.text, opts.wrapWidth[node.shape] * tm.scale, measure);
  const tw = Math.max(...lines.map((l) => measure(l)), 0);
  const th = lines.length * tm.lineHeight;
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
    case "hexagon":
    case "parallelogram":
    case "parallelogram-alt": {
      // skew: desplazamiento horizontal de los lados inclinados (lo usa también render.js). En el
      // hexágono son las puntas laterales; el texto cabe igual que en el paralelogramo.
      h = Math.max(th + 20, 40);
      const skew = h * 0.35;
      w = Math.max(tw + 32 + skew, 90);
      return { lines, w, h, skew, lineHeight: tm.lineHeight };
    }
    default:
      w = Math.max(tw + 32, 90);
      h = Math.max(th + 20, 40);
  }
  return { lines, w, h, lineHeight: tm.lineHeight };
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
  n.junctionOf ? `el empalme de '${n.junctionOf}'` : n.absorbed ? `'${n.realId || n.id}'` : n.ref ? `la referencia a '${n.text.replace(/\n/g, " ")}'` : `'${n.id}'`;

// ---------------------------------------------------------------- rejilla

function placeInGrid(nodes, edges, warnings, ctx) {
  const occupied = new Map(); // "col,row" -> nodo
  // Las referencias no cuentan como entrada: las pegadas se colocan junto a su destino y las
  // sueltas (sin lado libre) al final, cuando su destino ya está colocado.
  const hasIncoming = new Set(edges.filter((e) => !e.refEdge).map((e) => e.to));
  const isAttachedRef = (n) => edges.some((e) => e.attached && e.from === n.id);
  let nextComponentCol = 0;

  // Para depurar el layout en el visor: cada nodo guarda en qué orden se colocó (step) y por qué (why).
  let step = 0;
  const SIDE_NAME = { down: "abajo", right: "la derecha", left: "la izquierda", up: "arriba" };
  const SIDE_AT = { down: "debajo", right: "a la derecha", left: "a la izquierda", up: "encima" };
  const who = (n) =>
    n.junctionOf ? `empalme de '${n.junctionOf}'` : n.ref && !n.absorbed ? `ref. a '${n.realId}'` : `'${n.realId || n.id}'`;
  // Celdas reservadas para hijos que aún no se han colocado (clave -> id del hijo): al expandir un
  // nodo se reservan las celdas de todos sus hijos antes de bajar por ninguna rama, para que un
  // descendiente de un hermano anterior no se las quite (el recorrido es en profundidad).
  const pending = new Map();
  // Una celda está bloqueada si tiene un nodo, si está reservada para otro, o si la atraviesa una
  // flecha recta ya trazada (sus dos extremos colocados): nadie se coloca encima de una línea.
  const crossedBy = (key) => {
    const [c, r] = key.split(",").map(Number);
    return edges.some((x) => {
      const a = nodes.get(x.from);
      const b = nodes.get(x.to);
      if (!a || !b || a.col === undefined || b.col === undefined) return false;
      if (a.col === b.col && a.col === c) return r > Math.min(a.row, b.row) && r < Math.max(a.row, b.row);
      if (a.row === b.row && a.row === r) return c > Math.min(a.col, b.col) && c < Math.max(a.col, b.col);
      return false;
    });
  };
  const blocked = (key, forId) =>
    occupied.has(key) || (pending.has(key) && pending.get(key) !== forId) || crossedBy(key);
  // Historia para el paso a paso del visor: history[k] = estado de la rejilla al terminar el paso k
  // (posición de cada nodo colocado y flechas entre nodos colocados, con sus extremos de entonces).
  // Se guarda justo antes de que el paso siguiente cambie nada (closeStep), así una inserción o
  // un nodo movido aparecen en el paso que los provocó.
  const history = [];
  const snapshot = () => ({
    pos: [...nodes.values()].filter((n) => n.col !== undefined).map((n) => [n, n.col, n.row]),
    edges: edges
      .filter((x) => nodes.has(x.from) && nodes.has(x.to) && nodes.get(x.from).col !== undefined && nodes.get(x.to).col !== undefined)
      .map((x) => ({ ...x })),
  });
  const closeStep = () => {
    if (step > 0 && !history[step - 1]) history[step - 1] = snapshot();
  };
  const place = (node, col, row, why = "") => {
    closeStep();
    for (const [k, id] of pending) if (id === node.id) pending.delete(k);
    node.col = col;
    node.row = row;
    node.step = step++;
    node.why = why;
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
    const wanted = side;
    if (blocked(cellAt(parent, side), node.id) && !e.explicit) {
      const reserved = new Set(
        edges.filter((x) => x !== e && (x.from === parent.id || (x.attached && x.to === parent.id))).map(sideOf)
      );
      const alt = ["down", "right", "left", "up"].find((d) => !reserved.has(d) && !blocked(cellAt(parent, d), node.id));
      if (alt) {
        side = alt;
        if (e.attached) {
          e.slot = alt;
          e.dir = OPPOSITE[alt];
        } else e.dir = alt;
      } else return makeRoom(parent, node, e, wanted);
    }
    const v = DIR_VECTORS[side];
    const kind = node.copyOf
      ? `copia de ${who(nodes.get(node.copyOf))} (el original está lejos${node.shape === "junction" ? "" : " y no tiene hijos"}), hija de`
      : e.attached ? "pegado a" : e.from === parent.id ? "hijo de" : "padre de";
    const moved = side !== wanted ? ` (el lado de ${SIDE_NAME[wanted]} estaba ocupado)` : "";
    place(node, parent.col + v.dc, parent.row + v.dr, `${kind} ${who(parent)}, ${SIDE_AT[side]}${moved}`);
    return [];
  };
  // Un nodo sin ningún lado libre en su padre. Cascada finita, de lo más local a lo más global:
  //  1. Extensión en línea recta por el lado de un hermano (sin colocar, o colocado pero hoja con
  //     una sola conexión, que se puede mover) o por un lado libre, hasta un empalme a 1..8 celdas
  //     que tenga sitio: el hermano va recto si puede (si no, a otro lado libre del empalme) y el
  //     nodo a un lado libre. La línea no atraviesa nodos.
  //  2. Si ninguna dirección sirve: se inserta una fila o columna junto al padre (la que menos
  //     flechas alarga) y el nodo va directamente a la celda que queda libre. Siempre funciona.
  const MAX_REACH = 8;
  const LINE = "\u2500"; // celda atravesada por una extensión: nadie puede ocuparla
  const conns = (id) => edges.filter((x) => x.from === id || x.to === id);
  const makeRoom = (parent, node, e, wanted) => {
    const isFree = (key, ...ok) => !occupied.has(key) && (!pending.has(key) || ok.includes(pending.get(key))) && !crossedBy(key);
    for (const d of ["down", "right", "left", "up"]) {
      const sibEdge = edges.find(
        (x) => x !== e && sideOf(x) === d && (x.from === parent.id || (x.attached && x.to === parent.id))
      );
      const sib = sibEdge && nodes.get(sibEdge.attached ? sibEdge.from : sibEdge.to);
      const key1 = cellAt(parent, d);
      const sibHere = sib && sib.col !== undefined && `${sib.col},${sib.row}` === key1;
      const movable = sibHere && conns(sib.id).length === 1;
      if (!(isFree(key1, node.id, sib && sib.id) || movable)) continue;
      if (sib && sib.col !== undefined && !sibHere) continue; // el hermano está en otro sitio: no aplica
      const v = DIR_VECTORS[d];
      for (let k = 1; k <= MAX_REACH; k++) {
        const jc = { col: parent.col + v.dc * k, row: parent.row + v.dr * k };
        const jkey = `${jc.col},${jc.row}`;
        if (k > 1 && !isFree(jkey)) break; // la línea no puede atravesar un nodo
        const free = ["down", "right", "left", "up"].filter((x) => {
          if (x === OPPOSITE[d]) return false;
          const key = `${jc.col + DIR_VECTORS[x].dc},${jc.row + DIR_VECTORS[x].dr}`;
          return isFree(key, node.id, sib && sib.id);
        });
        if (free.length < (sib ? 2 : 1)) continue;
        const sibSide = sib ? (free.includes(d) ? d : free[0]) : null;
        const nodeSide = free.find((x) => x !== sibSide);
        return applyRoom({ parent, node, e, wanted, d, k, jc, sibEdge: sib && sibEdge, sib, sibSide, nodeSide });
      }
    }
    return insertLine(parent, node, e, wanted);
  };
  const applyRoom = ({ parent, node, e, wanted, d, k, jc, sibEdge, sib, sibSide, nodeSide }) => {
    closeStep();
    const j = addJunction(nodes, edges, parent, Math.min(e.index, sibEdge ? sibEdge.index : e.index) - 0.5, e.line, parent.lineHeight);
    edges[edges.length - 1].dir = d;
    if (sib && sib.col !== undefined) {
      occupied.delete(`${sib.col},${sib.row}`);
      sib.col = undefined;
    }
    const v = DIR_VECTORS[d];
    for (let i = 1; i < k; i++) pending.set(`${parent.col + v.dc * i},${parent.row + v.dr * i}`, LINE);
    place(j, jc.col, jc.row, `extensión desde ${who(parent)} hacia ${SIDE_NAME[d]}${k > 1 ? ` (${k} celdas)` : ""}: ${who(node)} no tenía lado libre`);
    if (sib) {
      moveEnd(sibEdge, parent.id, j.id);
      setSide(sibEdge, j, sibSide);
      const key = cellAt(j, sibSide);
      for (const [kk, id] of pending) if (id === sib.id) pending.delete(kk);
      if (sib.why !== undefined && sib.step !== undefined) {
        // Ya estaba colocado: se mueve al empalme (conserva su paso, actualiza el motivo).
        const sv = DIR_VECTORS[sibSide];
        sib.col = j.col + sv.dc;
        sib.row = j.row + sv.dr;
        sib.why += ` → movido ${SIDE_AT[sibSide]} del empalme de ${who(parent)} para dejar sitio`;
        occupied.set(key, sib);
      } else pending.set(key, sib.id);
    }
    moveEnd(e, parent.id, j.id);
    setSide(e, j, nodeSide);
    const sv = DIR_VECTORS[nodeSide];
    const kind = node.copyOf ? `copia de ${who(nodes.get(node.copyOf))}, hija de` : e.attached ? "pegado a" : "hijo de";
    place(node, j.col + sv.dc, j.row + sv.dr, `${kind} ${who(parent)} a través de su extensión, ${SIDE_AT[nodeSide]} del empalme (el lado de ${SIDE_NAME[wanted]} estaba ocupado)`);
    return [j];
  };
  // Inserta una fila o columna vacía junto a parent: todo lo que queda más allá se desplaza una
  // celda (las líneas que la cruzan se alargan y siguen rectas). Se elige el lado que menos
  // flechas cruzan y el nodo va a la celda que queda libre.
  const insertLine = (parent, node, e, wanted) => {
    closeStep();
    const placedNodes = [...nodes.values()].filter((n) => n.col !== undefined);
    const beyond = (n, d) =>
      d === "down" ? n.row > parent.row : d === "up" ? n.row < parent.row : d === "right" ? n.col > parent.col : n.col < parent.col;
    // Para cada lado: qué flechas cruzarían la línea nueva, por qué celdas de ella pasarían (las
    // rectas) y si alguna flecha del padre sale justo hacia ese lado (atravesaría la celda nueva).
    const plan = (d) => {
      const v = DIR_VECTORS[d];
      const crossing = edges.filter((x) => {
        const a = nodes.get(x.from);
        const b = nodes.get(x.to);
        return a.col !== undefined && b.col !== undefined && beyond(a, d) !== beyond(b, d);
      });
      const vertical = v.dr !== 0;
      const lineAt = vertical ? parent.row + v.dr : parent.col + v.dc; // fila/columna nueva
      const crossed = new Set();
      for (const x of crossing) {
        const a = nodes.get(x.from);
        const b = nodes.get(x.to);
        if (vertical && a.col === b.col) crossed.add(`${a.col},${lineAt}`);
        if (!vertical && a.row === b.row) crossed.add(`${lineAt},${a.row}`);
      }
      const through = edges.find((x) => {
        if (x === e || (x.from !== parent.id && x.to !== parent.id)) return false;
        const o = nodes.get(x.from === parent.id ? x.to : x.from);
        if (o.col === undefined) return false;
        return Math.sign(o.col - parent.col) === v.dc && Math.sign(o.row - parent.row) === v.dr && (v.dc ? o.row === parent.row : o.col === parent.col);
      });
      // Con una flecha atravesando, el nodo va a un lado del empalme, dentro de la línea nueva y
      // en una celda que no cruce ninguna otra flecha.
      const jc = { col: parent.col + v.dc, row: parent.row + v.dr };
      const lateral = through
        ? (vertical ? ["right", "left"] : ["down", "up"]).find(
            (x) => !crossed.has(`${jc.col + DIR_VECTORS[x].dc},${jc.row + DIR_VECTORS[x].dr}`)
          )
        : null;
      return { d, v, crossing: crossing.length, through, lateral, ok: !through || !!lateral };
    };
    const plans = ["down", "right", "left", "up"].map(plan).sort((a, b) => b.ok - a.ok || a.crossing - b.crossing);
    const { d, v, through, lateral } = plans[0];
    for (const n of placedNodes) {
      if (!beyond(n, d)) continue;
      n.col += v.dc;
      n.row += v.dr;
    }
    occupied.clear();
    for (const n of placedNodes) occupied.set(`${n.col},${n.row}`, n);
    const shifted = new Map();
    for (const [key, id] of pending) {
      const [c, r] = key.split(",").map(Number);
      shifted.set(beyond({ col: c, row: r }, d) ? `${c + v.dc},${r + v.dr}` : key, id);
    }
    pending.clear();
    for (const [key, id] of shifted) pending.set(key, id);
    const line = d === "down" || d === "up" ? "fila" : "columna";
    const kind = node.copyOf ? `copia de ${who(nodes.get(node.copyOf))}, hija de` : e.attached ? "pegado a" : "hijo de";
    if (through) {
      const j = addJunction(nodes, edges, parent, Math.min(e.index, through.index) - 0.5, e.line, parent.lineHeight);
      edges[edges.length - 1].dir = d;
      place(j, parent.col + v.dc, parent.row + v.dr, `empalme en la ${line} insertada junto a ${who(parent)}: ${who(node)} no tenía sitio`);
      moveEnd(through, parent.id, j.id);
      setSide(through, j, d);
      moveEnd(e, parent.id, j.id);
      const side = lateral || (v.dc ? "down" : "right");
      setSide(e, j, side);
      const sv = DIR_VECTORS[side];
      place(node, j.col + sv.dc, j.row + sv.dr, `${kind} ${who(parent)} a través de un empalme, ${SIDE_AT[side]} de él: no había sitio cerca, así que se insertó una ${line}`);
      return [j];
    }
    setSide(e, parent, d);
    place(
      node,
      parent.col + v.dc,
      parent.row + v.dr,
      `${kind} ${who(parent)}, ${SIDE_AT[d]}: no había sitio cerca, así que se insertó una ${line} (el lado de ${SIDE_NAME[wanted]} estaba ocupado)`
    );
    return [];
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
    const cell = order.find((d) => !blocked(`${child.col + DIR_VECTORS[d].dc},${child.row + DIR_VECTORS[d].dr}`, node.id));
    return cell ? { edge, child, cell } : null;
  };

  // Raíces: primero los nodos sin aristas entrantes (en orden de declaración), luego el resto,
  // por si queda algún ciclo sin alcanzar.
  const all = [...nodes.values()];
  const real = all.filter((n) => !n.ref);
  const roots = [...real.filter((n) => !hasIncoming.has(n.id)), ...real, ...all.filter((n) => n.ref)];

  // Coloca los hijos directos (y referencias pegadas) de parent; devuelve los nodos nuevos a recorrer.
  const expand = (parent, each) => {
    const placed = [];
    for (const e of edges) {
      const mine = e.attached ? e.to === parent.id : e.from === parent.id;
      if (!mine) continue;
      const other = nodes.get(e.attached ? e.from : e.to);
      const willCopy = other.col !== undefined && !e.attached && farLeaf(parent, other);
      if (other.col !== undefined && !willCopy) continue;
      const key = cellAt(parent, sideOf(e));
      if (!blocked(key)) pending.set(key, willCopy ? `copy:${e.index}` : other.id);
    }
    for (const e of edges) {
      if (e.attached && e.to === parent.id) {
        const ref = nodes.get(e.from);
        if (ref.col === undefined) {
          const extra = placeNextTo(parent, ref, e);
          placed.push(...extra);
          if (each) extra.forEach(each);
        }
        continue;
      }
      if (e.from !== parent.id || e.attached) continue;
      let child = nodes.get(e.to);
      if (child.col !== undefined) {
        if (e.bus) continue; // la extensión a un empalme propio nunca se copia
        // Hijo ya colocado lejos y sin hijos: se le pone una copia aquí, en su turno (regla 12).
        const leaf = farLeaf(parent, child);
        if (!leaf) continue; // TODO (SPEC): bucles / varios padres
        child = copyOfLeaf(leaf, e);
      }
      const extra = placeNextTo(parent, child, e);
      placed.push(child, ...extra);
      if (each) [child, ...extra].forEach(each);
    }
    return placed;
  };
  // Recorrido en profundidad, en orden de declaración: cada nodo termina toda su rama antes de
  // pasar a su siguiente hermano (los hermanos ya tienen su lado reservado).
  const visit = (u) => expand(u, visit);
  const placeRoot = (root, anchor, retry = false) => {
    const later = retry ? " (aplazado y reintentado)" : "";
    if (anchor) {
      const v = DIR_VECTORS[anchor.cell];
      place(
        root,
        anchor.child.col + v.dc,
        anchor.child.row + v.dr,
        `sin padre: pegado a su hijo ${who(anchor.child)}, ${SIDE_AT[anchor.cell]}${later}`
      );
      assignSlots(root, ctx, { edge: anchor.edge, side: OPPOSITE[anchor.cell] }).forEach((d) => resolveDeferred(d, ctx));
    } else {
      place(root, nextComponentCol, 0, step ? `inicio de un grupo nuevo, aparte${later}` : "nodo inicial");
    }

    visit(root);

    // El siguiente componente desconectado va a la derecha de todo lo colocado.
    const maxCol = Math.max(...[...nodes.values()].filter((n) => n.col !== undefined).map((n) => n.col));
    nextComponentCol = maxCol + 2;
  };

  // Grupo que no se puede pegar por su inicio: se busca la primera conexión (en orden de
  // declaración) entre cualquier nodo del grupo y un nodo ya colocado, y el grupo se reconstruye
  // desde ese punto: su nodo va junto a la pareja ya colocada y el resto se recorre desde ahí
  // siguiendo las aristas en cualquier sentido (las flechas no cambian), cada nodo en el primer
  // lado libre del anterior. Con a->b->c ya colocado, A->B->C y C->c queda a,b,c,C,B,A.
  const isPlaced = (n) => n.col !== undefined;
  const sidesOf = (n) => [...DEFAULT_DIRS[n.shape === "diamond" ? "diamond" : "other"], "up"];
  const groupOf = (root) => {
    const group = new Set([root.id]);
    const queue = [root];
    while (queue.length) {
      const u = queue.shift();
      for (const e of edges) {
        const w = e.attached && e.to === u.id ? nodes.get(e.from) : !e.attached && e.from === u.id ? nodes.get(e.to) : null;
        if (!w || isPlaced(w) || group.has(w.id)) continue;
        group.add(w.id);
        if (!w.ref) queue.push(w);
      }
    }
    return group;
  };
  // Simula la reconstrucción del grupo desde start, colocado en la celda (col, row): devuelve las
  // posiciones y aristas resultantes y cuántos choques habría, sin tocar nada.
  const simulateGroup = (group, start, col, row, extraTaken = []) => {
    const taken = new Set([...occupied.keys(), ...pending.keys(), ...extraTaken]);
    const pos = new Map([[start.id, { col, row }]]);
    const sides = []; // [arista, nodo u, lado de u donde queda el otro extremo]
    let collisions = taken.has(`${col},${row}`) ? 1 : 0;
    taken.add(`${col},${row}`);
    const free = (p, d) => {
      const key = `${p.col + DIR_VECTORS[d].dc},${p.row + DIR_VECTORS[d].dr}`;
      return !taken.has(key) && !crossedBy(key);
    };
    // En profundidad, como el recorrido normal (visit en placeRoot).
    const visit = (u) => {
      const pu = pos.get(u.id);
      const conns = edges
        .filter((e) => (e.from === u.id || e.to === u.id) && e.from !== e.to)
        .sort((a, b) => a.index - b.index);
      for (const e of conns) {
        const w = nodes.get(e.from === u.id ? e.to : e.from);
        if (!group.has(w.id) || pos.has(w.id)) continue;
        const side = sidesOf(u).find((d) => free(pu, d));
        const d = side || sidesOf(u)[0];
        const p = { col: pu.col + DIR_VECTORS[d].dc, row: pu.row + DIR_VECTORS[d].dr };
        if (!side) collisions++;
        taken.add(`${p.col},${p.row}`);
        pos.set(w.id, p);
        sides.push([e, u, d]);
        if (!w.ref) visit(w);
      }
    };
    visit(start);
    return { pos, sides, collisions };
  };
  const placeGroupByLink = (root) => {
    const group = groupOf(root);
    const links = edges
      .filter((e) => !e.refEdge && (group.has(e.from) ? isPlaced(nodes.get(e.to)) : group.has(e.to) && isPlaced(nodes.get(e.from))))
      .sort((a, b) => a.index - b.index);
    // Se prueban todas las conexiones y todos los lados libres de su pareja; gana la opción con
    // menos choques y, a igualdad, la primera (en orden de declaración y de lados).
    let best = null;
    for (const link of links) {
      const start = nodes.get(group.has(link.from) ? link.from : link.to);
      const partner = nodes.get(group.has(link.from) ? link.to : link.from);
      for (const cell of sidesOf(partner)) {
        if (blocked(cellAt(partner, cell), start.id)) continue;
        const v = DIR_VECTORS[cell];
        const sim = simulateGroup(group, start, partner.col + v.dc, partner.row + v.dr);
        if (!best || sim.collisions < best.sim.collisions) best = { sim, link, start, cell };
        if (best.sim.collisions === 0) break;
      }
      if (best && best.sim.collisions === 0) break;
    }
    // Si ninguna opción encaja sin pisar nodos, se vuelve a la primera conexión y se extiende la
    // línea de su pareja hasta un empalme (como en addJunctions), que da 3 lados libres para el
    // grupo. La extensión puede cruzar varias celdas vacías en línea recta hasta un sitio donde
    // el grupo quepa: gana la opción con menos choques (dirección en orden, luego más corta).
    // Si la pareja de la primera conexión no tiene ningún lado libre por donde sacar la extensión,
    // se usa la siguiente conexión, y así; a igualdad de choques gana la conexión anterior.
    if (!best || best.sim.collisions > 0) {
      let ext = null;
      for (const link of links) {
        const opt = planExtension(group, link);
        if (opt && (!ext || opt.sim.collisions < ext.sim.collisions)) ext = opt;
        if (ext && ext.sim.collisions === 0) break;
      }
      return ext ? applyExtension(ext) : false;
    }
    const how = `grupo reconstruido desde la conexión ${who(best.start)} – ${who(nodes.get(best.link.from === best.start.id ? best.link.to : best.link.from))}`;
    for (const [id, p] of best.sim.pos) place(nodes.get(id), p.col, p.row, id === best.start.id ? how : `${how}: sigue el recorrido`);
    setSide(best.link, best.start, OPPOSITE[best.cell]);
    for (const [e, u, d] of best.sim.sides) setSide(e, u, d);
    // Cada nodo del grupo se expande en su turno (copias de hojas lejanas, regla 12).
    for (const id of best.sim.pos.keys()) if (!nodes.get(id).ref) visit(nodes.get(id));
    const maxCol = Math.max(...[...nodes.values()].filter(isPlaced).map((n) => n.col));
    nextComponentCol = maxCol + 2;
    return true;
  };
  const MAX_EXTENSION = 8; // celdas que puede cruzar una extensión
  const planExtension = (group, link) => {
    const start = nodes.get(group.has(link.from) ? link.from : link.to);
    const partner = nodes.get(group.has(link.from) ? link.to : link.from);
    let best = null;
    for (const d of sidesOf(partner)) {
      const v = DIR_VECTORS[d];
      const path = [];
      for (let k = 1; k <= MAX_EXTENSION; k++) {
        const jc = { col: partner.col + v.dc * k, row: partner.row + v.dr * k };
        const key = `${jc.col},${jc.row}`;
        if (blocked(key)) break; // la línea no puede atravesar un nodo
        path.push(key);
        for (const s2 of ["down", "right", "left", "up"]) {
          if (s2 === OPPOSITE[d]) continue; // por ahí llega la extensión
          const sv = DIR_VECTORS[s2];
          const sim = simulateGroup(group, start, jc.col + sv.dc, jc.row + sv.dr, path);
          if (!best || sim.collisions < best.sim.collisions) best = { sim, d, jc, s2 };
          if (best.sim.collisions === 0) break;
        }
        if (best && best.sim.collisions === 0) break;
      }
      if (best && best.sim.collisions === 0) break;
    }
    return best && { ...best, link, start, partner };
  };
  const applyExtension = ({ sim, d, jc, s2, link, partner, start }) => {
    // Empalme nuevo de la pareja; la conexión pasa a salir de él.
    const junction = addJunction(nodes, edges, partner, link.index - 0.5, link.line, partner.lineHeight);
    edges[edges.length - 1].dir = d;
    moveEnd(link, partner.id, junction.id);
    const k = Math.abs(jc.col - partner.col) + Math.abs(jc.row - partner.row);
    place(junction, jc.col, jc.row, `extensión desde ${who(partner)} hacia ${SIDE_NAME[d]} (${k} celda${k > 1 ? "s" : ""}): el grupo no cabía`);
    for (const [id, p] of sim.pos) {
      place(nodes.get(id), p.col, p.row, id === start.id ? `junto al empalme de ${who(partner)}` : `grupo unido por la extensión de ${who(partner)}: sigue el recorrido`);
    }
    setSide(link, junction, s2);
    for (const [e, u, side] of sim.sides) setSide(e, u, side);
    for (const id of sim.pos.keys()) if (!nodes.get(id).ref) visit(nodes.get(id));
    const maxCol = Math.max(...[...nodes.values()].filter(isPlaced).map((n) => n.col));
    nextComponentCol = maxCol + 2;
    return true;
  };

  // Una flecha hacia una hoja (nodo sin hijos) que quedó lejos de su padre se dibuja hacia una
  // copia de la hoja junto al padre, en vez de tirar una línea larga: preferentemente en el lado
  // que le tocaba a esa flecha, si no en el primero libre. Sin lado libre, se queda la línea.
  // Una flecha hacia un empalme de una hoja cuenta como flecha hacia la hoja.
  // Tiene hijos si alguna flecha sale de él o de alguno de sus empalmes (a los de una hoja, como
  // ioDb, solo le llegan flechas).
  const hasChildren = (id) => edges.some((x) => x.from === id && (!x.bus || hasChildren(x.to)));
  const near = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
  // Qué copiar para una flecha u -> target lejana: la hoja (target, o el dueño hoja de un empalme)
  // o, si target es un empalme cuyo dueño tiene hijos, el propio empalme (su pastilla dice de quién es).
  const farLeaf = (u, target) => {
    if (near(u, target) || target.ref) return null;
    if (target.shape === "junction") {
      const owner = nodes.get(target.junctionOf);
      return owner && !owner.ref && !hasChildren(owner.id) ? owner : target;
    }
    return hasChildren(target.id) ? null : target;
  };
  let copies = 0;
  const copyOfLeaf = (leaf, e) => {
    const copy = { ...leaf, id: `${leaf.id}\u29c9${++copies}`, copyOf: leaf.id };
    if (leaf.shape !== "junction") copy.realId = leaf.realId || leaf.id; // un empalme se identifica por junctionOf
    delete copy.col;
    delete copy.row;
    nodes.set(copy.id, copy);
    for (const [k, id] of pending) if (id === `copy:${e.index}`) pending.set(k, copy.id);
    e.to = copy.id;
    return copy;
  };
  // Respaldo al final: flechas que no pasaron por expand (p. ej. de grupos reconstruidos). Los
  // empalmes que se quedan sin ramas se quitan.
  const copyLeaves = () => {
    for (const e of [...edges].sort((a, b) => a.index - b.index)) {
      if (e.bus || e.attached) continue;
      const u = nodes.get(e.from);
      const leaf = farLeaf(u, nodes.get(e.to));
      if (!leaf) continue;
      const side = [e.dir, ...sidesOf(u)].find((d) => d && !blocked(cellAt(u, d)));
      if (!side) continue;
      const copy = copyOfLeaf(leaf, e);
      e.dir = side;
      const v = DIR_VECTORS[side];
      place(copy, u.col + v.dc, u.row + v.dr, `copia de ${who(leaf)} junto a ${who(u)}, ${SIDE_AT[side]}: el original está lejos y no tiene hijos`);
    }
    for (let removed = true; removed; ) {
      removed = false;
      for (const j of [...nodes.values()]) {
        if (j.shape !== "junction") continue;
        // Solo se quita un empalme que ya no tiene ramas: como mucho le queda la extensión que
        // llega (una copia de empalme tiene su flecha, que es una rama).
        const own = edges.filter((x) => x.from === j.id || x.to === j.id);
        if (own.length > 1 || own.some((x) => !x.bus)) continue;
        for (const x of own) edges.splice(edges.indexOf(x), 1);
        nodes.delete(j.id);
        occupied.delete(`${j.col},${j.row}`);
        removed = true;
      }
    }
  };

  // Fija la geometría de una arista sabiendo en qué lado de u está el otro extremo.
  const setSide = (e, u, side) => {
    if (e.attached) {
      e.slot = e.to === u.id ? side : OPPOSITE[side];
      e.dir = OPPOSITE[e.slot];
    } else e.dir = e.from === u.id ? side : OPPOSITE[side];
  };

  // Un nodo sin padre que todavía no puede pegarse a ningún hijo se aplaza: quizá otro grupo
  // coloque después alguno de sus hijos. Al final se reintenta hasta que no haya avances, y los
  // que sigan sin poder pegarse empiezan un grupo nuevo, en su orden.
  // Los nodos con padre que no se alcanzaron (ciclos) y las referencias sueltas van después de los
  // aplazados: un aplazado puede ser justo el padre que los alcanza.
  const waiting = [];
  const starts = roots.filter((n) => !n.ref && !hasIncoming.has(n.id));
  for (const root of starts) {
    if (root.col !== undefined || isAttachedRef(root)) continue;
    const anchor = findAnchor(root);
    if (!anchor && occupied.size) waiting.push(root);
    else placeRoot(root, anchor);
  }
  // Primero se reintenta el anclaje simple (el inicio junto a un hijo ya colocado); si no basta,
  // se reconstruye el grupo desde su primera conexión con lo ya colocado (placeGroupByLink).
  for (let progress = true; progress; ) {
    progress = false;
    for (const root of waiting) {
      if (root.col !== undefined) continue;
      const anchor = findAnchor(root);
      if (anchor) placeRoot(root, anchor, true);
      else if (!placeGroupByLink(root)) continue;
      progress = true;
    }
  }
  for (const root of waiting) if (root.col === undefined) placeRoot(root, null, true);
  for (const root of roots) {
    if (root.col !== undefined || isAttachedRef(root)) continue;
    placeRoot(root, findAnchor(root));
  }
  copyLeaves();
  history[step - 1] = snapshot(); // el último paso, ya con la limpieza de empalmes
  return history;
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
    const tm = textMetrics(e.css, measure, opts);
    const labelW = tm.measure(e.label) + 24;
    const labelH = tm.lineHeight + 16;
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
    case "junction":
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
      w: textMetrics(edge.css, measure, opts).measure(edge.label) + 12,
      h: textMetrics(edge.css, measure, opts).lineHeight + 4,
    };
  }
}

if (typeof module !== "undefined") module.exports = { layoutDiagram, wrapText, LAYOUT_DEFAULTS };
