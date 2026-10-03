// jesjack engine: motor de colocación escrito desde cero, alternativo a main engine (src/layout/).
// Se elige con layoutDiagram(graph, { engine: "jesjack" }); el adaptador está en src/layout.js.
//
// Entra (crudo, sin empalmes ni lados):
//   { nodes: [{ id }], connections: [{ index, from, to }] }
// Sale:
//   { nodes: [{ id, x, y, junctionOf? }], connections: [{ index?, from, to }] }
//   - x, y: celda de la rejilla (columna, fila), no píxeles.
//   - junctionOf: solo en los empalmes que cree el motor (id del nodo dueño).
//   - una conexión con index es la original con ese index (sus extremos pueden ser ya empalmes);
//     sin index, un tramo nuevo entre un nodo y su empalme.
//   - el orden de nodes es el del paso a paso del visor.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JesjackEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
function jesjackEngine({ nodes, connections }) {
  throw new Error("jesjack engine: sin implementar");
}

return { jesjackEngine };
});
