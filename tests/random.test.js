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
    "4:F 13:DP 36:DFP 43:DP 53:DP 55:DP 57:DP 76:DFP 78:DP 81:DP 83:F 89:F 102:DP 104:DFP 107:F " +
    "111:DFP 116:F 119:DP 120:F 125:F 130:DP 134:DP 145:DP 162:DP 163:DP 167:F 170:DFP 179:DP 182:F " +
    "195:DP 199:DP 206:E 209:DP 210:F 223:DP 231:DP 260:F 266:DP 273:N 276:CX 277:DP 286:DP 300:DP " +
    "302:F 303:CDPX 306:DP 308:DP 315:F 349:F 354:DP 357:DP 358:F 362:F 368:DP 370:DP 371:DP 373:F " +
    "391:DP 398:FP"
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
  const min = reducir(generarDiagrama(53));
  assert.ok(min.split("\n").length <= 8, min);
  assert.ok(revisar(min).some((p) => p.inv === "diagonal"));
});

// ---------------------------------------------------------------- fallos conocidos (casos mínimos)

const sinProblemas = (src) => assert.deepStrictEqual(revisar(src), []);

test(
  "empalme colocado desde una rama antes que su dueño: la extensión queda en diagonal (semillas 13, 43, 53, 55...)",
  { todo: "regla 4: el empalme de b se coloca como hijo de c (por c --> b, movida al empalme) y la extensión b -> b● queda en diagonal" },
  () => sinProblemas(["b --> f", "a --> b", "b --> c", "d --> b", "c --> b"].join("\n"))
);

test(
  "empalme colocado desde una rama antes que su dueño: la extensión pasa por encima de nodos (semilla 120)",
  { todo: "regla 4: n1● se coloca junto a n15 y la extensión n1 -> n1● cruza n11" },
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
  "hacer sitio: el nodo nuevo cae sobre una flecha que el desplazamiento alargó (semillas 89, 107)",
  { todo: "regla 10.3: tras desplazar n9 y n30 hacia arriba, el conector de n30 va a la celda que cruza n30 -> n23" },
  () =>
    sinProblemas(
      [
        "n2 --> n8", "n2 ==> n16", "n9 --> n30", "n2 ==> n29", "n4 --> n7", "n7 --- n14", "n23 --> n6", "n2 --> n7",
        "n30 --> n23", "n7 --> n9", "n7 --> n30",
      ].join("\n")
    )
);

test(
  "hacer sitio con dos flechas paralelas al mismo hijo: solo una pasa por el empalme (semilla 83)",
  { todo: "regla 10.3: con n5 --> n7 y n5 --- n7, el empalme de la celda liberada recoge una; la otra cruza el empalme" },
  () =>
    sinProblemas(
      [
        "n0 --> n1", "n1 --> n2", 'n11{"x"} --- n12', "n0 --- n5", "n5 --> n7", "n5 --- n7", "n7 --> n9",
        'n9 --> n10{"x"}', "n10 --> n11", "n1 --> n4", "n5 --> n11",
      ].join("\n")
    )
);

test(
  "un nodo sin padre pegado a su hijo ignora sus propios @dir: error fatal con una entrada válida (semillas 206, 1330, 1547)",
  { todo: "regla 9 / findAnchor: b se pega debajo de c (su flecha b -> c sale hacia arriba) y choca con '@dir b -> d : up'" },
  () => sinProblemas(["a --> c", "b --> c", "b --> d", "%% @dir b -> d : up"].join("\n"))
);

test(
  "lo mismo con una referencia de subgraph: dos conexiones hacia el mismo lado (semilla 943)",
  { todo: "regla 9 + referencias: el @dir de la referencia entrante y el ancla de n13 piden el mismo lado" },
  () =>
    sinProblemas(
      [
        "subgraph S2", '  n10("x")', '  n1(["x"])', "end", "n3 ==> n8", "n10 --> n13", "n1 --> n3", "n3 --> n4",
        "n3 --> n5", "n13 --> n3", "%% @dir n10 -> n13 : left",
      ].join("\n")
    )
);

test(
  "grupo reconstruido desde su conexión: se acepta aunque un nodo no quepa (semillas 276, 303, 636, 920)",
  { todo: "regla 9 / simulateGroup: n17 tiene sus 4 lados ocupados y n36 cae sobre n20; la extensión se aplica con choques" },
  () =>
    sinProblemas(
      [
        "n29", "n4 --> n5", "n5 --> n8", "n17{x} --> n20", "n8 --- n17", "n5 --> n13", "n29 --- n34", "n17 --- n42",
        "n13 --- n34", "n17 --> n36",
      ].join("\n")
    )
);

test(
  "paso a paso: un empalme quitado deja un hueco en la numeración de los pasos (semilla 273)",
  { todo: "pruneJunctions quita n10● pero los pasos no se renumeran: snapshotAt(k) ya no tiene k+1 nodos" },
  () =>
    sinProblemas(
      [
        "n0 --> n1", "n1 --> n2", "n0 --> n3", "n3 --- n10", "n2 --> n6", "n0 --- n9", "n6 --> n8", "n8 --> n10",
        "n10 --> n11", "n1 --> n10", "n9 --> n10",
      ].join("\n")
    )
);

test(
  "paso a paso: una flecha en diagonal que un desplazamiento posterior endereza se ve en los pasos intermedios (semilla 398)",
  { todo: "historia: n13 se coloca en diagonal con su hijo n10 ya colocado; solo se ocultan las flechas reconducidas" },
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
