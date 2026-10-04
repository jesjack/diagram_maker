// Tests del comando dmk: se lanza de verdad, como lo usaría alguien desde la consola.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DMK = path.join(__dirname, "../bin/dmk.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dmk-"));
const dmk = (args, input) => spawnSync(process.execPath, [DMK, ...args], { input, encoding: "utf8", cwd: tmp });
const ejemplo = path.join(tmp, "ej.mmd");
fs.writeFileSync(ejemplo, 'a["Inicio"] --> b{"¿Ok?"}\nb -->|sí| c\nb -->|no| d\n');

test("--svg genera el SVG junto al .mmd, con el diagrama y sus pastillas", () => {
  const r = dmk([ejemplo, "--svg"]);
  assert.strictEqual(r.status, 0, r.stderr);
  const svg = fs.readFileSync(path.join(tmp, "ej.svg"), "utf8");
  assert.match(svg, /^<svg xmlns/);
  assert.match(svg, />Inicio</);
  assert.match(svg, /class="ids"/);
});

test("--png con ruta y escala genera un PNG válido", () => {
  const out = path.join(tmp, "x.png");
  const r = dmk([ejemplo, "--png", out, "--escala", "1"]);
  assert.strictEqual(r.status, 0, r.stderr);
  const png = fs.readFileSync(out);
  assert.strictEqual(png.toString("latin1", 1, 4), "PNG");
  assert.ok(png.length > 1000);
});

test("--html genera el HTML autocontenido sin abrir nada", () => {
  const r = dmk([ejemplo, "--html", "-o", path.join(tmp, "p.html")]);
  assert.strictEqual(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(tmp, "p.html"), "utf8");
  assert.match(html, /DiagramViewer\.start/);
  assert.ok(html.includes('"a[\\"Inicio\\"] --> b{\\"¿Ok?\\"}'), "lleva el código del diagrama");
  assert.strictEqual((html.match(/<\/script>/g) || []).length, 4); // fuente, Mermaid, motor y arranque
});

test("lee el diagrama por la entrada estándar", () => {
  const r = dmk(["--svg", "-o", path.join(tmp, "in.svg")], "x --> y\n");
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(tmp, "in.svg"), "utf8"), />x</);
});

test("errores claros y código de salida 1", () => {
  let r = dmk(["--svg", "-o", path.join(tmp, "e.svg")], "a -- > b\n");
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Línea 1: Se esperaba una arista/);
  r = dmk(["--inventada"]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /Opción desconocida/);
  r = dmk([path.join(tmp, "no-existe.mmd"), "--svg"]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /no existe/);
  r = dmk(["--watch"], "a --> b");
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /--watch necesita un archivo/);
});

test("--version y --ayuda", () => {
  assert.strictEqual(dmk(["--version"]).stdout.trim(), require("../package.json").version);
  assert.match(dmk(["--ayuda"]).stdout, /dmk archivo\.mmd --png/);
});

test("el HTML lleva Mermaid incrustado (botón sin internet); con --ligero no", () => {
  const completo = path.join(tmp, "m.html");
  const ligero = path.join(tmp, "l.html");
  assert.strictEqual(dmk([ejemplo, "--html", "-o", completo]).status, 0);
  assert.strictEqual(dmk([ejemplo, "--html", "--ligero", "-o", ligero]).status, 0);
  const lib = (f) => fs.readFileSync(f, "utf8").match(/<script type="text\/plain" id="mermaid-lib">([^<]*)<\/script>/)[1];
  const b64 = lib(completo);
  assert.ok(b64.length > 900000, "Mermaid incrustado");
  assert.strictEqual(require("node:zlib").gunzipSync(Buffer.from(b64, "base64")).toString("utf8", 0, 200).length, 200);
  assert.strictEqual(lib(ligero), "");
  assert.ok(fs.statSync(ligero).size < 300000);
  assert.ok(!fs.readFileSync(completo, "utf8").includes("cdn.jsdelivr"), "no depende de internet");
});

test("--comprobar valida varios archivos sin generar nada; los errores no paran el resto", () => {
  const malo = path.join(tmp, "malo.mmd");
  fs.writeFileSync(malo, "a -- > b\n");
  const antes = fs.readdirSync(tmp).length;
  const r = dmk([ejemplo, malo, "--comprobar"]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /ok +.*ej\.mmd: 4 nodos, 3 aristas/);
  assert.match(r.stderr, /error +.*malo\.mmd: Línea 1: Se esperaba una arista/);
  assert.match(r.stdout, /1 de 2 sin errores/);
  assert.strictEqual(fs.readdirSync(tmp).length, antes);
  assert.strictEqual(dmk(["-c"], "a --> b\n").status, 0);
});

