// Red de seguridad del layout con diagramas aleatorios (ver random-diagrams.js): para cada semilla
// se genera un diagrama válido y se comprueban los invariantes (sin choques, sin diagonales, sin
// flechas sobre nodos, sin flechas perdidas, paso a paso coherente, SVG sin NaN...).
//
// Los fallos ya conocidos están en CONOCIDOS (por semilla) y, reducidos a un caso mínimo, como
// tests `todo` al final: así la suite sigue en verde y quedan documentados. Si un cambio en el
// layout hace fallar una semilla nueva, se reduce con `node tests/random-diagrams.js <semilla> reducir`.
const test = require("node:test");
const assert = require("node:assert");
const { parseDiagram } = require("../src/parser.js");
const { generarDiagrama, revisar, reducir, crearAzar } = require("./random-diagrams.js");

const SEMILLAS = 400;

// Fallos conocidos en las semillas 1..400, con la inicial de cada invariante roto:
// D diagonal, P diagonal en el paso a paso, F flecha sobre un nodo, C aviso de choque,
// X celda compartida, E error fatal, N nº de nodos del paso a paso.
const INICIAL = {
  diagonal: "D",
  "paso a paso: diagonal": "P",
  "flecha sobre un nodo": "F",
  choque: "C",
  "celda compartida": "X",
  "error fatal": "E",
  "paso a paso: nº de nodos": "N",
};
const CONOCIDOS = new Map(
  (
    "111:F"
  )
    .split(" ")
    .map((x) => x.split(":"))
    .map(([s, letras]) => [Number(s), letras])
);

test(`diagramas aleatorios: ${SEMILLAS} semillas sin fallos nuevos`, (t) => {
  const nuevos = [];
  let conocidos = 0;
  let arreglados = 0;
  for (let s = 1; s <= SEMILLAS; s++) {
    const problemas = revisar(generarDiagrama(s));
    const permitidas = CONOCIDOS.get(s) || "";
    const nuevo = problemas.filter((p) => !permitidas.includes(INICIAL[p.inv] || "?"));
    if (nuevo.length) nuevos.push(`semilla ${s}: ${nuevo.map((p) => `${p.inv} (${p.detalle})`).join("; ")}`);
    else if (problemas.length) conocidos++;
    else if (permitidas) arreglados++;
  }
  t.diagnostic(`${conocidos} semillas con fallos conocidos; ${arreglados} conocidas que ya pasan`);
  assert.deepStrictEqual(nuevos, [], "fallos nuevos: redúcelos con node tests/random-diagrams.js <semilla> reducir");
});

test("generador: determinista y con entradas válidas y variadas", () => {
  assert.strictEqual(generarDiagrama(7), generarDiagrama(7));
  assert.notStrictEqual(generarDiagrama(7), generarDiagrama(8));
  const r = crearAzar(1);
  assert.ok(Array.from({ length: 100 }, () => r.next()).every((x) => x >= 0 && x < 1));

  const vistos = { subgraph: 0, anidado: 0, dir: 0, clase: 0, cadena: 0, grande: 0, concentrador: 0 };
  for (let s = 1; s <= 200; s++) {
    const src = generarDiagrama(s);
    const g = parseDiagram(src); // no lanza: la entrada es válida
    if (g.subgraphs.length) vistos.subgraph++;
    if (g.subgraphs.some((sg) => sg.parent)) vistos.anidado++;
    if (g.meta.dirs.length) vistos.dir++;
    if (/:::/.test(src)) vistos.clase++;
    if (g.edges.some((e, i) => i && e.line === g.edges[i - 1].line)) vistos.cadena++;
    if (g.nodes.size >= 40) vistos.grande++;
    const grado = new Map();
    for (const e of g.edges) for (const id of [e.from, e.to]) grado.set(id, (grado.get(id) || 0) + 1);
    if ([...grado.values()].some((k) => k > 4)) vistos.concentrador++;
  }
  for (const [k, v] of Object.entries(vistos)) assert.ok(v >= 5, `pocos diagramas con ${k}: ${v}`);
});

test("reductor: deja un caso mínimo que sigue fallando igual", () => {
  const min = reducir(generarDiagrama(111));
  assert.ok(min.split("\n").length < generarDiagrama(111).split("\n").length, min);
  assert.ok(revisar(min).some((p) => p.inv === "flecha sobre un nodo"));
});

// ---------------------------------------------------------------- fallos conocidos (casos mínimos)

const sinProblemas = (src) => assert.deepStrictEqual(revisar(src), []);

