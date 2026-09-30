const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { parseDiagram, DiagramError } = require("../src/parser.js");
const { layoutDiagram } = require("../src/layout.js");

const layout = (src) => layoutDiagram(parseDiagram(src));
const cells = (L) => Object.fromEntries(L.nodes.map((n) => [n.id, [n.col, n.row]]));
const dirs = (L) => Object.fromEntries(L.edges.map((e) => [`${e.from}>${e.to}`, e.dir]));

test("ejemplo inicio_app: eje central con ramas laterales", () => {
  const src = fs.readFileSync(path.join(__dirname, "../examples/inicio_app.mmd"), "utf8");
  const c = cells(layout(src));
  assert.deepStrictEqual(c.inicio, [0, 0]);
  assert.deepStrictEqual(c.yaHayApp, [0, 2]);
  assert.deepStrictEqual(c.avisaFrente, [1, 2]);
  assert.deepStrictEqual(c.tomaCaja, [0, 5]);
  assert.deepStrictEqual(c.archivador, [1, 5]);
  assert.deepStrictEqual(c.ventasDb, [-1, 5]);
  assert.deepStrictEqual(c.mainOds, [0, 8]);
});

test("nodo normal: abajo, derecha, izquierda", () => {
  const d = dirs(layout("a --> b\na --> c\na --> d"));
  assert.deepStrictEqual(d, { "a>b": "down", "a>c": "right", "a>d": "left" });
});

test("rombo: 1ª a la derecha, 2ª a la izquierda", () => {
  const d = dirs(layout("a{x} --> b\na --> c"));
  assert.deepStrictEqual(d, { "a>b": "right", "a>c": "left" });
});

test("@dir libera la dirección por defecto para las demás salidas", () => {
  const d = dirs(layout("a --> b\na --> c\n%% @dir a -> b : right"));
  assert.deepStrictEqual(d, { "a>b": "right", "a>c": "down" });
});

test("@dir up hace crecer hacia arriba", () => {
  const c = cells(layout("a --> b\n%% @dir a -> b : up"));
  assert.deepStrictEqual(c.b, [0, -1]);
});

test("más de 3 salidas es error fatal", () => {
  assert.throws(() => layout("a --> b\na --> c\na --> d\na --> e"), (e) => e instanceof DiagramError && e.line === 4);
});

test("dos salidas en la misma dirección es error fatal", () => {
  assert.throws(
    () => layout("a --> b\na --> c\n%% @dir a -> b : down\n%% @dir a -> c : down"),
    /dos salidas hacia 'down'/
  );
});

test("<--> cuenta como salida del nodo que la declara", () => {
  const d = dirs(layout("a <--> b\na --> c"));
  assert.deepStrictEqual(d, { "a>b": "down", "a>c": "right" });
});

test("las posiciones son deterministas y sin solapes en el ejemplo", () => {
  const src = fs.readFileSync(path.join(__dirname, "../examples/inicio_app.mmd"), "utf8");
  const L = layout(src);
  assert.strictEqual(L.warnings.length, 0);
  for (const a of L.nodes) {
    for (const b of L.nodes) {
      if (a === b) continue;
      const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
      assert.ok(!overlap, `${a.id} se solapa con ${b.id}`);
    }
  }
});

test("choque de ramas genera aviso (TODO)", () => {
  const L = layout("a --> b\nb --> c\n%% @dir b -> c : up");
  assert.ok(L.warnings.some((w) => /Choque/.test(w.message)));
});

test("subgraphs: un diagrama por grupo, en fila, con referencias en ambos lados", () => {
  const L = layout(
    [
      'fuera["Fuera"]',
      'subgraph S["Sistema"]',
      '  a["A"] --> b["B"]',
      "  subgraph T",
      '    c["C"]',
      "  end",
      "end",
      'fuera -->|"x"| a',
      "b --> c",
      "fuera --> T",
      "%% @dir fuera -> a : right",
    ].join("\n")
  );
  const byGroup = (g) => L.nodes.filter((n) => n.group === g && !n.ref).map((n) => n.id);
  assert.deepStrictEqual(byGroup(null), ["fuera"]);
  assert.deepStrictEqual(byGroup("S"), ["a", "b"]);
  assert.deepStrictEqual(byGroup("T"), ["c"]);
  assert.deepStrictEqual(L.titles.map((t) => t.text), ["Sistema", "Sistema › T"]);

  // fuera --> a: en el nivel superior "fuera -> ref(A)" y en S "ref(Fuera) -> a", ambos con la etiqueta y el @dir.
  const refs = L.nodes.filter((n) => n.ref);
  const refTo = (text) => refs.filter((n) => n.text === text).map((n) => n.id);
  assert.strictEqual(refTo("A").length, 1);
  assert.strictEqual(refTo("Fuera").length, 1);
  const top = L.edges.find((e) => e.from === "fuera" && e.to === refTo("A")[0]);
  const inS = L.edges.find((e) => e.from === refTo("Fuera")[0] && e.to === "a");
  assert.strictEqual(top.label, "x");
  assert.strictEqual(inS.label, "x");
  assert.strictEqual(top.dir, "right");
  assert.strictEqual(inS.dir, "right");
  // fuera --> T (subgraph entero): solo en el diagrama de "fuera", con el título de T.
  assert.strictEqual(refTo("T").length, 1);
  assert.ok(refs.every((n) => n.shape === "parallelogram"));

  // Los diagramas no se solapan: cada grupo queda a la derecha del anterior.
  const span = (ids) => {
    const ns = L.nodes.filter((n) => ids.includes(n.id));
    return [Math.min(...ns.map((n) => n.x - n.w / 2)), Math.max(...ns.map((n) => n.x + n.w / 2))];
  };
  const idsOf = (test) => L.nodes.filter(test).map((n) => n.id);
  const top0 = span(["fuera", ...refTo("A"), ...refTo("T")]);
  const s0 = span(["a", "b", ...refTo("Fuera"), ...idsOf((n) => n.ref && n.text === "C")]);
  const t0 = span(["c", ...idsOf((n) => n.ref && n.text === "B")]);
  assert.ok(top0[1] < s0[0] && s0[1] < t0[0], JSON.stringify([top0, s0, t0]));
  // Cada título empieza en el borde izquierdo de su diagrama y queda encima de sus nodos.
  assert.ok(Math.abs(L.titles[0].x - s0[0]) < 1 && Math.abs(L.titles[1].x - t0[0]) < 1);
  const topOf = (n) => n.y - n.h / 2;
  assert.ok(L.nodes.filter((n) => n.group === "S").every((n) => topOf(n) > L.titles[0].y));
});

test("sin subgraphs el resultado no cambia", () => {
  const L = layout('a --> b');
  assert.deepStrictEqual(L.titles, []);
  assert.ok(!L.nodes.some((n) => n.ref));
});
