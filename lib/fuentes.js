// Fuentes para usar el motor fuera del navegador: DejaVu Sans (texto) y DejaVu Sans Mono
// (pastillas). Se usan para medir el texto en el layout y para pintar el PNG, así el tamaño de
// los nodos cuadra con lo que se pinta. Lectura mínima de TTF: anchos de avance (hmtx) por
// carácter (cmap formato 4), sin kerning.

const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(path.dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf");
const ARCHIVOS = {
  normal: "DejaVuSans.ttf",
  negrita: "DejaVuSans-Bold.ttf",
  mono: "DejaVuSansMono.ttf",
};

const buffers = {};
const fuente = (nombre) => (buffers[nombre] ||= fs.readFileSync(path.join(DIR, ARCHIVOS[nombre])));

// Anchos de avance de una fuente TTF: { unitsPerEm, ancho(códigoUnicode) }.
function metricas(buf) {
  const tablas = {};
  const n = buf.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16;
    tablas[buf.toString("latin1", r, r + 4)] = buf.readUInt32BE(r + 8);
  }
  const unitsPerEm = buf.readUInt16BE(tablas.head + 18);
  const numberOfHMetrics = buf.readUInt16BE(tablas.hhea + 34);
  const avance = (glifo) => buf.readUInt16BE(tablas.hmtx + 4 * Math.min(glifo, numberOfHMetrics - 1));

  // cmap: subtabla Unicode BMP (plataforma 3/1 o 0/x), formato 4.
  const cmap = tablas.cmap;
  let sub = null;
  for (let i = 0; i < buf.readUInt16BE(cmap + 2); i++) {
    const r = cmap + 4 + i * 8;
    const plataforma = buf.readUInt16BE(r);
    const codif = buf.readUInt16BE(r + 2);
    const off = cmap + buf.readUInt32BE(r + 4);
    if (buf.readUInt16BE(off) === 4 && (plataforma === 0 || (plataforma === 3 && codif === 1))) sub = off;
  }
  const segs = buf.readUInt16BE(sub + 6) / 2;
  const ends = sub + 14;
  const starts = ends + segs * 2 + 2;
  const deltas = starts + segs * 2;
  const rangos = deltas + segs * 2;
  const glifoDe = (c) => {
    for (let i = 0; i < segs; i++) {
      if (c > buf.readUInt16BE(ends + i * 2)) continue;
      const ini = buf.readUInt16BE(starts + i * 2);
      if (c < ini) return 0;
      const delta = buf.readInt16BE(deltas + i * 2);
      const rango = buf.readUInt16BE(rangos + i * 2);
      if (rango === 0) return (c + delta) & 0xffff;
      const g = buf.readUInt16BE(rangos + i * 2 + rango + (c - ini) * 2);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
  const cache = new Map();
  return {
    unitsPerEm,
    ancho: (c) => {
      if (!cache.has(c)) cache.set(c, avance(glifoDe(c)));
      return cache.get(c);
    },
  };
}

const met = {};
const metricasDe = (nombre) => (met[nombre] ||= metricas(fuente(nombre)));

// measure(texto, fuente) para layoutDiagram: ancho en px con DejaVu Sans (negrita si toca).
function medirTexto(texto, f) {
  const m = metricasDe(f && f.bold ? "negrita" : "normal");
  const size = (f && f.size) || 14;
  let total = 0;
  for (const ch of texto) total += m.ancho(ch.codePointAt(0));
  return (total * size) / m.unitsPerEm;
}

const FAMILIA = "'DejaVu Sans', system-ui, sans-serif";

module.exports = { fuente, medirTexto, FAMILIA };
