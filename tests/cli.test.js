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
  assert.strictEqual((html.match(/<\/script>/g) || []).length, 3);
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
