// Layout: grafo parseado -> posiciones.
//
// Cada nodo ocupa una celda (col, row) de una rejilla. Un hijo se coloca en la celda vecina
// de su padre según la dirección de la arista (reglas en SPEC.md). Después, el ancho de cada
// columna y el alto de cada fila se ajustan al nodo más grande que contienen.
//
// Cada subgraph es un diagrama aparte, colocado a la derecha del anterior (ver SPEC.md).

// Módulos UMD (patrón returnExports de github.com/umdjs/umd): en Node se cargan con require; en el
// navegador, lib/html.js los incrusta en orden y cada uno deja su objeto en una variable global.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./layout/base.js"),
      require("./layout/text.js"),
      require("./layout/directions.js"),
      require("./layout/junctions.js"),
      require("./layout/grid.js"),
      require("./layout/geometry.js"),
      require("./engines/jesjack.js")
    );
  } else {
    root.DiagramLayout = factory(
      root.LayoutBase,
      root.LayoutText,
      root.LayoutDirections,
      root.LayoutJunctions,
      root.LayoutGrid,
      root.LayoutGeometry,
      root.JesjackEngine
    );
  }
})(typeof self !== "undefined" ? self : this, function (base, text, dirs, junctions, grid, geometry, jesjack) {
const { LAYOUT_DEFAULTS, PILL_HEIGHT, pillWidth, junctionLabel } = base;
const { wrapText, baseFont, sizeNode } = text;
const { assignDirections, nodeLabel } = dirs;
const { addJunctions } = junctions;
const { placeInGrid } = grid;
const { computeCoordinates, routeEdge } = geometry;

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

  // Un diagrama por grupo (el nivel superior y cada subgraph), uno tras otro hacia donde marque
  // la cabecera (flowchart TB: hacia abajo; LR: a la derecha; BT: hacia arriba; RL: a la izquierda).
  const parts = splitBySubgraph(graph, warnings);
  const flow = graph.meta.flow || "TB";
  const nodes = [];
  const edges = [];
  const titles = [];
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
    const w = Math.max(r.bounds.maxX - r.bounds.minX, titleW);
    const h = titleH + r.bounds.maxY - r.bounds.minY;
    done.push({ r, part, firstStep, steps: r.steps, titleH, w, h });
  }
  // Esquina superior izquierda de cada bloque; en BT y RL el primero queda abajo o a la derecha.
  const horizontal = flow === "LR" || flow === "RL";
  const order = flow === "BT" || flow === "RL" ? [...done].reverse() : done;
  let cursor = 0;
  for (const d of order) {
    d.left = horizontal ? cursor : 0;
    d.top = horizontal ? 0 : cursor;
    cursor += (horizontal ? d.w : d.h) + opts.diagramGap;
  }
  let bounds = null;
  for (const [i, d] of done.entries()) {
    const { r, part } = d;
    d.index = i;
    d.dx = d.left - r.bounds.minX;
    d.dy = d.top + d.titleH - r.bounds.minY;
    for (const n of r.nodes) {
      n.x += d.dx;
      n.y += d.dy;
      n.diagram = i; // índice del diagrama (nivel superior y subgraphs, en orden de declaración)
      nodes.push(n);
    }
    for (const e of r.edges) {
      for (const p of e.points) {
        p.x += d.dx;
        p.y += d.dy;
      }
      if (e.labelBox) {
        e.labelBox.x += d.dx;
        e.labelBox.y += d.dy;
      }
      e.diagram = i;
      edges.push(e);
    }
    if (part.title) titles.push({ text: part.title, x: d.left, y: d.top + opts.lineHeight / 2 });
    Object.assign(d, { nodes: [...r.nodes], edges: [...r.edges], titles: [...titles] });
    const b = { minX: d.left, minY: d.top, maxX: d.left + d.w, maxY: d.top + d.h };
    bounds = bounds
      ? { minX: 0, minY: 0, maxX: Math.max(bounds.maxX, b.maxX), maxY: Math.max(bounds.maxY, b.maxY) }
      : { ...b, minX: 0, minY: 0 };
  }
  // Paso k: los diagramas anteriores completos y el del paso k tal como estaba entonces.
  const snapshotAt = (k) => {
    const i = Math.max(0, done.findIndex((d) => k < d.firstStep + d.steps));
    const cur = done[i] || done[done.length - 1];
    const snap = cur.r.snapshotAt(Math.min(k - cur.firstStep, cur.steps - 1));
    const dx = cur.left - snap.bounds.minX;
    const dy = cur.top + cur.titleH - snap.bounds.minY;
    const moved = snap.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy, diagram: cur.index }));
    const movedEdges = snap.edges.map((e) => ({
      ...e,
      diagram: cur.index,
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
  // Un subgraph sin direction hereda la del que lo contiene y, al final, la de la cabecera.
  const flowOf = (g) => (g ? byId.get(g).direction || flowOf(byId.get(g).parent) : graph.meta.flow);
  const groups = [null, ...graph.subgraphs.map((s) => s.id)];
  const parts = new Map(
    groups.map((g) => [
      g,
      { group: g, nodes: new Map(), edges: [], meta: { dirs: [], flow: flowOf(g) }, title: g ? fullTitle(byId.get(g)) : null },
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
  if (opts.engine === "jesjack") return layoutJesjack(graph, measure, opts, warnings);
  const nodes = new Map();
  // Un empalme elegido con @bus mide lo que su pastilla, como los automáticos.
  const size = (n) =>
    n.shape === "junction" ? { lines: [], w: pillWidth(junctionLabel(n.junctionOf)), h: PILL_HEIGHT, lineHeight: opts.lineHeight } : sizeNode(n, measure, opts);
  for (const n of graph.nodes.values()) nodes.set(n.id, { ...n, ...size(n) });

  const edges = graph.edges.map((e) => ({ ...e }));
  const dirs = graph.meta.dirs.map((d) => ({ ...d }));
  addJunctions(nodes, edges, dirs, opts);
  const ctx = assignDirections(nodes, edges, dirs, warnings);
  ctx.flow = graph.meta.flow || "TB";
  const history = placeInGrid(nodes, edges, warnings, ctx);
  const bounds = computeCoordinates(nodes, edges, measure, opts);
  for (const e of edges) routeEdge(e, nodes.get(e.from), nodes.get(e.to), measure, opts);

  // Coordenadas del diagrama tal como estaba al terminar el paso k (se calculan al pedirlas).
  const snapshotAt = (k) => {
    const h = history[k];
    const snapNodes = new Map(h.pos.map(([n, col, row]) => [n.id, { ...n, col, row }]));
    // Una flecha que más adelante se reconduce (a un empalme, una copia o un conector) no se
    // dibuja mientras esté en diagonal o pase por encima de un nodo: es provisional.
    const occ = new Set([...snapNodes.values()].map((n) => `${n.col},${n.row}`));
    const provisional = (x) => {
      if (x.orig.from === x.from && x.orig.to === x.to) return false;
      const a = snapNodes.get(x.from);
      const b = snapNodes.get(x.to);
      if (a.col !== b.col && a.row !== b.row) return true;
      const n = Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
      for (let i = 1; i < n; i++) {
        if (occ.has(`${a.col + Math.sign(b.col - a.col) * i},${a.row + Math.sign(b.row - a.row) * i}`)) return true;
      }
      return false;
    };
    const snapEdges = h.edges.filter((x) => !provisional(x)).map((x) => ({ ...x }));
    const b = computeCoordinates(snapNodes, snapEdges, measure, opts);
    for (const x of snapEdges) routeEdge(x, snapNodes.get(x.from), snapNodes.get(x.to), measure, opts);
    return { nodes: [...snapNodes.values()], edges: snapEdges, bounds: b };
  };
  return { nodes: [...nodes.values()], edges, bounds, steps: history.length, snapshotAt };
}

// Adaptador de jesjack engine (contrato en src/engines/jesjack.js): el motor solo recibe ids y
// conexiones y devuelve celdas; aquí se miden los nodos, se pasan sus x,y (celdas) a col,row y se
// reutiliza la conversión a píxeles y el trazado de main engine. El paso k muestra los k+1 primeros
// nodos en el orden en que el motor los devolvió.
function layoutJesjack(graph, measure, opts, warnings) {
  const input = {
    nodes: [...graph.nodes.values()].map((n) => ({ id: n.id })),
    connections: graph.edges.map((e) => ({ index: e.index, from: e.from, to: e.to })),
  };
  const out = jesjack.jesjackEngine(input);
  const original = new Map(graph.edges.map((e) => [e.index, e]));
  const nodes = new Map();
  out.nodes.forEach((o, step) => {
    const n = o.junctionOf
      ? { id: o.id, shape: "junction", text: "", lines: [], w: pillWidth(junctionLabel(o.junctionOf)), h: PILL_HEIGHT,
          lineHeight: opts.lineHeight, junctionOf: o.junctionOf }
      : graph.nodes.get(o.id);
    if (!n) throw new Error(`jesjack engine: nodo desconocido '${o.id}'`);
    const sized = o.junctionOf ? n : { ...n, ...sizeNode(n, measure, opts) };
    nodes.set(o.id, { ...sized, col: o.x, row: o.y, step, why: "jesjack engine" });
  });
  for (const id of graph.nodes.keys()) if (!nodes.has(id)) throw new Error(`jesjack engine: falta el nodo '${id}'`);
  // Mismo aviso que place() de main engine: dos nodos en la misma celda.
  const occupied = new Map();
  for (const n of nodes.values()) {
    const key = `${n.col},${n.row}`;
    if (occupied.has(key))
      warnings.push({ line: n.line, message: `Choque: ${nodeLabel(n)} ocupa la misma posición que ${nodeLabel(occupied.get(key))}` });
    else occupied.set(key, n);
  }
  const edges = out.connections.map((c) => {
    if (!nodes.has(c.from) || !nodes.has(c.to)) throw new Error(`jesjack engine: conexión ${c.from} -> ${c.to} con un extremo desconocido`);
    if (c.index === undefined)
      return { from: c.from, to: c.to, label: null, arrowStart: false, arrowEnd: false, style: "solid", bus: true };
    if (!original.has(c.index)) throw new Error(`jesjack engine: conexión con index ${c.index} desconocido`);
    return { ...original.get(c.index), from: c.from, to: c.to };
  });
  const bounds = computeCoordinates(nodes, edges, measure, opts);
  for (const e of edges) routeEdge(e, nodes.get(e.from), nodes.get(e.to), measure, opts);
  const order = [...nodes.values()];
  const snapshotAt = (k) => {
    const snapNodes = new Map(order.slice(0, k + 1).map((n) => [n.id, { ...n }]));
    const snapEdges = edges.filter((e) => snapNodes.has(e.from) && snapNodes.has(e.to)).map((e) => ({ ...e }));
    const b = computeCoordinates(snapNodes, snapEdges, measure, opts);
    for (const x of snapEdges) routeEdge(x, snapNodes.get(x.from), snapNodes.get(x.to), measure, opts);
    return { nodes: [...snapNodes.values()], edges: snapEdges, bounds: b };
  };
  return { nodes: order, edges, bounds, steps: order.length, snapshotAt };
}

return { layoutDiagram, wrapText, LAYOUT_DEFAULTS };
});
