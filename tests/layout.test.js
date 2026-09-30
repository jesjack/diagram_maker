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

test("referencias entrantes: se pegan al nodo destino según el orden de las aristas", () => {
  const L = layout(
    [
      'ext1["E1"]',
      'ext2["E2"]',
      "subgraph S",
      '  s1["S1"]',
      '  s2["S2"]',
      '  s3["S3"]',
      '  s4["S4"]',
      "end",
      "ext1 --> s1 --> s2", // sin padre real: la referencia a E1 hace de padre (arriba)
      "ext2 --> s2", // s2 ya tiene padre (s1): la referencia ocupa la 1ª salida libre (abajo)
      "s2 --> s3",
      "s2 --> s4",
    ].join("\n")
  );
  const at = (id) => {
    const n = L.nodes.find((x) => (x.ref ? `ref:${x.text}` : x.id) === id && (x.ref || x.group === "S"));
    return [n.col, n.row];
  };
  const [c1, r1] = at("s1");
  assert.deepStrictEqual(at("ref:E1"), [c1, r1 - 1]);
  assert.deepStrictEqual(at("s2"), [c1, r1 + 1]);
  assert.deepStrictEqual(at("ref:E2"), [c1, r1 + 2]);
  assert.deepStrictEqual(at("s3"), [c1 + 1, r1 + 1]);
  assert.deepStrictEqual(at("s4"), [c1 - 1, r1 + 1]);
  assert.ok(!L.warnings.some((w) => /Choque/.test(w.message)));
});

test("referencias entrantes: @dir es la dirección de la flecha y la referencia va al lado opuesto", () => {
  const L = layout(
    ['e["E"]', "subgraph S", '  a["A"] --> b["B"]', "end", "e --> b", "%% @dir e -> b : left"].join("\n")
  );
  const b = L.nodes.find((n) => n.id === "b" && n.group === "S");
  const ref = L.nodes.find((n) => n.ref && n.text === "E");
  assert.deepStrictEqual([ref.col, ref.row], [b.col + 1, b.row]);
});

test("referencias entrantes no quitan hueco a las salidas reales", () => {
  // a tiene 3 salidas reales y ningún padre: la referencia no desplaza a ninguna y va arriba.
  const L = layout(
    ['e["E"]', "subgraph S", '  a["A"]', "  a --> x", "  a --> y", "  a --> z", "end", "e --> a"].join("\n")
  );
  const a = L.nodes.find((n) => n.id === "a");
  const ref = L.nodes.find((n) => n.ref && n.text === "E" && n.row !== undefined && n.col === a.col && n.row === a.row - 1);
  assert.ok(ref, "la referencia a E queda encima de a");
  assert.deepStrictEqual(
    ["x", "y", "z"].map((id) => L.edges.find((e) => e.from === "a" && e.to === id).dir),
    ["down", "right", "left"]
  );
});

test("nodo cuyo único padre es una referencia: se pega a su primer hijo ya colocado", () => {
  const L = layout(
    [
      'e1["E1"]',
      'e2["E2"]',
      "subgraph S",
      '  a["A"] --> b["B"]',
      '  c["C"]',
      "end",
      "e1 --> a",
      "e2 --> c --> b", // c no es un inicio: su primer hijo (b) hace de padre
    ].join("\n")
  );
  const get = (pred) => L.nodes.find(pred);
  const a = get((n) => n.id === "a");
  const b = get((n) => n.id === "b");
  const c = get((n) => n.id === "c");
  // b está debajo de a; c ocupa el primer lado libre de b (abajo) y la flecha sigue siendo c -> b.
  assert.deepStrictEqual([b.col - a.col, b.row - a.row], [0, 1]);
  assert.deepStrictEqual([c.col - b.col, c.row - b.row], [0, 1]);
  assert.strictEqual(L.edges.find((e) => e.from === "c" && e.to === "b").dir, "up");
  // La referencia a E2 pasa a ser una salida más de c (abajo, el primer lado libre).
  const ref = get((n) => n.ref && n.text === "E2");
  assert.deepStrictEqual([ref.col - c.col, ref.row - c.row], [0, 1]);
  assert.ok(!L.warnings.some((w) => /Choque/.test(w.message)));
});

test("si el lado asignado ya está ocupado, se usa otro lado libre del padre", () => {
  // b queda a la izquierda de a (@dir); la 2ª salida de b (derecha) caería sobre a: pasa a la izquierda.
  const L = layout(["a --> b", "b --> c", "b --> d", "%% @dir a -> b : left"].join("\n"));
  const at = (id) => L.nodes.find((n) => n.id === id);
  const [b, c, d] = ["b", "c", "d"].map(at);
  assert.deepStrictEqual([c.col - b.col, c.row - b.row], [0, 1]);
  assert.deepStrictEqual([d.col - b.col, d.row - b.row], [-1, 0]);
  assert.strictEqual(L.edges.find((e) => e.to === "d").dir, "left");
  assert.ok(!L.warnings.some((w) => /Choque/.test(w.message)));
});

