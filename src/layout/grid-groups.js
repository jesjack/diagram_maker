// Layout, rejilla: grupos desconectados que se pegan a lo ya colocado por su primera conexión.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./base.js"), require("./junctions.js"));
  } else {
    root.LayoutGridGroups = factory(root.LayoutBase, root.LayoutJunctions);
  }
})(typeof self !== "undefined" ? self : this, function (base, { addJunction, moveEnd }) {
const { DIR_VECTORS, OPPOSITE, late } = base;

// g: estado de la rejilla (ver placeInGrid en grid.js).
function groupTools(g) {
  const { nodes, edges, occupied, pending, SIDE_NAME, who, crossedBy, blocked, place, cellAt,
    isPlaced, sidesOf, conns, visit, setSide } = g;
  const farLeaf = late(g, "farLeaf"); // de grid-cleanup.js
  // Grupo que no se puede pegar por su inicio: se busca la primera conexión (en orden de
  // declaración) entre cualquier nodo del grupo y un nodo ya colocado, y el grupo se reconstruye
  // desde ese punto: su nodo va junto a la pareja ya colocada y el resto se recorre desde ahí
  // siguiendo las aristas en cualquier sentido (las flechas no cambian), cada nodo en el primer
  // lado libre del anterior. Con a->b->c ya colocado, A->B->C y C->c queda a,b,c,C,B,A.
  const groupOf = (root) => {
    const group = new Set([root.id]);
    const queue = [root];
    while (queue.length) {
      const u = queue.shift();
      for (const e of edges) {
        const w = e.attached && e.to === u.id ? nodes.get(e.from) : !e.attached && e.from === u.id ? nodes.get(e.to) : null;
        if (!w || isPlaced(w) || group.has(w.id)) continue;
        if (w.shape === "junction" && !e.bus) continue; // el empalme entra al grupo con su dueño
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
        if (w.shape === "junction" && !e.bus) continue; // lo coloca su dueño, por su extensión
        const d = sidesOf(u).find((x) => free(pu, x));
        // Sin lado libre no se fuerza (sería un choque): el nodo se queda fuera de la reconstrucción
        // y lo coloca después el recorrido normal, con la cascada para hacer sitio (regla 10).
        if (!d) continue;
        const p = { col: pu.col + DIR_VECTORS[d].dc, row: pu.row + DIR_VECTORS[d].dr };
        taken.add(`${p.col},${p.row}`);
        pos.set(w.id, p);
        sides.push([e, u, d]);
        if (!w.ref) visit(w);
      }
    };
    visit(start);
    // Diagonales que dejaría: flechas entre el grupo y lo ya colocado que no quedan en la misma
    // fila o columna (salvo hacia hojas o empalmes, que luego se copian junto al padre).
    let diagonals = 0;
    for (const x of edges) {
      const inA = pos.get(x.from);
      const inB = pos.get(x.to);
      if (!!inA === !!inB) continue;
      const other = nodes.get(inA ? x.to : x.from);
      if (other.col === undefined) continue;
      if (inA && farLeaf({ col: inA.col, row: inA.row }, other)) continue;
      const p = inA || inB;
      if (p.col !== other.col && p.row !== other.row) diagonals++;
    }
    return { pos, sides, collisions, diagonals };
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
        const better = (a, b) => a.collisions < b.collisions || (a.collisions === b.collisions && a.diagonals < b.diagonals);
        if (!best || better(sim, best.sim)) best = { sim, link, start, cell };
        if (best.sim.collisions === 0 && best.sim.diagonals === 0) break;
      }
      if (best && best.sim.collisions === 0 && best.sim.diagonals === 0) break;
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
    g.nextComponentCol = maxCol + 2;
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
    g.nextComponentCol = maxCol + 2;
    return true;
  };
  return { placeGroupByLink };
}

return { groupTools };
});
