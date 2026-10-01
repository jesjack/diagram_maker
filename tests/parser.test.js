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

test("estilos: classDef, :::, class y style con la prioridad de Mermaid", () => {
  const g = parseDiagram(
    [
      "classDef default fill:#eee,color:#111",
      "classDef azul fill:#00f,stroke:#003",
      "classDef roja stroke:#f00,stroke-dasharray: 5, 5",
      'a["A"]:::roja --> b["B"]:::azul',
      "c --> d",
      "class a azul", // a tiene azul y roja: gana la definida más tarde (roja) en lo que se pisen
      "style b fill:#0f0", // style gana a las clases
    ].join("\n")
  );
  const css = (id) => Object.fromEntries(g.nodes.get(id).css);
  assert.deepStrictEqual(css("a"), { fill: "#00f", color: "#111", stroke: "#f00", "stroke-dasharray": "5,5" });
  assert.deepStrictEqual(css("b"), { fill: "#0f0", color: "#111", stroke: "#003" });
  assert.deepStrictEqual(css("c"), { fill: "#eee", color: "#111" });
  assert.deepStrictEqual(g.warnings, []);
});

test("estilos: linkStyle por número y default", () => {
  const g = parseDiagram(["a --> b --> c", "linkStyle default stroke:#999", "linkStyle 1 stroke:#f00,stroke-width:3px"].join("\n"));
  assert.deepStrictEqual(Object.fromEntries(g.edges[0].css), { stroke: "#999" });
  assert.deepStrictEqual(Object.fromEntries(g.edges[1].css), { stroke: "#f00", "stroke-width": "3px" });
});

test("estilos: avisos (propiedad de HTML, clase sin classDef, subgraph, flecha inexistente, click)", () => {
  const g = parseDiagram(
    [
      "classDef x fill:#fff,padding:4px,font-size:20px",
      "a:::x --> b:::nada",
      "subgraph S",
      "  c",
      "end",
      "style S fill:#eee",
      "linkStyle 7 stroke:#f00",
      "click a callback",
    ].join("\n")
  );
  const msgs = g.warnings.map((w) => w.message).join("\n");
  assert.match(msgs, /'padding' no tiene efecto en SVG/);
  assert.match(msgs, /'nada' no tiene classDef/);
  assert.match(msgs, /subgraph 'S' ignorado/);
  assert.match(msgs, /no existe la flecha número '7'/);
  assert.match(msgs, /'click' ignorado/);
  assert.deepStrictEqual(Object.fromEntries(g.nodes.get("a").css), { fill: "#fff", "font-size": "20px" });
});

test("subgraphs: pertenencia, anidados, título y referencia al subgraph entero", () => {
  const g = parseDiagram(
    [
      "flowchart LR",
      "    fuera[/\"IN x\"/]",
      "    subgraph APP[\"App — lógica\"]",
      "        direction TB",
      "        a[\"A\"]",
      "        subgraph Hijo",
      "            b[\\\"OUT b\"\\]",
      "        end",
      "    end",
      "    fuera --> a",
      "    a --> b",
      "    fuera --> APP",
    ].join("\n")
  );
  assert.deepStrictEqual(
    g.subgraphs.map((s) => [s.id, s.title, s.parent]),
    [["APP", "App — lógica", null], ["Hijo", "Hijo", "APP"]]
  );
  assert.strictEqual(g.nodes.get("fuera").group, null);
  assert.strictEqual(g.nodes.get("fuera").shape, "parallelogram");
  assert.strictEqual(g.nodes.get("a").group, "APP");
  assert.strictEqual(g.nodes.get("b").group, "Hijo");
  assert.strictEqual(g.nodes.get("b").shape, "parallelogram-alt");
  assert.strictEqual(g.nodes.get("b").text, "OUT b");
  assert.ok(!g.nodes.has("APP"), "el id del subgraph no es un nodo");
  assert.strictEqual(g.edges[2].to, "APP");
  assert.ok(g.warnings.some((w) => w.line === 4 && /direction/.test(w.message)));
});

test("subgraphs: errores de apertura y cierre", () => {
  assert.throws(() => parseDiagram("a --> b\nend"), (e) => e.line === 2 && /sin 'subgraph'/.test(e.message));
  assert.throws(() => parseDiagram("subgraph S\na --> b"), (e) => e.line === 1 && /Falta 'end'/.test(e.message));
  assert.throws(() => parseDiagram('subgraph S\nend\nS["nodo"] --> b'), /a la vez un subgraph y un nodo/);
});

test("hexágono {{...}} (no se confunde con el rombo)", () => {
  const g = parseDiagram('a{{"E/S db"}}:::app --> b{"¿Sí?"}');
  assert.strictEqual(g.nodes.get("a").shape, "hexagon");
  assert.strictEqual(g.nodes.get("a").text, "E/S db");
  assert.strictEqual(g.nodes.get("b").shape, "diamond");
});