test(
  "un empalme lo coloca su dueño, no una rama que llega a él (antes: extensión en diagonal; semillas 13, 43, 53, 55...)",
  () => sinProblemas(["b --> f", "a --> b", "b --> c", "d --> b", "c --> b"].join("\n"))
);

test(
  "un empalme lo coloca su dueño (antes: la extensión pasaba por encima de nodos; semilla 120)",
  () =>
    sinProblemas(
      [
        'n3{"x"}', "n0 --> n1", "n2 --> n23", "n1 --> n4", "n1 --> n3", "n1 --> n6", 'n2 --- n8{"x"}', "n8 --> n11",
        "n3 --- n19", "n2 --> n15", "n15 --> n17", "n2 --> n18", "n18 --> n21", "n0 --> n2", "n22 --> n0", "n21 --> n3",
        "n15 --> n1",
      ].join("\n")
    )
);

test(
  "hacer sitio: el plan se comprueba con las posiciones finales (antes: el nodo caía sobre una flecha alargada; semillas 89, 107)",
  () =>
    sinProblemas(
      [
        "n2 --> n8", "n2 ==> n16", "n9 --> n30", "n2 ==> n29", "n4 --> n7", "n7 --- n14", "n23 --> n6", "n2 --> n7",
        "n30 --> n23", "n7 --> n9", "n7 --> n30",
      ].join("\n")
    )
);

test(
  "hacer sitio con dos flechas paralelas al mismo hijo (semilla 83)",
  () =>
    sinProblemas(
      [
        "n0 --> n1", "n1 --> n2", 'n11{"x"} --- n12', "n0 --- n5", "n5 --> n7", "n5 --- n7", "n7 --> n9",
        'n9 --> n10{"x"}', "n10 --> n11", "n1 --> n4", "n5 --> n11",
      ].join("\n")
    )
);

test(
  "un nodo sin padre pegado a su hijo respeta sus propios @dir (antes: error fatal; semillas 206, 1330, 1547)",
  () => sinProblemas(["a --> c", "b --> c", "b --> d", "%% @dir b -> d : up"].join("\n"))
);

test(
  "@dir hacia una referencia de subgraph: preferencia, no obligación (antes: error fatal y luego choque; semilla 943)",
  () =>
    sinProblemas(
      [
        "subgraph S2", '  n10("x")', '  n1(["x"])', "end", "n3 ==> n8", "n10 --> n13", "n1 --> n3", "n3 --> n4",
        "n3 --> n5", "n13 --> n3", "%% @dir n10 -> n13 : left",
      ].join("\n")
    )
);

test(
  "grupo reconstruido: un nodo sin sitio se coloca después con la cascada (antes: choque; semillas 276, 303, 636, 920)",
  () =>
    sinProblemas(
      [
        "n29", "n4 --> n5", "n5 --> n8", "n17{x} --> n20", "n8 --- n17", "n5 --> n13", "n29 --- n34", "n17 --- n42",
        "n13 --- n34", "n17 --> n36",
      ].join("\n")
    )
);

test(
  "paso a paso: al quitar un empalme sin ramas los pasos se renumeran (semilla 273)",
  () =>
    sinProblemas(
      [
        "n0 --> n1", "n1 --> n2", "n0 --> n3", "n3 --- n10", "n2 --> n6", "n0 --- n9", "n6 --> n8", "n8 --> n10",
        "n10 --> n11", "n1 --> n10", "n9 --> n10",
      ].join("\n")
    )
);

test(
  "paso a paso: sin diagonales intermedias (semilla 398)",
  () =>
    sinProblemas(
      [
        "n9 --> n11", "n5 --> n6", 'n1 --> n18{"x"}', "n8 --> n9", "n7 --> n10", "n9 ==> n12", "n12 --> n13",
        "n13 --> n16", "n16 --> n17", "n18 ==> n19", "n13 --> n10", "n22 ==> n10", 'n20{"x"} ==> n22', "n22 --> n37",
        'n19 --> n25{"x"}', "n8 --> n39", "n5 --> n8", "n37 --> n38", "n16 --> n40", "n31 --> n42", "n10 ==> n38",
        "n10 --> n42", "n2 ==> n22", "n22 ==> n19", "n19 --- n20", "n20 --- n5", "n20 --> n21", "n21 --> n41",
        "n37 --> n20", "n10 --> n43", "n39 --> n41", "n32 --> n10", "%% @dir n22 -> n10 : up",
      ].join("\n")
    )
);
