// Layout: opciones por defecto y constantes compartidas por los módulos de src/layout/.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LayoutBase = factory();
})(typeof self !== "undefined" ? self : this, function () {
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
    subroutine: 170,
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
// Un empalme se dibuja como una pastilla con el id de su dueño ("● A8"): mide lo que su texto. Las
// medidas deben coincidir con THEME.idPill de render.js (texto monoespaciado).
const PILL_FONT = 12;
const PILL_HEIGHT = 18;
const pillWidth = (text) => text.length * PILL_FONT * 0.62 + 12;
const junctionLabel = (owner) => `\u25cf ${owner}`;
const OPPOSITE = { down: "up", up: "down", left: "right", right: "left" };

// Enlace tardío: la función se busca en obj al llamarla, para usar funciones que otro módulo
// añade a obj después (los módulos de la rejilla se llaman entre sí).
const late = (obj, name) => (...args) => obj[name](...args);

return { LAYOUT_DEFAULTS, DIR_VECTORS, DEFAULT_DIRS, MAX_CONNECTIONS, PILL_FONT, PILL_HEIGHT, pillWidth, junctionLabel, OPPOSITE, late };
});
