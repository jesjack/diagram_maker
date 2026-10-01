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

test("4 salidas sin padre caben (la 4ª va arriba)", () => {
  const L = layout("a --> b\na --> c\na --> d\na --> e");
  assert.deepStrictEqual(["b", "c", "d", "e"].map((id) => L.edges.find((x) => x.to === id).dir), ["down", "right", "left", "up"]);
  assert.ok(!L.nodes.some((n) => n.shape === "junction"));
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

test("nodo absorbido con varias aristas: una sola copia por diagrama", () => {
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

test("estilos: font-size y font-weight cambian el tamaño medido del nodo", () => {
  const L = layout(["classDef big font-size:28px", 'a["Texto de prueba"] --> b["Texto de prueba"]:::big'].join("\n"));
  const [a, b] = ["a", "b"].map((id) => L.nodes.find((n) => n.id === id));
  assert.ok(b.w > a.w * 1.5, `${b.w} vs ${a.w}`);
  assert.ok(b.h > a.h);
  assert.strictEqual(b.lineHeight, 36); // 18 * 28/14
});

test("más de 4 conexiones: la 4ª es una extensión hasta un empalme, y se encadenan", () => {
  // x: 1 padre + 7 hijos = 8 conexiones.
  const L = layout(["p --> x", ...["a", "b", "c", "d", "e", "f", "g"].map((c) => `x -->|${c}| ${c}`)].join("\n"));
  const j1 = L.nodes.find((n) => n.id === "x\u25cf");
  const j2 = L.nodes.find((n) => n.id === "x\u25cf\u25cf");
  assert.ok(j1 && j2, "dos empalmes encadenados");
  assert.strictEqual(j1.shape, "junction");
  const conns = (id) => L.edges.filter((e) => e.from === id || e.to === id);
  // x: p, a, b + extensión; j1: extensión de x, c, d + extensión a j2; j2: e, f, g + extensión.
  assert.deepStrictEqual(conns("x").map((e) => e.to).sort(), ["a", "b", "x", "x\u25cf"].sort());
  assert.deepStrictEqual(conns("x\u25cf").map((e) => e.to).sort(), ["c", "d", "x\u25cf", "x\u25cf\u25cf"].sort());
  assert.deepStrictEqual(conns("x\u25cf\u25cf").map((e) => e.to).sort(), ["e", "f", "g", "x\u25cf\u25cf"].sort());
  // La extensión no tiene flechas; las ramas conservan la suya y su etiqueta.
  const bus = L.edges.find((e) => e.from === "x" && e.to === "x\u25cf");
  assert.ok(bus.bus && !bus.arrowEnd && !bus.arrowStart);
  const toC = L.edges.find((e) => e.to === "c");
  assert.deepStrictEqual([toC.from, toC.label, toC.arrowEnd], ["x\u25cf", "c", true]);
  // Ninguna conexión pisa a otra.
  for (const n of L.nodes) assert.ok(conns(n.id).length <= 4, n.id);
  assert.ok(!L.warnings.some((w) => /Choque/.test(w.message)), JSON.stringify(L.warnings));
});

test("empalme también para entradas: las flechas que sobran terminan en el empalme", () => {
  const L = layout(["a --> db", "b --> db", "c --> db", "d --> db", "e --> db"].join("\n"));
  const j = "db\u25cf";
  assert.deepStrictEqual(L.edges.filter((e) => e.to === j && !e.bus).map((e) => e.from).sort(), ["d", "e"]);
  assert.ok(L.edges.find((e) => e.from === "db" && e.to === j).bus);
});

test("un inicio que aún no puede pegarse se aplaza y se pega cuando otro grupo coloca a su hijo", () => {
  // t llega antes que u, pero su hijo k solo lo coloca u (que se pega a b).
  const L = layout(["a --> b", "t --> k", "u --> b", "u --> k"].join("\n"));
  const at = (id) => L.nodes.find((n) => n.id === id);
  const [t, k] = [at("t"), at("k")];
  assert.strictEqual(Math.abs(t.col - k.col) + Math.abs(t.row - k.row), 1, "t es vecino de k");
  assert.ok(!L.warnings.some((w) => /Choque/.test(w.message)));
});

test("grupo aparte: se reconstruye desde su primera conexión (a,b,c + A,B,C con C->c queda a,b,c,C,B,A)", () => {
  const L = layout(["a --> b --> c", "A --> B --> C", "C --> c"].join("\n"));
  const at = (id) => {
    const n = L.nodes.find((x) => x.id === id);
    return [n.col, n.row];
  };
  const [c0, r0] = at("a");
  assert.deepStrictEqual(["a", "b", "c", "C", "B", "A"].map(at), [0, 1, 2, 3, 4, 5].map((i) => [c0, r0 + i]));
  // Las flechas no cambian de sentido: A->B y B->C apuntan hacia arriba, C->c también.
  assert.deepStrictEqual(["B", "C", "c"].map((to) => L.edges.find((e) => e.to === to && /^[A-C]$/.test(e.from)).dir), ["up", "up", "up"]);
  assert.ok(!L.warnings.some((w) => /Choque/.test(w.message)));
});

test("grupo sin ninguna conexión con lo colocado: sigue aparte", () => {
  const L = layout(["a --> b", "x --> y"].join("\n"));
  const [a, x] = ["a", "x"].map((id) => L.nodes.find((n) => n.id === id));
  assert.ok(x.col - a.col >= 2);
});

test("si el grupo no cabe por ninguna conexión, se extiende la línea de la pareja hasta un empalme", () => {
  // P solo tiene libre la derecha y encima de ese hueco está AR: y (que necesita 3 lados además del
  // de P) no cabe pegado a P, así que P saca una extensión y y va junto al empalme.
  const L = layout(
    ["a --> P", "a --> AR", "P --> D", "P --> L", "%% @dir P -> L : left", "x --> y", "y --> c1", "y --> c2", "y --> P"].join("\n")
  );
  const at = (id) => L.nodes.find((n) => n.id === id);
  const j = L.nodes.find((n) => n.shape === "junction" && n.junctionOf === "P");
  assert.ok(j, "P tiene un empalme nuevo");
  assert.ok(L.edges.some((e) => e.bus && e.from === "P" && e.to === j.id));
  assert.ok(L.edges.some((e) => e.from === "y" && e.to === j.id), "la conexión y -> P sale del empalme");
  const y = at("y");
  assert.strictEqual(Math.abs(y.col - j.col) + Math.abs(y.row - j.row), 1);
  assert.ok(!L.warnings.some((w) => /Choque/.test(w.message)));
});

test("la copia de una hoja se hace en el turno del padre, no al final (v3_app: V2 -> oEnfocar)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../examples/v3_app.mmd"), "utf8");
  const L = layoutDiagram(parseDiagram(src));
  const v2 = L.nodes.find((n) => n.id === "V2");
  const e = L.edges.find((x) => x.from === "V2" && (L.nodes.find((n) => n.id === x.to).realId || x.to) === "oEnfocar");
  const copy = L.nodes.find((n) => n.id === e.to);
  assert.ok(copy.copyOf, "V2 apunta a una copia de oEnfocar");
  assert.strictEqual(Math.abs(copy.col - v2.col) + Math.abs(copy.row - v2.row), 1);
});

test("las celdas de los hijos se reservan antes de bajar por una rama (v3_uno: K5 no choca)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../examples/v3_uno.mmd"), "utf8");
  const L = layoutDiagram(parseDiagram(src));
  assert.ok(!L.warnings.some((w) => /'K5'/.test(w.message)), JSON.stringify(L.warnings));
});