test("varios archivos: cada resultado junto a su .mmd; -o no se admite", () => {
  const otro = path.join(tmp, "otro.mmd");
  fs.writeFileSync(otro, "x --> y\n");
  const r = dmk([ejemplo, otro, "--svg"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(tmp, "ej.svg")) && fs.existsSync(path.join(tmp, "otro.svg")));
  assert.match(dmk([ejemplo, otro, "--svg", "-o", "x.svg"]).stderr, /-o no se combina/);
  assert.match(dmk([ejemplo, otro, "--watch"]).stderr, /un solo archivo/);
});

test("--tema oscuro: SVG con colores oscuros y el visor arranca en oscuro", () => {
  const svg = path.join(tmp, "osc.svg");
  assert.strictEqual(dmk([ejemplo, "--svg", svg, "--tema", "oscuro"]).status, 0);
  assert.match(fs.readFileSync(svg, "utf8"), /fill="#161b22"/);
  const html = path.join(tmp, "osc.html");
  assert.strictEqual(dmk([ejemplo, "--html", "--ligero", "--oscuro", "-o", html]).status, 0);
  assert.match(fs.readFileSync(html, "utf8"), /theme: "oscuro"/);
  assert.match(dmk(["--tema", "rosa"]).stderr, /claro, oscuro o auto/);
});

test("un .md: un diagrama por bloque ```mermaid; sin bloques es un error", () => {
  const dir = fs.mkdtempSync(path.join(tmp, "md-"));
  const md = path.join(dir, "notas.md");
  fs.writeFileSync(md, "# Notas\n\n```mermaid\nx --> y\n```\n\n~~~mermaid\np --> q\n~~~\n\n```js\nno --> es\n```\n");
  const r = dmk([md, "--svg"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ["notas-1.svg", "notas-2.svg", "notas.md"]);
  const uno = path.join(dir, "uno.md");
  fs.writeFileSync(uno, "```mermaid\na --> b\n```\n");
  assert.strictEqual(dmk([uno, "--html"]).status, 0);
  assert.ok(fs.existsSync(path.join(dir, "uno.html")));
  const vacio = path.join(dir, "vacio.md");
  fs.writeFileSync(vacio, "# nada\n");
  assert.match(dmk([vacio, "--svg"]).stderr, /no tiene bloques/);
  assert.match(dmk([uno, "--watch"]).stderr, /un solo archivo \.mmd/);
});

test("una carpeta: sus .mmd y los bloques de sus .md, sin entrar en subcarpetas", () => {
  const dir = fs.mkdtempSync(path.join(tmp, "dir-"));
  fs.mkdirSync(path.join(dir, "sub"));
  fs.writeFileSync(path.join(dir, "a.mmd"), "a --> b\n");
  fs.writeFileSync(path.join(dir, "b.md"), "```mermaid\nc --> d\n```\n");
  fs.writeFileSync(path.join(dir, "leeme.md"), "sin diagramas\n");
  fs.writeFileSync(path.join(dir, "sub", "c.mmd"), "e --> f\n");
  const r = dmk([dir, "--svg"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, "a.svg")) && fs.existsSync(path.join(dir, "b.svg")));
  assert.ok(!fs.existsSync(path.join(dir, "sub", "c.svg")) && !fs.existsSync(path.join(dir, "leeme.svg")));
  assert.match(dmk([dir, "--comprobar"]).stdout, /2 de 2 sin errores/);
  assert.match(dmk([fs.mkdtempSync(path.join(tmp, "nada-")), "--svg"]).stderr, /no hay diagramas/);
});

test("varios diagramas en HTML: una sola página con todos y el selector", () => {
  const dir = fs.mkdtempSync(path.join(tmp, "juntos-"));
  const md = path.join(dir, "notas.md");
  fs.writeFileSync(md, "```mermaid\nx --> y\n```\n\n```mermaid\np --> q\n```\n");
  fs.writeFileSync(path.join(dir, "a.mmd"), "a --> b\n");
  const r = dmk([md, "--html"]);
  assert.strictEqual(r.status, 0, r.stderr);
  const html = fs.readFileSync(path.join(dir, "notas.html"), "utf8");
  const fuente = JSON.parse(/<script type="application\/json" id="diagram-source">(.*?)<\/script>/s.exec(html)[1]);
  assert.deepStrictEqual(fuente, [{ title: "notas-1", source: "x --> y\n" }, { title: "notas-2", source: "p --> q\n" }]);
  assert.match(html, /id="picker"/);
  assert.ok(!fs.existsSync(path.join(dir, "notas-1.html")));
  assert.strictEqual(dmk([dir, "--html"]).status, 0);
  assert.ok(fs.existsSync(path.join(dir, path.basename(dir) + ".html")));
  assert.strictEqual(dmk([md, path.join(dir, "a.mmd"), "--html", "-o", path.join(dir, "todo.html")]).status, 0);
  assert.match(fs.readFileSync(path.join(dir, "todo.html"), "utf8"), /"title":"a"/);
});
