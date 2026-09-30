const test = require("node:test");
const assert = require("node:assert");
const { parseDiagram } = require("../src/parser.js");
const { layoutDiagram } = require("../src/layout.js");
const { renderSvg } = require("../src/render.js");

const render = (src) => renderSvg(layoutDiagram(parseDiagram(src)));

test("genera un nodo por cada forma y una línea por arista", () => {
  const svg = render('a["A"] --> b(("B"))\nb --> c{"C"}\nc --> d[("D")]\nc --> e("E")');
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.strictEqual((svg.match(/class="node"/g) || []).length, 5);
  const edges = svg.match(/<g class="edges">([\s\S]*?)<\/g>/)[1];
  assert.strictEqual((edges.match(/<line /g) || []).length, 4);
  for (const tag of ["<rect", "<circle", "<polygon", "<path"]) assert.ok(svg.includes(tag), tag);
});

test("estadio: rectángulo con extremos semicirculares", () => {
  const layout = layoutDiagram(parseDiagram('a(["Estadio"])'));
  const n = layout.nodes.find((x) => x.id === "a");
  const svg = renderSvg(layout, undefined, { shadow: false });
  assert.ok(svg.includes(`rx="${Number((n.h / 2).toFixed(2))}"`));
});

test("escapa el texto", () => {
  const svg = render('a["<b> & \'x\'"] -->|"<y>"| b');
  assert.ok(svg.includes("&lt;b&gt; &amp; &#39;x&#39;"));
  assert.ok(svg.includes("&lt;y&gt;"));
  assert.ok(!svg.includes("<b>"));
});

test("flecha bidireccional usa marcador al inicio y al final", () => {
  const svg = render("a <--> b");
  assert.match(svg, /marker-start="url\(#arrow\)" marker-end="url\(#arrow\)"/);
});

test("sombra: difuminada debajo de todo, sin flechas, y se puede omitir o desactivar", () => {
  const { THEME, renderShadowSvg } = require("../src/render.js");
  const src = 'a["A"] -->|"x"| b(("B"))';
  const layout = layoutDiagram(parseDiagram(src));
  const svg = renderSvg(layout);
  const shadows = svg.match(/<g class="shadows"[^>]*>([\s\S]*?)<\/g>/)[1];
  assert.ok(svg.indexOf('class="shadows"') < svg.indexOf('class="edges"'));
  assert.ok(svg.includes("<feGaussianBlur"));
  assert.strictEqual((shadows.match(/<line /g) || []).length, 1);
  assert.ok(!shadows.includes("marker"));
  for (const plain of [renderSvg(layout, THEME, { shadow: false }), renderSvg(layout, { ...THEME, shadow: null })]) {
    assert.ok(!plain.includes('class="shadows"'));
    assert.ok(!plain.includes("<filter"));
  }
  const only = renderShadowSvg(layout);
  assert.ok(only.includes('class="shadows"') && only.includes("<filter"));
  assert.ok(!only.includes('class="nodes"'));
  assert.strictEqual(only.match(/viewBox="[^"]*"/)[0], svg.match(/viewBox="[^"]*"/)[0]);
});

test("subgraphs: títulos, paralelogramos y referencias con borde discontinuo", () => {
  const svg = renderSvg(
    layoutDiagram(parseDiagram('p[/"IN"/]\nsubgraph S["Sis & co"]\n  a["A"] --> q[\\"OUT"\\]\nend\np --> a\np --> z')),
    undefined,
    { shadow: false }
  );
  assert.match(svg, /<g class="titles">\s*<text[^>]*>Sis &amp; co<\/text>/);
  assert.strictEqual((svg.match(/stroke-dasharray="5 3"/g) || []).length, 2); // ref(A) arriba, ref(IN) en S
  assert.strictEqual((svg.match(/<polygon /g) || []).length, 4); // p, q y las dos referencias
});

test("nodo absorbido: se dibuja con su forma y borde normales dentro del subgraph", () => {
  const svg = renderSvg(
    layoutDiagram(parseDiagram('p[/"IN"/]\nsubgraph S["Sis"]\n  a["A"]\nend\np --> a')),
    undefined,
    { shadow: false }
  );
  assert.ok(!svg.includes("stroke-dasharray"));
  assert.strictEqual((svg.match(/<polygon /g) || []).length, 1); // solo p, con su paralelogramo
});
