// Layout, rejilla: hacer sitio a un nodo que no cabe junto a su padre (extensiones con empalme
// e inserción de filas o columnas).

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./base.js"), require("./junctions.js"));
  } else {
    root.LayoutGridRoom = factory(root.LayoutBase, root.LayoutJunctions);
  }
})(typeof self !== "undefined" ? self : this, function (base, { addJunction, moveEnd }) {
const { DIR_VECTORS, OPPOSITE } = base;

// g: estado de la rejilla (ver placeInGrid en grid.js).
function roomTools(g) {
  const { nodes, edges, occupied, pending, SIDE_NAME, SIDE_AT, who, crossedBy, closeStep, place,
    sideOf, cellAt, isPlaced, conns, setSide } = g;
  // Un nodo sin ningún lado libre en su padre. Cascada finita, de lo más local a lo más global:
  //  1. Extensión en línea recta por el lado de un hermano (sin colocar, o colocado pero hoja con
  //     una sola conexión, que se puede mover) o por un lado libre, hasta un empalme a 1..8 celdas
  //     que tenga sitio: el hermano va recto si puede (si no, a otro lado libre del empalme) y el
  //     nodo a un lado libre. La línea no atraviesa nodos.
  //  2. Si ninguna dirección sirve: se inserta una fila o columna junto al padre (la que menos
  //     flechas alarga) y el nodo va directamente a la celda que queda libre. Siempre funciona.
  const MAX_REACH = 8;
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
  // Hace sitio junto a parent cuando no queda nada más (último paso de la cascada). Se desplaza
  // una celda hacia un lado el **mínimo bloque de nodos** necesario para liberar las celdas que
  // hacen falta: los que las ocupan, los que estos empujan en cadena, los unidos a un nodo movido
  // por una flecha perpendicular al desplazamiento (si no, quedaría en diagonal) y los extremos de
  // las líneas sobre las que caería un nodo movido. Las flechas paralelas solo se alargan. Gana el
  // lado que mueve menos nodos; si ninguno sirve sin mover al propio padre, se desplaza todo lo que
  // queda más allá (como insertar una fila o columna entera).
  const insertLine = (parent, node, e, wanted) => {
    closeStep();
    const key = (c, r) => `${c},${r}`;
    const isPlaced = (n) => n && n.col !== undefined;
    const placedEdges = edges.filter((x) => isPlaced(nodes.get(x.from)) && isPlaced(nodes.get(x.to)));
    const ends = (x) => [nodes.get(x.from), nodes.get(x.to)];
    const linesAt = (c, r) =>
      placedEdges.filter((x) => {
        const [a, b] = ends(x);
        if (a.col === b.col && a.col === c) return r > Math.min(a.row, b.row) && r < Math.max(a.row, b.row);
        if (a.row === b.row && a.row === r) return c > Math.min(a.col, b.col) && c < Math.max(a.col, b.col);
        return false;
      });
    const beyond = (n, d) =>
      d === "down" ? n.row > parent.row : d === "up" ? n.row < parent.row : d === "right" ? n.col > parent.col : n.col < parent.col;
    const throughOf = (d) => {
      const v = DIR_VECTORS[d];
      return edges.find((x) => {
        if (x === e || (x.from !== parent.id && x.to !== parent.id)) return false;
        const o = nodes.get(x.from === parent.id ? x.to : x.from);
        if (!isPlaced(o)) return false;
        return Math.sign(o.col - parent.col) === v.dc && Math.sign(o.row - parent.row) === v.dr && (v.dc ? o.row === parent.row : o.col === parent.col);
      });
    };
    // Conjunto mínimo a desplazar hacia d para dejar libres `cells` (sin nodos ni líneas); null si
    // haría falta mover algo que no está más allá del padre.
    const pushPlan = (d, cells, ignore) => {
      const v = DIR_VECTORS[d];
      const vertical = v.dr !== 0;
      const S = new Set();
      const queue = [];
      const add = (n) => {
        if (!n || S.has(n.id)) return true;
        if (!beyond(n, d)) return false;
        S.add(n.id);
        queue.push(n);
        return true;
      };
      for (const [c, r] of cells) {
        if (!add(occupied.get(key(c, r)))) return null;
        for (const x of linesAt(c, r)) {
          if (x === ignore) continue;
          const [a, b] = ends(x);
          if (!add(a) || !add(b)) return null;
        }
      }
      while (queue.length) {
        const n = queue.shift();
        const nc = n.col + v.dc;
        const nr = n.row + v.dr;
        if (!add(occupied.get(key(nc, nr)))) return null; // empuje en cadena
        for (const x of linesAt(nc, nr)) {
          // caería encima de una línea: sus extremos se mueven con él
          const [a, b] = ends(x);
          if (!add(a) || !add(b)) return null;
        }
        for (const x of placedEdges) {
          if (x.from !== n.id && x.to !== n.id) continue;
          const o = nodes.get(x.from === n.id ? x.to : x.from);
          const perpendicular = vertical ? o.row === n.row : o.col === n.col;
          if (!perpendicular) continue;
          if (!add(o)) return null;
          // la línea se mueve entera: los nodos sobre los que caería se mueven también
          const len = Math.abs(o.col - n.col) + Math.abs(o.row - n.row);
          for (let i = 1; i < len; i++) {
            const c = n.col + Math.sign(o.col - n.col) * i + v.dc;
            const r = n.row + Math.sign(o.row - n.row) * i + v.dr;
            if (!add(occupied.get(key(c, r)))) return null;
          }
        }
      }
      return S;
    };
    // Comprueba un plan con las posiciones finales: al mover un extremo de una flecha paralela al
    // desplazamiento, esa flecha se alarga sobre la celda que deja libre; ninguna celda necesaria
    // puede quedar ocupada ni cruzada por una línea (salvo la flecha del padre que se reconduce).
    const cellsFreeAfter = (S, v, cells, ignore) => {
      const at = (n) => (S.has(n.id) ? { col: n.col + v.dc, row: n.row + v.dr } : n);
      const occ = new Set([...nodes.values()].filter(isPlaced).map((n) => `${at(n).col},${at(n).row}`));
      return cells.every(([c, r]) => {
        if (occ.has(`${c},${r}`)) return false;
        return !placedEdges.some((x) => {
          if (x === ignore) return false;
          const a = at(nodes.get(x.from));
          const b = at(nodes.get(x.to));
          if (a.col === b.col && a.col === c) return r > Math.min(a.row, b.row) && r < Math.max(a.row, b.row);
          if (a.row === b.row && a.row === r) return c > Math.min(a.col, b.col) && c < Math.max(a.col, b.col);
          return false;
        });
      });
    };
    const plans = [];
    for (const d of ["down", "right", "left", "up"]) {
      const v = DIR_VECTORS[d];
      const through = throughOf(d);
      const jc = { col: parent.col + v.dc, row: parent.row + v.dr };
      const laterals = through ? (v.dr ? ["right", "left"] : ["down", "up"]) : [null];
      for (const lateral of laterals) {
        const cells = [[jc.col, jc.row]];
        if (lateral) cells.push([jc.col + DIR_VECTORS[lateral].dc, jc.row + DIR_VECTORS[lateral].dr]);
        const S = pushPlan(d, cells, through);
        if (S && cellsFreeAfter(S, v, cells, through)) plans.push({ d, v, through, lateral, S });
      }
    }
    plans.sort((a, b) => a.S.size - b.S.size);
    let plan = plans[0];
    let whole = false;
    if (!plan) {
      // Ningún bloque local sirve: todo lo que queda más allá del padre (fila o columna entera).
      whole = true;
      const d = "down";
      const through = throughOf(d);
      const S = new Set([...nodes.values()].filter((n) => isPlaced(n) && beyond(n, d)).map((n) => n.id));
      plan = { d, v: DIR_VECTORS[d], through, lateral: through ? "right" : null, S };
    }
    const { d, v, through, lateral, S } = plan;
    const moved = [...S].map((id) => nodes.get(id));
    // Las reservas de celdas de hijos aún sin colocar se mueven con su padre.
    const parentOf = (id) => {
      const x = edges.find((y) => (id.startsWith("copy:") ? `copy:${y.index}` === id : y.from === id || y.to === id));
      if (!x) return null;
      return id.startsWith("copy:") ? nodes.get(x.from) : nodes.get(x.from === id ? x.to : x.from);
    };
    const pend = [...pending];
    pending.clear();
    for (const [k, id] of pend) {
      const par = parentOf(id);
      const [c, r] = k.split(",").map(Number);
      pending.set(par && S.has(par.id) ? key(c + v.dc, r + v.dr) : k, id);
    }
    for (const n of moved) occupied.delete(key(n.col, n.row));
    for (const n of moved) {
      n.col += v.dc;
      n.row += v.dr;
      occupied.set(key(n.col, n.row), n);
    }
    const what = whole
      ? `se desplazó todo lo que quedaba ${SIDE_AT[d] === "debajo" ? "debajo" : SIDE_AT[d]} (${moved.length} nodos)`
      : `se desplazaron ${moved.length} nodo${moved.length === 1 ? "" : "s"} ${SIDE_NAME[d] === "abajo" ? "hacia abajo" : SIDE_NAME[d] === "arriba" ? "hacia arriba" : `hacia ${SIDE_NAME[d]}`}`;
    const kind = node.copyOf ? `copia de ${who(nodes.get(node.copyOf))}, hija de` : e.attached ? "pegado a" : "hijo de";
    if (through) {
      const j = addJunction(nodes, edges, parent, Math.min(e.index, through.index) - 0.5, e.line, parent.lineHeight);
      edges[edges.length - 1].dir = d;
      place(j, parent.col + v.dc, parent.row + v.dr, `empalme junto a ${who(parent)}: ${who(node)} no tenía sitio y ${what}`);
      moveEnd(through, parent.id, j.id);
      setSide(through, j, d);
      moveEnd(e, parent.id, j.id);
      setSide(e, j, lateral);
      const sv = DIR_VECTORS[lateral];
      place(node, j.col + sv.dc, j.row + sv.dr, `${kind} ${who(parent)} a través de un empalme, ${SIDE_AT[lateral]} de él (no había sitio cerca: ${what})`);
      return [j];
    }
    setSide(e, parent, d);
    place(node, parent.col + v.dc, parent.row + v.dr, `${kind} ${who(parent)}, ${SIDE_AT[d]} (no había sitio cerca: ${what}; el lado de ${SIDE_NAME[wanted]} estaba ocupado)`);
    return [];
  };
  return { makeRoom, applyRoom, insertLine };
}

return { roomTools };
});
