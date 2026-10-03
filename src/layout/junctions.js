// Layout: empalmes (nodos de paso con la pastilla de su dueño) para nodos con más de 4 conexiones.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./base.js"));
  else root.LayoutJunctions = factory(root.LayoutBase);
})(typeof self !== "undefined" ? self : this, function (base) {
const { MAX_CONNECTIONS, PILL_HEIGHT, pillWidth, junctionLabel } = base;

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
    w: pillWidth(junctionLabel(owner.junctionOf || owner.realId || owner.id)),
    h: PILL_HEIGHT,
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

// Un nodo solo tiene 4 lados. Si tiene más vecinos (padres + hijos, contando las referencias
// de su diagrama), conserva las 3 primeras en orden de declaración y la 4ª es una extensión: una
// línea sin flecha hasta un punto de empalme, del que salen las demás. El empalme tiene 3 lados
// libres; si no le bastan, se queda con 2 y encadena otro empalme, y así sucesivamente.
function addJunctions(nodes, edges, dirs, opts) {
  const touching = (id) =>
    edges.filter((e) => (e.from === id || e.to === id) && e.from !== e.to).sort((a, b) => a.index - b.index);
  // Se cuentan vecinos, no flechas: la ida y la vuelta con el mismo nodo (a --> b y b --> a, un
  // ciclo) ocupan un solo lado, así que van juntas, en el nodo o en el mismo empalme.
  const queue = [...nodes.keys()];
  while (queue.length) {
    const id = queue.shift();
    const conns = touching(id);
    const groups = new Map(); // vecino -> sus flechas, en orden de la primera
    for (const e of conns) {
      const other = e.from === id ? e.to : e.from;
      if (!groups.has(other)) groups.set(other, []);
      groups.get(other).push(e);
    }
    if (groups.size <= MAX_CONNECTIONS) continue;
    const moved = [...groups.values()].slice(MAX_CONNECTIONS - 1).flat();
    // La extensión ocupa el sitio de la 4ª conexión en el orden de declaración; un @dir de una
    // conexión movida pasa a la rama que sale del empalme.
    const j = addJunction(nodes, edges, nodes.get(id), moved[0].index - 0.5, moved[0].line, opts.lineHeight);
    for (const e of moved) moveEnd(e, id, j.id, dirs);
    queue.push(j.id);
  }
}

return { addJunction, moveEnd, addJunctions };
});
