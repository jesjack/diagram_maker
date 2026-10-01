#!/usr/bin/env node
// dmk: diagramas de flujo a partir de sintaxis Mermaid (ver README.md y SPEC.md).

const fs = require("node:fs");
const path = require("node:path");
const { construirHtml } = require("../lib/html.js");
const { servirUnaVez, vigilar } = require("../lib/servir.js");
const { abrir } = require("../lib/abrir.js");

const AYUDA = `dmk: diagramas de flujo a partir de sintaxis Mermaid.

Uso:
  dmk archivo.mmd               genera archivo.html junto al .mmd y lo abre en el navegador
  dmk archivo.mmd --watch       recarga en vivo: la página se actualiza al guardar el .mmd
  dmk archivo.mmd --svg         exporta archivo.svg (sin abrir nada)
  dmk archivo.mmd --png         exporta archivo.png (sin abrir nada)
  dmk archivo.mmd --html        solo genera el HTML
  dmk                           escribe el diagrama en la terminal (termina con Ctrl+D)
  cat archivo.mmd | dmk --svg   también por tubería
  dmk --png -o d.png <<'EOF'     o escrito en el propio comando (hasta la línea EOF)

Opciones:
  -o, --salida RUTA     dónde guardar el resultado (.html, .svg o .png)
      --svg [RUTA]      exportar a SVG
      --png [RUTA]      exportar a PNG
      --escala N        escala del PNG (por defecto 2)
      --html            generar el HTML sin abrirlo
      --sin-servidor    abrir el HTML guardado como archivo, sin levantar un servidor
  -w, --watch           servir hasta Ctrl+C y actualizar la página al guardar el .mmd
      --no-abrir        no abrir el navegador (con --watch se sirve igual)
  -h, --ayuda           esta ayuda
  -v, --version         versión`;

function leerArgumentos(argv) {
  const op = { archivo: null, salida: null, formato: "html", abrir: true, watch: false, escala: 2, sinServidor: false };
  const conValor = (i, nombre) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("-")) fallar(`${nombre} necesita un valor.`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--ayuda":
      case "--help":
        console.log(AYUDA);
        process.exit(0);
      case "-v":
      case "--version":
        console.log(require("../package.json").version);
        process.exit(0);
      case "-o":
      case "--salida":
      case "--output":
        op.salida = conValor(i++, a);
        break;
      case "--svg":
      case "--png": {
        op.formato = a.slice(2);
        const v = argv[i + 1];
        if (v && !v.startsWith("-") && v.toLowerCase().endsWith(`.${op.formato}`)) op.salida = argv[++i];
        break;
      }
      case "--escala":
      case "--scale":
        op.escala = Number(conValor(i++, a));
        if (!(op.escala > 0)) fallar("--escala necesita un número mayor que 0.");
        break;
      case "--html":
        op.abrir = false;
        break;
      case "--sin-servidor":
      case "--no-server":
        op.sinServidor = true;
        break;
      case "-w":
      case "--watch":
        op.watch = true;
        break;
      case "--no-abrir":
      case "--no-open":
        op.abrir = false;
        break;
      default:
        if (a.startsWith("-")) fallar(`Opción desconocida: ${a}. Usa dmk --ayuda.`);
        if (op.archivo) fallar(`Solo se admite un archivo de entrada (sobra '${a}').`);
        op.archivo = a;
    }
  }
  return op;
}

function fallar(mensaje) {
  console.error(`dmk: ${mensaje}`);
  process.exit(1);
}

function leerFuente(archivo) {
  if (archivo) {
    try {
      return fs.readFileSync(archivo, "utf8");
    } catch (err) {
      fallar(`No se pudo leer '${archivo}': ${err.code === "ENOENT" ? "no existe" : err.message}`);
    }
  }
  if (process.stdin.isTTY) console.error("Escribe el diagrama (termina con Ctrl+D):");
  return fs.readFileSync(0, "utf8");
}

async function main() {
  const op = leerArgumentos(process.argv.slice(2));
  if (op.watch && !op.archivo) fallar("--watch necesita un archivo .mmd que vigilar (no funciona con la terminal ni con tuberías).");
  if (op.watch && op.formato !== "html") fallar("--watch es para el visor: no se combina con --svg ni --png.");
  const source = leerFuente(op.archivo);
  if (!source.trim()) fallar("El diagrama está vacío.");
  const title = op.archivo ? path.basename(op.archivo).replace(/\.[^.]+$/, "") : "diagrama";
  const junto = (ext) => (op.archivo ? op.archivo.replace(/(\.[^./\\]+)?$/, `.${ext}`) : `${title}.${ext}`);

  // Exportar a SVG / PNG: sin navegador.
  if (op.formato === "svg" || op.formato === "png") {
    const { aSvg, aPng } = require("../lib/exportar.js");
    let resultado;
    try {
      resultado = aSvg(source);
    } catch (err) {
      fallar(err.message);
    }
    for (const w of resultado.warnings) console.error(`aviso: ${w.line ? `línea ${w.line}: ` : ""}${w.message}`);
    const destino = op.salida || junto(op.formato);
    const datos = op.formato === "svg" ? resultado.svg : await aPng(resultado.svg, op.escala);
    fs.writeFileSync(destino, datos);
    console.log(`${op.formato.toUpperCase()} generado: ${destino}`);
    return;
  }

  // HTML con el visor.
  const html = construirHtml(source, title);
  const salida = op.salida || (op.archivo ? junto("html") : null);
  if (salida) {
    fs.writeFileSync(salida, html);
    console.log(`HTML generado: ${salida}`);
  } else if (!op.abrir || op.sinServidor) {
    fallar("Sin archivo de entrada hace falta -o para guardar el HTML.");
  }
  if (op.watch) vigilar(op.archivo, title, { salida, abrirNavegador: op.abrir });
  else if (op.sinServidor) abrir(path.resolve(salida), { esArchivo: true });
  else if (op.abrir) await servirUnaVez(html);
}

main();