test("hijo sin lado libre: extensión por el lado de un hermano, que sigue recto (v3_app, A4)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../examples/v3_app.mmd"), "utf8");
  const L = layoutDiagram(parseDiagram(src));
  const at = (id) => L.nodes.find((n) => n.id === id);
  const adj = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
  // A4 tiene a su padre A3 a un lado y A2x (otra rama) en otro: ioCandCaja sale de un empalme de A4.
  const link = L.edges.find((e) => (e.from === "ioCandCaja" || e.to === "ioCandCaja") && /A4●/.test(e.from + e.to));
  assert.ok(link, "ioCandCaja conecta con un empalme de A4");
  const j = at(link.from === "ioCandCaja" ? link.to : link.from);
  assert.ok(adj(j, at("A4")) && adj(j, at("ioCandCaja")));
  // El hermano que tenía ese lado sigue recto: A4 -> empalme -> hermano en la misma dirección.
  const bus = L.edges.find((e) => e.bus && e.to === j.id);
  const sib = L.edges.find((e) => e.from === j.id && e.to !== "ioCandCaja" && !e.bus);
  assert.strictEqual(sib.dir, bus.dir);
  assert.ok(!L.warnings.some((w) => /Choque/.test(w.message)), JSON.stringify(L.warnings.filter((w) => /Choque/.test(w.message))));
});

