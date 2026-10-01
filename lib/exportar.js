// Exportar a SVG y PNG sin navegador: el mismo motor (parser, layout, render) en Node, midiendo el
// texto con DejaVu Sans; el PNG lo pinta resvg (WebAssembly) con esas mismas fuentes.

const fs = require("node:fs");
const path = require("node:path");
const { parseDiagram } = require("../src/parser.js");
const { layoutDiagram } = require("../src/layout.js");
const { renderSvg, THEME } = require("../src/render.js");
const { fuente, medirTexto, FAMILIA } = require("./fuentes.js");

// SVG del diagrama (con sombra y pastillas de id, como al exportar desde el visor) y avisos.
function aSvg(source) {
  const layout = layoutDiagram(parseDiagram(source), { measure: medirTexto, fontFamily: FAMILIA });
  return { svg: renderSvg(layout, THEME, { ids: true }), warnings: layout.warnings };
}

let resvgListo = null;
async function resvg() {
  const mod = require("@resvg/resvg-wasm");
  if (!resvgListo) {
    const wasm = path.join(path.dirname(require.resolve("@resvg/resvg-wasm")), "index_bg.wasm");
    resvgListo = mod.initWasm(fs.readFileSync(wasm));
  }
  await resvgListo;
  return mod;
}

// PNG sobre blanco (como desde el visor: muchas galerías muestran lo transparente en negro).
async function aPng(svg, escala = 2) {
  const { Resvg } = await resvg();
  const r = new Resvg(svg, {
    background: "#ffffff",
    fitTo: { mode: "zoom", value: escala },
    font: {
      loadSystemFonts: false,
      fontBuffers: [fuente("normal"), fuente("negrita"), fuente("mono")],
      defaultFontFamily: "DejaVu Sans",
      sansSerifFamily: "DejaVu Sans",
      monospaceFamily: "DejaVu Sans Mono",
    },
  });
  return r.render().asPng();
}

module.exports = { aSvg, aPng };
