// Layout: colocación de los nodos en la rejilla (reglas en SPEC.md). Lo más largo de la cascada
// está en grid-room.js, grid-groups.js y grid-cleanup.js, que comparten el estado g.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./base.js"), require("./directions.js"),
      require("./grid-room.js"), require("./grid-groups.js"), require("./grid-cleanup.js"));
  } else {
    root.LayoutGrid = factory(root.LayoutBase, root.LayoutDirections, root.LayoutGridRoom,
      root.LayoutGridGroups, root.LayoutGridCleanup);
  }
})(typeof self !== "undefined" ? self : this, function (base, dirs, { roomTools }, { groupTools }, { cleanupTools }) {
const { DIR_VECTORS, DEFAULT_DIRS, OPPOSITE, late } = base;
const { sameSide, assignSlots, dirIgnored, resolveDeferred, nodeLabel } = dirs;

// ---------------------------------------------------------------- rejilla

function placeInGrid(nodes, edges, warnings, ctx) {
  // Estado compartido con los módulos grid-room, grid-groups y grid-cleanup (se completa abajo).
  const g = { nodes, edges, warnings, ctx, nextComponentCol: 0 };
  // Funciones de esos módulos que se usan antes de completar g: se buscan en g al llamarlas.
  const makeRoom = late(g, "makeRoom");
  const farLeaf = late(g, "farLeaf");
  const copyOfLeaf = late(g, "copyOfLeaf");
  const occupied = new Map(); // "col,row" -> nodo
  // Las referencias no cuentan como entrada: las pegadas se colocan junto a su destino y las
  // sueltas (sin lado libre) al final, cuando su destino ya está colocado.
  const hasIncoming = new Set(edges.filter((e) => !e.refEdge).map((e) => e.to));
  const isAttachedRef = (n) => edges.some((e) => e.attached && e.from === n.id);

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
      .map((x) => ({ ...x, orig: x })),
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
    if (blocked(cellAt(parent, side), node.id)) {
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
      } else {
        if (e.prefDir) dirIgnored(ctx, e.prefDir, "ese lado estaba ocupado");
        return makeRoom(parent, node, e, wanted);
      }
    }
    if (side !== wanted && e.prefDir) dirIgnored(ctx, e.prefDir, "ese lado estaba ocupado");
    const v = DIR_VECTORS[side];
    const kind = node.copyOf
      ? `copia de ${who(nodes.get(node.copyOf))} (el original está lejos${node.shape === "junction" ? "" : " y no tiene hijos"}), hija de`
      : e.attached ? "pegado a" : e.from === parent.id ? "hijo de" : "padre de";
    const moved = side !== wanted ? ` (el lado de ${SIDE_NAME[wanted]} estaba ocupado)` : "";
    place(node, parent.col + v.dc, parent.row + v.dr, `${kind} ${who(parent)}, ${SIDE_AT[side]}${moved}`);
    return [];
  };
  const isPlaced = (n) => n.col !== undefined;
  const sidesOf = (n) => [...DEFAULT_DIRS[n.shape === "diamond" ? "diamond" : "other"], "up"];
  const conns = (id) => edges.filter((x) => x.from === id || x.to === id);

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
    // Lados del nodo comprometidos por sus otros @dir: el hijo no puede quedar en ninguno de ellos.
    const committed = new Set();
    for (const x of edges) {
      if (x === edge) continue;
      const ox = ctx.overrides.get(`${x.from}\u0000${x.to}`);
      if (!ox) continue;
      if (x.from === node.id) committed.add(ox.dir);
      else if (x.attached && x.to === node.id) committed.add(OPPOSITE[ox.dir]);
    }
    const order = [...DEFAULT_DIRS[child.shape === "diamond" ? "diamond" : "other"], "up"];
    const cell = order.find(
      (d) => !committed.has(OPPOSITE[d]) && !blocked(`${child.col + DIR_VECTORS[d].dc},${child.row + DIR_VECTORS[d].dr}`, node.id)
    );
    return cell ? { edge, child, cell } : null;
  };

  // Raíces: primero los nodos sin aristas entrantes (en orden de declaración), luego el resto,
  // por si queda algún ciclo sin alcanzar.
  const all = [...nodes.values()];
  const real = all.filter((n) => !n.ref);
  const roots = [...real.filter((n) => !hasIncoming.has(n.id)), ...real, ...all.filter((n) => n.ref)];

  // Coloca los hijos directos (y referencias pegadas) de parent; devuelve los nodos nuevos a recorrer.
  // Qué nodo representa un nodo (una referencia, una copia o el original tienen la misma identidad;
  // un empalme o su copia, la de su dueño). Si el padre ya tiene pegado un representante del nodo
  // que necesita, la flecha va a ese en vez de crear otra referencia, copia o conector.
  const identity = (n) => (n.shape === "junction" ? `\u25cf${n.junctionOf}` : n.realId || n.id);
  // También vale una celda reservada para un representante que aún no se ha colocado (con el
  // recorrido en profundidad, el hermano que lo colocará puede no haberlo hecho todavía).
  // exclude: el nodo que se quiere sustituir (no cuenta como representante de sí mismo). Al buscar
  // en lugar de una copia, el original sí vale: no se excluye nada.
  const twinNextTo = (parent, target, exclude = target) => {
    for (const d of ["down", "right", "left", "up"]) {
      const key = cellAt(parent, d);
      const m = occupied.get(key) || (pending.has(key) && nodes.get(pending.get(key)));
      if (m && m !== exclude && m !== parent && identity(m) === identity(target)) return { node: m, side: d };
    }
    return null;
  };
  const reuseTwin = (e, parent, twin, why) => {
    const old = nodes.get(e.to);
    for (const [k, id] of pending) if (id === old.id || id === `copy:${e.index}`) pending.delete(k);
    if (old.col === undefined && edges.every((x) => x === e || (x.from !== old.id && x.to !== old.id))) nodes.delete(old.id);
    e.to = twin.node.id;
    e.dir = twin.side;
    twin.node.why += ` · también recibe la flecha de ${who(parent)} (${why})`;
  };

  const expand = (parent, each) => {
    const placed = [];
    for (const e of edges) {
      const mine = e.attached ? e.to === parent.id : e.from === parent.id;
      if (!mine) continue;
      const other = nodes.get(e.attached ? e.from : e.to);
      const willCopy = other.col !== undefined && !e.attached && farLeaf(parent, other);
      if (other.col !== undefined && !willCopy) continue;
      if (other.shape === "junction" && other.col === undefined && !e.bus) continue;
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
      // Un empalme solo lo coloca su dueño, por su extensión: una rama que llega a él espera.
      if (child.shape === "junction" && child.col === undefined && !e.bus) continue;
      // Referencia aún sin colocar: si el padre ya tiene pegado un representante del mismo nodo, se usa.
      if (child.col === undefined && child.ref && !e.bus) {
        const twin = twinNextTo(parent, child);
        if (twin) {
          reuseTwin(e, parent, twin, "ya tenía una referencia igual al lado");
          continue;
        }
      }
      if (child.col !== undefined) {
        if (e.bus) continue; // la extensión a un empalme propio nunca se copia
        // Hijo ya colocado lejos y sin hijos: se le pone una copia aquí, en su turno (regla 12).
        const leaf = farLeaf(parent, child);
        if (!leaf) continue; // TODO (SPEC): bucles / varios padres
        const twin = twinNextTo(parent, leaf, null);
        if (twin) {
          reuseTwin(e, parent, twin, "en vez de otra copia");
          continue;
        }
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
      sameSide(edges);
    } else {
      place(root, g.nextComponentCol, 0, step ? `inicio de un grupo nuevo, aparte${later}` : "nodo inicial");
    }

    visit(root);

    // El siguiente componente desconectado va a la derecha de todo lo colocado.
    const maxCol = Math.max(...[...nodes.values()].filter((n) => n.col !== undefined).map((n) => n.col));
    g.nextComponentCol = maxCol + 2;
  };

  // Fija la geometría de una arista sabiendo en qué lado de u está el otro extremo.
  const setSide = (e, u, side) => {
    if (e.attached) {
      e.slot = e.to === u.id ? side : OPPOSITE[side];
      e.dir = OPPOSITE[e.slot];
    } else e.dir = e.from === u.id ? side : OPPOSITE[side];
  };

  // g se completa con el estado y las funciones de aquí y con las de los otros módulos.
  Object.assign(g, { occupied, pending, SIDE_NAME, SIDE_AT, who, crossedBy, blocked, closeStep, place });
  Object.assign(g, { sideOf, cellAt, isPlaced, sidesOf, conns, placeNextTo, twinNextTo, reuseTwin, visit, setSide });
  Object.assign(g, roomTools(g), groupTools(g), cleanupTools(g));
  const { placeGroupByLink, copyLeaves, fixLongLinks, tidyUp } = g;

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
  fixLongLinks();
  tidyUp();
  history[step - 1] = snapshot(); // el último paso, ya con la limpieza de empalmes
  // Los empalmes que se quitaron al final (sin ramas) desaparecen de toda la historia y los pasos
  // se renumeran, para que el paso k siga teniendo k+1 nodos.
  const alive = new Set(nodes.keys());
  const keep = history.filter((h, k) => {
    const placedAt = h.pos.find(([n]) => n.step === k);
    return placedAt && alive.has(placedAt[0].id);
  });
  for (const h of keep) {
    h.pos = h.pos.filter(([n]) => alive.has(n.id));
    h.edges = h.edges.filter((x) => alive.has(x.from) && alive.has(x.to));
  }
  [...nodes.values()].sort((a, b) => a.step - b.step).forEach((n, i) => (n.step = i));
  return keep;
}

return { placeInGrid };
});