test("hoja colocada lejos: el padre recibe una copia a su lado; un nodo con hijos no se copia", () => {
  const L = layout(["a --> b --> hoja", "a --> c --> d --> e --> k --> hoja", "e --> f", "a --> g --> f", "f --> h"].join("\n"));
  const near = (x, y) => Math.abs(x.col - y.col) + Math.abs(x.row - y.row) === 1;
  const byId = Object.fromEntries(L.nodes.map((n) => [n.id, n]));
  const copies = L.nodes.filter((n) => n.realId === "hoja" && n.copyOf);
  assert.strictEqual(copies.length, 1);
  const toCopy = L.edges.find((e) => e.to === copies[0].id);
  assert.strictEqual(toCopy.from, "k");
  assert.ok(near(byId.k, copies[0]));
  assert.ok(near(byId.b, byId.hoja), "el original sigue junto a su primer padre");
  // f tiene un hijo (h): no se copia como nodo aunque g quede lejos (a lo sumo, un conector ● f).
  assert.ok(!L.nodes.some((n) => n.copyOf === "f" && n.shape !== "junction"));
});

test("flecha a un empalme: F2 queda junto a un empalme de A8, sin línea larga (v3_app)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../examples/v3_app.mmd"), "utf8");
  const L = layoutDiagram(parseDiagram(src));
  const byId = Object.fromEntries(L.nodes.map((n) => [n.id, n]));
  // La flecha sale de F2 o de un empalme de F2 (si F2 tuvo que hacer sitio).
  const fromF2 = (id) => id === "F2" || byId[id].junctionOf === "F2";
  const e = L.edges.find((x) => fromF2(x.from) && byId[x.to].junctionOf === "A8");
  assert.ok(e, "F2 apunta a un empalme de A8");
  const j = byId[e.to];
  assert.strictEqual(j.shape, "junction"); // el empalme de A8 (o una copia) junto a F2
  const src2 = byId[e.from];
  assert.strictEqual(Math.abs(j.col - src2.col) + Math.abs(j.row - src2.row), 1);
});

test("ninguna flecha se pierde por el camino (copias, empalmes, extensiones)", () => {
  for (const f of ["v3_app", "v3_uno", "v3_soffice", "inicio_app", "prueba_movil"]) {
    const g = parseDiagram(fs.readFileSync(path.join(__dirname, `../examples/${f}.mmd`), "utf8"));
    const L = layoutDiagram(g);
    // Todo es nivel superior o absorbido en estos ejemplos: cada flecha original se dibuja una vez.
    assert.strictEqual(L.edges.filter((e) => !e.bus).length, g.edges.length, f);
    const ids = new Set(L.nodes.map((n) => n.id));
    for (const e of L.edges) assert.ok(ids.has(e.from) && ids.has(e.to), `${f}: ${e.from} -> ${e.to}`);
  }
});

test("sin diagonales ni líneas que pasen por encima de un nodo", () => {
  for (const f of ["v3_app", "v3_uno", "v3_soffice", "inicio_app", "prueba_movil"]) {
    const L = layoutDiagram(parseDiagram(fs.readFileSync(path.join(__dirname, `../examples/${f}.mmd`), "utf8")));
    const byId = Object.fromEntries(L.nodes.map((n) => [n.id, n]));
    const occ = new Set(L.nodes.map((n) => `${n.col},${n.row}`));
    for (const e of L.edges) {
      const a = byId[e.from];
      const b = byId[e.to];
      assert.ok(a.col === b.col || a.row === b.row, `${f}: diagonal ${e.from} -> ${e.to}`);
      const n = Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
      const dc = Math.sign(b.col - a.col);
      const dr = Math.sign(b.row - a.row);
      for (let i = 1; i < n; i++) assert.ok(!occ.has(`${a.col + dc * i},${a.row + dr * i}`), `${f}: ${e.from} -> ${e.to} pisa un nodo`);
    }
    assert.ok(!L.warnings.some((w) => /Choque/.test(w.message)), f);
  }
});

