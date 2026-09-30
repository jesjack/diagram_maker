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
  assert.strictEqual((svg.match(/<line /g) || []).length, 4);
  for (const tag of ["<rect", "<circle", "<polygon", "<path"]) assert.ok(svg.includes(tag), tag);
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
