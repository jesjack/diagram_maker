// Progreso de jesjack engine (src/engines/jesjack.js) con los mismos diagramas aleatorios que main
// engine (random.test.js): informa hasta qué semilla llega sin fallos y cuántas de las 400 pasan.
// No hace fallar la suite: es una medida, no una red de seguridad.
// Para ver el detalle de una semilla: node tests/jesjack.test.js <semilla>
const test = require("node:test");
const { generarDiagrama, revisar } = require("./random-diagrams.js");

const SEMILLAS = 400;

// Igual que en random.test.js: cada semilla prueba una dirección (TD, LR, RL, BT por turnos).
const fuente = (s) => generarDiagrama(s).replace("flowchart TD", `flowchart ${["TD", "LR", "RL", "BT"][s % 4]}`);
const problemas = (s) => revisar(fuente(s), { engine: "jesjack" });

const semilla = Number(process.argv[2]);
if (semilla) {
  console.log(fuente(semilla));
  for (const p of problemas(semilla)) console.log(`✖ ${p.inv}: ${p.detalle}`);
} else {
  test(`jesjack engine: progreso con ${SEMILLAS} semillas`, (t) => {
    let primera = null;
    let pasan = 0;
    for (let s = 1; s <= SEMILLAS; s++) {
      const p = problemas(s);
      if (!p.length) pasan++;
      else if (!primera) primera = { s, p: p[0] };
    }
    t.diagnostic(`jesjack engine: pasan ${pasan}/${SEMILLAS}`);
    t.diagnostic(primera ? `primer fallo: semilla ${primera.s}: ${primera.p.inv} (${primera.p.detalle})` : "sin fallos");
  });
}