test("nodo sin sitio cerca: se inserta una fila o columna y nadie queda encima de una línea", () => {
  // x tiene 4 conexiones ocupando sus 4 lados con hijos que a su vez tienen hijos (no se pueden
  // mover); su 5ª conexión obliga a hacer sitio.
  const L = layout(
    ["p --> x", "x --> a --> a2", "x --> b --> b2", "x --> c --> c2", "x --> d", "d --> d2"].join("\n")
  );
  const occ = new Map(L.nodes.map((n) => [`${n.col},${n.row}`, n]));
  assert.strictEqual(occ.size, L.nodes.length, "ningún nodo comparte celda");
  assert.ok(!L.warnings.some((w) => /Choque/.test(w.message)));
  assert.strictEqual(L.edges.filter((e) => !e.bus).length, 9);
});

test("historia del paso a paso: cada paso muestra el diagrama como estaba entonces (v3_app, oMainOds)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../examples/v3_app.mmd"), "utf8");
  const L = layoutDiagram(parseDiagram(src));
  const name = (n) => n.realId || (n.junctionOf && `● ${n.junctionOf}`) || n.id;
  const stepOf = (id) => L.nodes.find((n) => name(n) === id).step;
  const at = (k, id) => L.snapshotAt(k).nodes.find((n) => name(n) === id);
  const near = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
  // Al colocarse, oMainOds queda pegado a A8; en el paso siguiente la extensión de A8 lo mueve.
  const k = stepOf("oMainOds");
  assert.ok(near(at(k, "oMainOds"), at(k, "A8")));
  assert.ok(!at(k, "● A8"));
  assert.ok(at(k + 1, "● A8"));
  assert.ok(!near(at(k + 1, "oMainOds"), at(k + 1, "A8")));
  // Cada paso tiene un nodo más que el anterior y el último es el diagrama final.
  for (let i = 0; i < L.nodes.length; i++) assert.strictEqual(L.snapshotAt(i).nodes.length, i + 1);
});

test("hacer sitio desplaza solo el bloque necesario, no toda la fila (v3_app, empalme de V6)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../examples/v3_app.mmd"), "utf8");
  const L = layoutDiagram(parseDiagram(src));
  const pushed = L.nodes.find((n) => /no había sitio cerca/.test(n.why));
  assert.ok(pushed, "hay un desplazamiento");
  const k = pushed.step;
  const before = new Map(L.snapshotAt(k - 1).nodes.map((n) => [n.id, `${n.col},${n.row}`]));
  const after = new Map(L.snapshotAt(k).nodes.map((n) => [n.id, `${n.col},${n.row}`]));
  const moved = [...before].filter(([id, pos]) => after.get(id) !== pos).map(([id]) => id);
  const n = Number(pushed.why.match(/(\d+) nodos?/)[1]);
  // El paso de la extensión coloca empalme y nodo en el mismo paso: puede que el desplazamiento se
  // vea en el paso del empalme; se comprueba en la ventana de dos pasos.
  const before2 = new Map(L.snapshotAt(k - 2).nodes.map((x) => [x.id, `${x.col},${x.row}`]));
  const moved2 = [...before2].filter(([id, pos]) => after.get(id) !== pos).map(([id]) => id);
  assert.ok(moved.length === n || moved2.length === n, `${n} anunciados, movidos ${moved.length}/${moved2.length}`);
  // El bloque de A9/A10 (morado en la captura) no se mueve.
  for (const id of ["A9", "A10"]) assert.ok(!moved2.includes(id), `${id} no debería moverse`);
});

test("varios padres: la flecha que quedaría en diagonal o sobre un nodo termina en un conector (v3_app, F1 -> F3)", () => {
  const src = fs.readFileSync(path.join(__dirname, "../examples/v3_app.mmd"), "utf8");
  const L = layoutDiagram(parseDiagram(src));
  const byId = Object.fromEntries(L.nodes.map((n) => [n.id, n]));
  const e = L.edges.find((x) => x.label === "cierre normal o caja cedida");
  const dot = byId[e.to];
  assert.strictEqual(dot.shape, "junction");
  assert.strictEqual(dot.junctionOf, "F3", "la pastilla dice adónde va");
  const src2 = byId[e.from];
  assert.strictEqual(Math.abs(dot.col - src2.col) + Math.abs(dot.row - src2.row), 1);
  // En el paso a paso tampoco aparece ninguna diagonal provisional.
  for (let k = 0; k < L.nodes.length; k++) {
    const s = L.snapshotAt(k);
    const m = Object.fromEntries(s.nodes.map((n) => [n.id, n]));
    for (const x of s.edges) assert.ok(m[x.from].col === m[x.to].col || m[x.from].row === m[x.to].row, `paso ${k + 1}`);
  }
});
