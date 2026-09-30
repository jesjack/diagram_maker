// Ejecutar: node --test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { parseDiagram, DiagramError } = require("../src/parser.js");

test("ejemplo inicio_app se parsea completo", () => {
  const src = fs.readFileSync(path.join(__dirname, "../examples/inicio_app.mmd"), "utf8");
  const g = parseDiagram(src);
  assert.strictEqual(g.nodes.size, 14);
  assert.strictEqual(g.edges.length, 13);
  assert.strictEqual(g.meta.dirs.length, 3);
  assert.strictEqual(g.nodes.get("inicio").shape, "circle");
  assert.strictEqual(g.nodes.get("yaHayApp").shape, "diamond");
  assert.strictEqual(g.nodes.get("ventasDb").shape, "cylinder");
  assert.strictEqual(g.nodes.get("modoNormal").text, "Modo normal (en RAM)");
  const bidi = g.edges.find((e) => e.to === "ventasDb");
  assert.ok(bidi.arrowStart && bidi.arrowEnd);
  assert.strictEqual(g.edges.find((e) => e.to === "avisaFrente").label, "Si");
});

test("formas y texto sin comillas", () => {
  const g = parseDiagram("graph TD\nA[Hola mundo] --> B(Redondo)\nB --> C{Decide}");
  assert.strictEqual(g.nodes.get("A").text, "Hola mundo");
  assert.strictEqual(g.nodes.get("B").shape, "round");
  assert.strictEqual(g.nodes.get("C").shape, "diamond");
});

test("estadio ([...]) con paréntesis dentro del texto", () => {
  const g = parseDiagram('flowchart TD\nA(["Avisa y sale<br/>(supuesto: o trae la otra al frente)"]):::app --> B([Corto])');
  assert.strictEqual(g.nodes.get("A").shape, "stadium");
  assert.strictEqual(g.nodes.get("A").text, "Avisa y sale\n(supuesto: o trae la otra al frente)");
  assert.strictEqual(g.nodes.get("B").shape, "stadium");
  assert.strictEqual(g.nodes.get("B").text, "Corto");
  assert.strictEqual(g.edges.length, 1);
});

test("cadenas de aristas y nodos sin forma", () => {
  const g = parseDiagram("a --> b --> c");
  assert.deepStrictEqual(g.edges.map((e) => [e.from, e.to]), [["a", "b"], ["b", "c"]]);
  assert.strictEqual(g.nodes.get("b").text, "b");
  assert.strictEqual(g.nodes.get("b").shape, "rect");
});

test("variantes de aristas", () => {
  const g = parseDiagram("a -- texto largo --> b\nb --- c\nc ==> d\nd -.-> e\ne -->|\"x\"| f");
  assert.strictEqual(g.edges[0].label, "texto largo");
  assert.strictEqual(g.edges[1].arrowEnd, false);
  assert.strictEqual(g.edges[2].style, "thick");
  assert.strictEqual(g.edges[3].style, "dotted");
  assert.strictEqual(g.edges[4].label, "x");
});

test("comentario al final de la línea", () => {
  const g = parseDiagram('a["con %% dentro"] --> b %% comentario');
  assert.strictEqual(g.nodes.get("a").text, "con %% dentro");
  assert.strictEqual(g.edges.length, 1);
});

test("errores con número de línea", () => {
  assert.throws(() => parseDiagram("graph\na --> "), (e) => e instanceof DiagramError && e.line === 2);
  assert.throws(() => parseDiagram("a --> b\n%% @dir a -> b : arriba"), /Línea 2: Dirección 'arriba'/);
  assert.throws(() => parseDiagram("a --> b\n%% @dir a -> c : down"), /no existe la arista 'a -> c'/);
  assert.throws(() => parseDiagram("%% @color a : red"), /Metadato desconocido/);
  assert.throws(() => parseDiagram('a["sin cerrar] --> b'), /Comilla|cerrar/);
});

test("estilos se ignoran con aviso", () => {
  const g = parseDiagram("a --> b\nstyle a fill:#f00");
  assert.strictEqual(g.warnings.length, 1);
});
