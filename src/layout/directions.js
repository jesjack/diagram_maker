// Layout: dirección de cada arista y lado de cada nodo que ocupa (reglas en SPEC.md).

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../parser.js"), require("./base.js"));
  } else {
    // DiagramError es una clase de parser.js: global, pero no propiedad de window.
    root.LayoutDirections = factory({ DiagramError }, root.LayoutBase);
  }
})(typeof self !== "undefined" ? self : this, function ({ DiagramError }, base) {
const { DEFAULT_DIRS, OPPOSITE } = base;

// Las referencias entrantes (arista "attached": ref -> nodo) ocupan un hueco del nodo destino como si
// fueran una salida más, en el orden de declaración de las aristas (salvo la que hace de padre, arriba).
// e.slot es el lado del nodo donde va la referencia; e.dir sigue siendo la dirección de la flecha.
function assignDirections(nodes, edges, metaDirs, warnings = []) {
  const ctx = { nodes, edges, warnings, overrides: new Map(metaDirs.map((d) => [`${d.from}\u0000${d.to}`, d])) };
  const deferred = [];
  for (const node of nodes.values()) {
    if (node.ref && edges.some((e) => e.attached && e.from === node.id)) continue;
    deferred.push(...assignSlots(node, ctx));
  }
  for (const d of deferred) resolveDeferred(d, ctx);
  sameSide(edges);
  return ctx;
}

// Flechas entre el mismo par de nodos (ida y vuelta) que no recibieron lado: copian el de la que
// sí lo tiene, visto desde su propio origen.
function sameSide(edges) {
  for (const e of edges) {
    if (e.dir || e.bus) continue;
    const mate = edges.find(
      (x) => x !== e && x.dir && ((x.from === e.from && x.to === e.to) || (x.from === e.to && x.to === e.from))
    );
    if (!mate) continue;
    const same = mate.from === e.from;
    if (e.attached) {
      e.slot = same ? mate.slot || OPPOSITE[mate.dir] : mate.dir;
      e.dir = OPPOSITE[e.slot];
    } else e.dir = same ? mate.dir : OPPOSITE[mate.dir];
  }
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
      throw new DiagramError(
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
  // valores por defecto libres, en orden de declaración. Las flechas hacia un mismo vecino (ida y
  // vuelta de un ciclo) comparten lado: solo la primera reparte, las demás copian (sameSide).
  const neighbor = (e) => (e.from === node.id ? e.to : e.from);
  const seen = new Set();
  const conns = [...out, ...att]
    .sort((a, b) => a.index - b.index)
    .filter((e) => (seen.has(neighbor(e)) ? false : seen.add(neighbor(e))));
  const primaryOut = out.filter((e) => conns.includes(e));
  // Un @dir es una preferencia: se usa si ese lado está libre y, si no, la conexión toma un lado
  // por defecto como cualquier otra, con un aviso. Nunca es error ni provoca un choque (al colocar,
  // la cascada de la regla 10 puede moverla igual que a las demás).
  for (const e of conns) {
    const o = overrides.get(`${e.from}\u0000${e.to}`);
    if (!o || e.dir) continue;
    e.prefDir = o;
    const side = e.attached ? OPPOSITE[o.dir] : o.dir;
    if (!used.has(side)) take(e, side, o.line);
    else dirIgnored(ctx, o, "otra conexión de ese nodo ya pedía ese lado");
  }
  // Un nodo sin padre real (p. ej. el primero de un subgraph) toma su primera referencia
  // entrante como padre: va arriba y el flujo sigue hacia abajo, como en "iArr --> S1 --> S2".
  // Si el nodo está anclado a su primer hijo, ese hijo hace de padre y la referencia es una salida más.
  const hasRealParent = anchor || edges.some((e) => !e.attached && e.to === node.id && e.from !== node.id);
  const firstAtt = att.find((e) => !e.dir);
  if (!hasRealParent && firstAtt && !used.has("up")) take(firstAtt, "up", firstAtt.line);

  const defaults = DEFAULT_DIRS[node.shape === "diamond" ? "diamond" : "other"];
  const free = defaults.filter((d) => !used.has(d));
  let pendingOut = primaryOut.filter((e) => !e.dir).length;
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

// Aviso (una vez por @dir) cuando no se puede respetar.
function dirIgnored(ctx, o, why) {
  ctx.ignoredDirs = ctx.ignoredDirs || new Set();
  if (ctx.ignoredDirs.has(o)) return;
  ctx.ignoredDirs.add(o);
  ctx.warnings.push({ line: o.line, message: `@dir ${o.from} -> ${o.to} : ${o.dir} no se pudo respetar (${why})` });
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

return { assignDirections, sameSide, assignSlots, dirIgnored, resolveDeferred, nodeLabel };
});
