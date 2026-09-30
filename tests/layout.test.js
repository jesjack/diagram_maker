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
