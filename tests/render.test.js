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
  assert.strictEqual((svg.match(/stroke-dasharray:5 3/g) || []).length, 2); // ref(A) arriba, ref(IN) en S
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

test("estilos: forma, texto (color -> fill), opacidad, flechas de color y referencias", () => {
  const svg = renderSvg(
    layoutDiagram(
      parseDiagram(
        [
          "classDef app fill:#dcfce7,stroke:#15803d,color:#0b3d1c,stroke-width:2px,font-weight:bold,opacity:0.8",
          'a["A"]:::app --> b[("B")]:::app',
          "x --> a",
          "subgraph S",
          '  s["S"]',
          "end",
          "a --> s",
          "linkStyle 0 stroke:#f00,color:#00f",
        ].join("\n")
      )
    ),
    undefined,
    { shadow: false }
  );
  const node = svg.match(/<g class="node" data-id="a"[^]*?<\/g>/)[0];
  assert.match(node, /<g class="node" data-id="a" style="opacity:0.8">/);
  assert.match(node, /<rect [^>]*style="fill:#dcfce7;stroke:#15803d;stroke-width:2px"/);
  assert.match(node, /<text [^>]*style="fill:#0b3d1c;font-weight:bold"/);
  // Tapa del cilindro: sin relleno aunque la clase tenga fill.
  assert.match(svg, /<path [^>]*fill="none"[^>]*style="[^"]*fill:none"/);
  // Flecha 0 en rojo con su propia punta; su etiqueta no tiene texto, pero "color" no va a la línea.
  assert.match(svg, /<marker id="arrow-1"[^>]*><path [^>]*fill="#f00"/);
  assert.match(svg, /<line data-from="a" data-to="b"[^>]*marker-end="url\(#arrow-1\)" style="stroke:#f00"\/>/);
  // La referencia a A dentro de S lleva el estilo de A y además el borde discontinuo.
  assert.match(svg, /<polygon [^>]*style="fill:#dcfce7;stroke:#15803d;stroke-width:2px;stroke-dasharray:5 3"/);
});

test("hexágono: polígono de 6 puntos con el texto dentro", () => {
  const layout = layoutDiagram(parseDiagram('a{{"Hexágono"}}'));
  const n = layout.nodes[0];
  const svg = renderSvg(layout, undefined, { shadow: false });
  const pts = svg.match(/<polygon points="([^"]+)"/)[1].split(" ");
  assert.strictEqual(pts.length, 6);
  assert.ok(n.skew > 0 && n.w > n.skew * 2);
});

test("empalme: pastilla con el id de su dueño y extensión sin flecha", () => {
  const layout = layoutDiagram(parseDiagram("p --> x\nx --> a\nx --> b\nx --> c\nx --> d"));
  const svg = renderSvg(layout, undefined, { shadow: false });
  const j = layout.nodes.find((n) => n.shape === "junction");
  assert.match(svg, /<g class="junction" data-id="x●"><rect [^>]*rx="9" fill="#57606a"\/><text [^>]*>● x<\/text><\/g>/);
  assert.ok(j.w > j.h, "mide lo que su texto");
  assert.match(svg, /<line data-from="x" data-to="x●"[^>]*stroke-width="1.5"\/>/); // sin marker
  assert.match(svg, /<line data-from="x●" data-to="d"[^>]*marker-end="url\(#arrow\)"/);
});

test("pastillas de id: solo con { ids: true }, id real en referencias; los empalmes son su propia pastilla", () => {
  const src = 'e["E"]\nsubgraph S\n  a["A"]\nend\ne --> a\ne --> x\np --> q\nq --> r1\nq --> r2\nq --> r3\nq --> r4';
  const layout = layoutDiagram(parseDiagram(src));
  assert.ok(!renderSvg(layout).includes('class="ids"'));
  const svg = renderSvg(layout, undefined, { shadow: false, ids: true });
  const ids = [...svg.matchAll(/<g class="id-pill"[^>]*>.*?<text[^>]*>([^<]*)<\/text><\/g>/g)].map((m) => m[1]);
  assert.ok(ids.includes("a") && ids.includes("e") && ids.includes("q"));
  assert.ok(!ids.some((id) => /[↗●]/.test(id)), JSON.stringify(ids)); // sin ids internos ni empalmes
  assert.strictEqual(ids.filter((id) => id === "e").length, 2); // e y su referencia dentro de S
  assert.match(svg, /<g class="junction"[^>]*>.*?>● q<\/text>/);
});

test("pastilla anclada al contorno: en rombos y círculos va centrada sobre su lado superior izquierdo", () => {
  const layout = layoutDiagram(parseDiagram('d{"Rombo"} --> r["Rect"]\nd --> c(("Círculo"))'));
  const svg = renderSvg(layout, undefined, { shadow: false, ids: true });
  const pill = (id) => {
    const m = svg.match(new RegExp(`<g class="id-pill" data-id="${id}"><rect x="([\\d.-]+)" y="([\\d.-]+)" width="([\\d.-]+)" height="([\\d.-]+)"`));
    return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
  };
  const n = (id) => layout.nodes.find((x) => x.id === id);
  const d = n("d");
  const pd = pill("d");
  assert.ok(Math.abs(pd.x + pd.w / 2 - (d.x - d.w / 4)) < 0.1 && Math.abs(pd.y + pd.h / 2 - (d.y - d.h / 4)) < 0.1);
  const r = n("r");
  assert.ok(Math.abs(pill("r").x - (r.x - r.w / 2 - 4)) < 0.1);
  const c = n("c");
  const pc = pill("c");
  assert.ok(Math.abs(pc.x + pc.w / 2 - (c.x - (c.w / 2) * Math.SQRT1_2)) < 0.1);
});

test("ningún script del visor contiene '</script' (se incrustan dentro de <script> en el HTML)", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  for (const f of ["parser.js", "layout.js", "render.js", "viewer.js"]) {
    const src = fs.readFileSync(path.join(__dirname, "../src", f), "utf8");
    assert.ok(!/<\/script/i.test(src), `${f} contiene '</script': escríbelo como '<\\/script'`);
  }
});