test("un @dir explícito no se mueve aunque choque", () => {
  const L = layout(["a --> b", "b --> c", "%% @dir a -> b : left", "%% @dir b -> c : right"].join("\n"));
  assert.strictEqual(L.edges.find((e) => e.to === "c").dir, "right");
  assert.ok(L.warnings.some((w) => /Choque/.test(w.message)));
});

test("nodos de fuera conectados solo con subgraphs: se absorben y su diagrama desaparece", () => {
  const L = layout(
    [
      'p1[/"IN uno"/]',
      'p2[("DB")]',
      'suelto["Sin aristas"]',
      'libre["Libre"]',
      "subgraph S",
      '  a["A"] --> b["B"]',
      "end",
      "p1 --> a",
      "b <--> p2",
      "libre --> a", // también va a un nodo de fuera: no se absorbe
      'libre --> otro["Otro"]',
    ].join("\n")
  );
  const shown = (pred) => L.nodes.filter(pred);
  // p1 y p2 no están en el nivel superior; dentro de S aparecen con su forma y marcados como absorbidos.
  assert.ok(!shown((n) => !n.ref && (n.id === "p1" || n.id === "p2")).length);
  const p1 = shown((n) => n.absorbed && n.realId === "p1");
  const p2 = shown((n) => n.absorbed && n.realId === "p2");
  assert.deepStrictEqual([p1.length, p1[0].shape], [1, "parallelogram"]);
  assert.deepStrictEqual([p2.length, p2[0].shape], [1, "cylinder"]);
  // Los que no cumplen la condición siguen en el nivel superior.
  assert.ok(shown((n) => n.id === "suelto" && !n.ref).length === 1);
  assert.ok(shown((n) => n.id === "libre" && !n.ref).length === 1);
  // Referencias normales: solo las de "libre --> a" (ref(A) arriba y ref(Libre) en S); ninguna de p1 ni p2.
  const refs = shown((n) => n.ref && !n.absorbed);
  assert.deepStrictEqual(refs.map((n) => n.text).sort(), ["A", "Libre"]);
});

test("si el nivel superior se queda vacío, no se dibuja", () => {
  const L = layout(['p["P"]', 'subgraph S["Sis"]', '  a["A"]', "end", "p --> a"].join("\n"));
  assert.deepStrictEqual(L.titles.map((t) => t.text), ["Sis"]);
  assert.strictEqual(Math.min(...L.nodes.map((n) => n.x - n.w / 2)), L.bounds.minX);
});

test("nodo absorbido con varias aristas: una sola copia por diagrama; más de 3 salidas es error", () => {
  const L = layout(
    ['t[/"IN teclado"/]', "subgraph S", '  a["A"] --> b["B"]', '  c["C"]', '  d["D"]', "end", "t --> c", "t --> d", "t --> b"].join("\n")
  );
  const copies = L.nodes.filter((n) => n.id === "t" || n.realId === "t");
  assert.strictEqual(copies.length, 1);
  const t = copies[0];
  const at = (id) => L.nodes.find((n) => n.id === id);
  // c y d son sus hijos (abajo y derecha); b ya estaba colocado bajo a.
  assert.deepStrictEqual([at("c").col - t.col, at("c").row - t.row], [0, 1]);
  assert.deepStrictEqual([at("d").col - t.col, at("d").row - t.row], [1, 0]);

  assert.throws(
    () => layout(['t["T"]', "subgraph S", '  a["A"]', '  b["B"]', '  c["C"]', '  d["D"]', "end", "t --> a", "t --> b", "t --> c", "t --> d"].join("\n")),
    /'t' tiene 4 salidas/
  );
});

test("nodo sin padre con algún hijo ya colocado: se pega a ese hijo en vez de ir a la derecha", () => {
  // t no tiene entradas; su primer hijo (x) no está colocado, pero b sí: t va junto a b.
  const L = layout(["a --> b", "t --> x", "t --> b"].join("\n"));
  const at = (id) => L.nodes.find((n) => n.id === id);
  const [b, t, x] = ["b", "t", "x"].map(at);
  assert.strictEqual(Math.abs(t.col - b.col) + Math.abs(t.row - b.row), 1, "t es vecino de b");
  assert.strictEqual(Math.abs(x.col - t.col) + Math.abs(x.row - t.row), 1, "x es vecino de t");
  assert.ok(!L.warnings.some((w) => /Choque/.test(w.message)));
});
