// Página HTML autocontenida: la plantilla con el motor (parser, layout, render, visor) y el código
// del diagrama incrustados. Mismo resultado que diagram.py.

const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");
const SCRIPTS = ["parser.js", "layout.js", "render.js", "viewer.js"];

// JSON seguro para incrustar dentro de <script> (evita cerrar la etiqueta con "</").
const literal = (valor) => JSON.stringify(valor).replace(/<\//g, "<\\/");

// live: null (HTML normal) o { version } para la página servida con --watch, que pregunta al
// servidor por versiones nuevas del código.
function construirHtml(source, title, live = null) {
  const plantilla = fs.readFileSync(path.join(SRC, "template.html"), "utf8");
  const scripts = SCRIPTS.map((f) => fs.readFileSync(path.join(SRC, f), "utf8")).join("\n");
  const valores = {
    __DIAGRAM_SOURCE__: literal(source),
    __DIAGRAM_TITLE__: literal(title),
    __DIAGRAM_LIVE__: literal(live),
    __DIAGRAM_SCRIPTS__: scripts,
  };
  // Una sola pasada, para que el contenido insertado nunca se vuelva a sustituir.
  return plantilla.replace(new RegExp(Object.keys(valores).join("|"), "g"), (m) => valores[m]);
}

module.exports = { construirHtml };
