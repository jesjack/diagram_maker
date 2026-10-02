// Herramienta de desarrollo: dibuja un caso con dos versiones del motor, lado a lado, para ver el
// "antes" y el "después" de un arreglo. Sacar la versión anterior con:
//   mkdir -p /tmp/antes && git archive <commit> src | tar -x -C /tmp/antes
// Uso: node tools/comparar.js <src_antes> <src_despues> <caso.mmd> <salida.png|svg> "<título>" [escala]
const fs = require("node:fs");
const path = require("node:path");
const [dirA, dirB, casoPath, out, titulo, escala = "2"] = process.argv.slice(2);
const src = fs.readFileSync(casoPath, "utf8");
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function dibuja(dir) {
  for (const k of Object.keys(require.cache)) if (k.startsWith(path.resolve(dir))) delete require.cache[k];
  const { parseDiagram } = require(path.resolve(dir, "parser.js"));
  const { layoutDiagram } = require(path.resolve(dir, "layout.js"));
  const { renderSvg } = require(path.resolve(dir, "render.js"));
  try {
    const r = layoutDiagram(parseDiagram(src));
    const auto = r.nodes.filter((n) => n.ref || n.copyOf || n.shape === "junction").length;
    const choques = r.warnings.filter((w) => /Choque/.test(w.message)).length;
    const svg = renderSvg(r, undefined, { shadow: false, ids: true });
    const m = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/);
    const nota = `(${r.nodes.length} nodos, ${auto} autogenerados${choques ? `, ${choques} choques` : ""})`;
    return { svg, w: +m[3], h: +m[4], nota };
  } catch (err) {
    const w = 520, h = 120;
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="8" fill="#ffebe9" stroke="#cf222e"/><text x="16" y="24" font-size="13" font-weight="600" fill="#cf222e">ERROR FATAL</text><text x="16" y="50" font-size="14" fill="#cf222e">${esc(err.message)}</text></svg>`,
      w, h, nota: "",
    };
  }
}

const A = dibuja(dirA);
const B = dibuja(dirB);
const pad = 24, head = 70, gap = 48;
const W = Math.max(pad * 2 + A.w + gap + B.w, 600);
const H = head + 30 + Math.max(A.h, B.h) + pad;
const inner = (d, x) => d.svg.replace(/^<svg /, `<svg x="${x}" y="${head + 30}" `);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif">
<rect width="${W}" height="${H}" fill="#ffffff"/>
<text x="${pad}" y="32" font-size="20" font-weight="700" fill="#1f2328">${esc(titulo)}</text>
<text x="${pad}" y="${head + 18}" font-size="17" font-weight="700" fill="#cf222e">Antes ${esc(A.nota)}</text>
<text x="${pad + A.w + gap}" y="${head + 18}" font-size="17" font-weight="700" fill="#1a7f37">Después ${esc(B.nota)}</text>
<line x1="${pad + A.w + gap / 2}" y1="${head}" x2="${pad + A.w + gap / 2}" y2="${H - pad}" stroke="#d0d4db"/>
${inner(A, pad)}
${inner(B, pad + A.w + gap)}
</svg>`;
if (out.endsWith(".svg")) fs.writeFileSync(out, svg);
else {
  const { aPng } = require("../lib/exportar.js");
  aPng(svg, Number(escala)).then((png) => fs.writeFileSync(out, png));
}
