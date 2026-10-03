// Layout, rejilla: copias de hojas lejanas, flechas largas o en diagonal y limpieza final de
// nodos autogenerados que sobran.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./base.js"));
  else root.LayoutGridCleanup = factory(root.LayoutBase);
})(typeof self !== "undefined" ? self : this, function (base) {
const { DIR_VECTORS, PILL_HEIGHT, pillWidth, junctionLabel } = base;

// g: estado de la rejilla (ver placeInGrid en grid.js).
function cleanupTools(g) {
  const { nodes, edges, occupied, pending, SIDE_AT, who, blocked, place, cellAt, sidesOf,
    placeNextTo, twinNextTo, reuseTwin } = g;
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
    pruneJunctions();
  };
  const pruneJunctions = () => {
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

  // Revisión final: una flecha que haya quedado en diagonal o pasando por encima de un nodo (p. ej.
  // la del segundo padre de un nodo colocado junto al primero) termina en un punto junto a su
  // origen con la pastilla de su destino (● F3), como una copia de empalme. Si el origen no tiene
  // sitio se usa la cascada de siempre (placeNextTo).
  const badLine = (x) => {
    const a = nodes.get(x.from);
    const b = nodes.get(x.to);
    if (a.col !== b.col && a.row !== b.row) return true;
    const n = Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
    const dc = Math.sign(b.col - a.col);
    const dr = Math.sign(b.row - a.row);
    for (let i = 1; i < n; i++) if (occupied.has(`${a.col + dc * i},${a.row + dr * i}`)) return true;
    return false;
  };
  const fixLongLinks = () => {
    let connectors = 0;
    for (const x of [...edges].sort((a, b) => a.index - b.index)) {
      if (x.bus || x.attached || !edges.includes(x)) continue;
      const u = nodes.get(x.from);
      const target = nodes.get(x.to);
      if (!u || !target || u.col === undefined || target.col === undefined || !badLine(x)) continue;
      const twin = twinNextTo(u, target);
      if (twin) {
        reuseTwin(x, u, twin, "en vez de un conector");
        continue;
      }
      const owner = target.junctionOf || target.realId || target.id;
      const dot = {
        id: `${target.id}\u2192${++connectors}`,
        shape: "junction",
        text: "",
        lines: [],
        w: pillWidth(junctionLabel(owner)),
        h: PILL_HEIGHT,
        lineHeight: target.lineHeight,
        line: x.line,
        group: target.group,
        junctionOf: owner,
        copyOf: target.id,
      };
      nodes.set(dot.id, dot);
      x.to = dot.id;
      placeNextTo(u, dot, x);
      dot.why = `conector hacia '${owner}': la flecha desde ${who(u)} quedaba en diagonal o pasaba por encima de un nodo. ${dot.why}`;
    }
    pruneJunctions();
  };

  // Limpieza final de nodos autogenerados que han quedado de sobra (se repite hasta que no cambia):
  //  a) una copia, referencia o conector con una sola arista cuyo otro extremo tiene ya pegado otro
  //     representante del mismo nodo (algo se movió después): la arista va a ese y este se quita;
  //  b) un empalme que solo conserva una rama alineada con su dueño (el empalme se creó de antemano,
  //     pero las demás conexiones acabaron en copias): la flecha va recta al dueño y se quita.
  //  c) un empalme de una cadena sin ramas, alineado con el anterior y el siguiente: se salta.
  const removeNode = (n) => {
    for (const x of edges.filter((y) => y.from === n.id || y.to === n.id)) edges.splice(edges.indexOf(x), 1);
    nodes.delete(n.id);
    if (occupied.get(`${n.col},${n.row}`) === n) occupied.delete(`${n.col},${n.row}`);
  };
  const tidyUp = () => {
    for (let changed = true; changed; ) {
      changed = false;
      for (const r of [...nodes.values()]) {
        if (!nodes.has(r.id) || r.col === undefined || !(r.copyOf || r.ref)) continue;
        const own = edges.filter((x) => x.from === r.id || x.to === r.id);
        if (own.length !== 1 || own[0].bus) continue;
        const e = own[0];
        const p = nodes.get(e.from === r.id ? e.to : e.from);
        const twin = twinNextTo(p, r);
        if (!twin || twin.node.col === undefined) continue;
        if (e.from === r.id) e.from = twin.node.id;
        else e.to = twin.node.id;
        twin.node.why += ` · también recibe la flecha de ${who(p)} (limpieza final: sobraba otro igual)`;
        removeNode(r);
        changed = true;
      }
      for (const j of [...nodes.values()]) {
        if (!nodes.has(j.id) || j.shape !== "junction" || j.copyOf || j.col === undefined) continue;
        const own = edges.filter((x) => x.from === j.id || x.to === j.id);
        // c) Empalme intermedio de una cadena que se ha quedado sin ramas (solo la extensión que
        //    llega y la que sigue) y alineado: la extensión va recta del anterior al siguiente.
        const into = own.filter((x) => x.bus && x.to === j.id);
        const onward = own.filter((x) => x.bus && x.from === j.id);
        if (own.length === 2 && into.length === 1 && onward.length === 1) {
          const a = nodes.get(into[0].from);
          const b = nodes.get(onward[0].to);
          const straight =
            (a.col === j.col && j.col === b.col && (a.row - j.row) * (b.row - j.row) < 0) ||
            (a.row === j.row && j.row === b.row && (a.col - j.col) * (b.col - j.col) < 0);
          if (straight) {
            into[0].to = b.id;
            edges.splice(edges.indexOf(onward[0]), 1);
            nodes.delete(j.id);
            if (occupied.get(`${j.col},${j.row}`) === j) occupied.delete(`${j.col},${j.row}`);
            changed = true;
            continue;
          }
          // En una esquina no se puede saltar (la línea quedaría en diagonal): pasa a ser un codo,
          // un punto sin tamaño ni pastilla donde la extensión gira.
          if (!j.elbow) {
            j.elbow = true;
            j.w = 0;
            j.h = 0;
            j.why += " · se quedó sin ramas: ahora es solo un codo de la línea";
          }
          continue;
        }
        const bus = own.filter((x) => x.bus && x.to === j.id);
        const branches = own.filter((x) => !x.bus);
        if (bus.length !== 1 || branches.length !== 1 || own.length !== 2) continue;
        const owner = nodes.get(bus[0].from);
        const x = branches[0];
        const b = nodes.get(x.from === j.id ? x.to : x.from);
        const inLine =
          (owner.col === j.col && j.col === b.col && (owner.row - j.row) * (b.row - j.row) < 0) ||
          (owner.row === j.row && j.row === b.row && (owner.col - j.col) * (b.col - j.col) < 0);
        if (!inLine) continue;
        if (x.from === j.id) x.from = owner.id;
        else x.to = owner.id;
        removeNode(j);
        changed = true;
      }
    }
  };
  return { farLeaf, copyOfLeaf, copyLeaves, fixLongLinks, tidyUp };
}

return { cleanupTools };
});
