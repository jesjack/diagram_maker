// Página HTML autocontenida: la plantilla con el motor (parser, layout, render, visor) y el código
// del diagrama incrustados. Mismo resultado que diagram.py.

const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");
const MERMAID = path.join(__dirname, "..", "vendor", "mermaid.min.js.gz");
let mermaidB64 = null;
const mermaidIncrustado = () => (mermaidB64 ||= fs.readFileSync(MERMAID).toString("base64"));
const SCRIPTS = ["parser.js", "shapes.js", "layout/base.js", "layout/text.js", "layout/directions.js", "layout/junctions.js", "layout/grid-room.js", "layout/grid-groups.js", "layout/grid-cleanup.js", "layout/grid.js", "layout/geometry.js", "engines/jesjack.js", "layout.js", "render.js", "viewer.js"];

// JSON seguro para incrustar dentro de <script> (evita cerrar la etiqueta con "</").
const literal = (valor) => JSON.stringify(valor).replace(/<\//g, "<\\/");

// live: null (HTML normal) o { version } para la página servida con --watch, que pregunta al
// servidor por versiones nuevas del código. mermaid: incrustar Mermaid (~1,3 MB) para que el botón
// «Mermaid» funcione sin internet; con false (dmk --ligero) el botón no aparece. tema: "auto" (el del
// sistema), "claro" u "oscuro".
function construirHtml(source, title, live = null, { mermaid = true, tema = "auto" } = {}) {
  const plantilla = fs.readFileSync(path.join(SRC, "template.html"), "utf8");
  const scripts = SCRIPTS.map((f) => fs.readFileSync(path.join(SRC, f), "utf8")).join("\n");
  const valores = {
    __DIAGRAM_SOURCE__: literal(source),
    __DIAGRAM_TITLE__: literal(title),
    __DIAGRAM_LIVE__: literal(live),
    __DIAGRAM_THEME__: literal(tema),
    __DIAGRAM_MERMAID__: mermaid ? mermaidIncrustado() : "",
    __DIAGRAM_SCRIPTS__: scripts,
  };
  // Una sola pasada, para que el contenido insertado nunca se vuelva a sustituir.
  return plantilla.replace(new RegExp(Object.keys(valores).join("|"), "g"), (m) => valores[m]);
}

module.exports = { construirHtml };
