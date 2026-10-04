// Convierte los argumentos de dmk en una lista de diagramas: un .mmd es un diagrama, una carpeta
// aporta sus .mmd y .md (sin entrar en subcarpetas) y un .md aporta cada bloque ```mermaid.

const fs = require("node:fs");
const path = require("node:path");

const ES_MERMAID = /\.(mmd|mermaid)$/i;
const ES_MARKDOWN = /\.(md|markdown)$/i;

// Bloques ```mermaid (o ~~~mermaid) de un texto Markdown, con la línea donde empieza su código.
function bloquesMermaid(texto) {
  const lineas = texto.split(/\r?\n/);
  const bloques = [];
  for (let i = 0; i < lineas.length; i++) {
    const m = /^ {0,3}(`{3,}|~{3,})\s*(mermaid|mmd)\b/i.exec(lineas[i]);
    if (!m) continue;
    const cierre = new RegExp(`^ {0,3}${m[1][0]}{${m[1].length},}\\s*$`);
    let fin = i + 1;
    while (fin < lineas.length && !cierre.test(lineas[fin])) fin++;
    bloques.push({ linea: i + 2, fuente: lineas.slice(i + 1, fin).join("\n") + "\n" });
    i = fin;
  }
  return bloques;
}

// Diagramas de un .md: uno por bloque. Con un solo bloque el resultado se llama como el .md
// (doc.html); con varios, doc-1.html, doc-2.html…
function desdeMarkdown(archivo, { obligatorio = true } = {}) {
  let texto;
  try {
    texto = fs.readFileSync(archivo, "utf8");
  } catch (err) {
    return [{ nombre: archivo, archivo, error: `No se pudo leer '${archivo}': ${err.code === "ENOENT" ? "no existe" : err.message}` }];
  }
  const bloques = bloquesMermaid(texto);
  if (!bloques.length) return obligatorio ? [{ nombre: archivo, archivo, error: "no tiene bloques ```mermaid." }] : [];
  const base = archivo.replace(ES_MARKDOWN, "");
  return bloques.map((b, i) => {
    const sufijo = bloques.length > 1 ? `-${i + 1}` : "";
    return { nombre: `${archivo}#${i + 1} (línea ${b.linea})`, archivo, fuente: b.fuente, base: base + sufijo };
  });
}

function desdeCarpeta(carpeta) {
  const nombres = fs.readdirSync(carpeta).sort((a, b) => a.localeCompare(b));
  const trabajos = [];
  for (const n of nombres) {
    const ruta = path.join(carpeta, n);
    if (!fs.statSync(ruta).isFile()) continue;
    if (ES_MERMAID.test(n)) trabajos.push(desdeMermaid(ruta));
    else if (ES_MARKDOWN.test(n)) trabajos.push(...desdeMarkdown(ruta, { obligatorio: false }));
  }
  if (!trabajos.length) return [{ nombre: carpeta, archivo: carpeta, error: "no hay diagramas (.mmd ni .md con bloques ```mermaid)." }];
  return trabajos;
}

const desdeMermaid = (archivo) => ({ nombre: archivo, archivo, base: archivo.replace(/(\.[^./\\]+)?$/, "") });

// Cada trabajo: { nombre (para mensajes), archivo (de dónde sale), base (ruta de salida sin
// extensión), fuente (si ya se ha leído), error (si no se puede procesar) }.
function expandir(argumentos) {
  const trabajos = [];
  for (const a of argumentos) {
    let carpeta = false;
    try {
      carpeta = fs.statSync(a).isDirectory();
    } catch {}
    if (carpeta) trabajos.push(...desdeCarpeta(a));
    else if (ES_MARKDOWN.test(a)) trabajos.push(...desdeMarkdown(a));
    else trabajos.push(desdeMermaid(a));
  }
  return trabajos;
}

module.exports = { expandir, bloquesMermaid };
