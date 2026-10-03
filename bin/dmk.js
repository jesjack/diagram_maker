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
  dmk a.mmd b.mmd --svg         varios archivos: cada uno junto a su .mmd (sin abrir nada)
  dmk *.mmd --comprobar         valida sin dibujar: errores, avisos y tamaño de cada diagrama
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
      --tema TEMA       claro, oscuro o auto (el del sistema; por defecto). SVG/PNG: claro
  -c, --comprobar       validar sin generar nada (código de salida 1 si alguno tiene errores)
      --ligero          HTML sin Mermaid incrustado (~130 kB en vez de ~1,4 MB; sin botón «Mermaid»)
  -w, --watch           servir hasta Ctrl+C y actualizar la página al guardar el .mmd
      --no-abrir        no abrir el navegador (con --watch se sirve igual)
  -h, --ayuda           esta ayuda
  -v, --version         versión`;

function leerArgumentos(argv) {
  const op = { archivos: [], tema: null, comprobar: false, salida: null, formato: "html", abrir: true, watch: false, escala: 2, sinServidor: false, ligero: false };
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
      case "--ligero":
      case "--light":
        op.ligero = true;
        break;
      case "--tema":
      case "--theme":
        op.tema = { light: "claro", dark: "oscuro" }[argv[i + 1]] || conValor(i, a);
        i++;
        if (!["claro", "oscuro", "auto"].includes(op.tema)) fallar("--tema admite claro, oscuro o auto.");
        break;
      case "--oscuro":
      case "--dark":
        op.tema = "oscuro";
        break;
      case "-c":
      case "--comprobar":
      case "--check":
        op.comprobar = true;
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
        op.archivos.push(a);
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
      throw new Error(`No se pudo leer '${archivo}': ${err.code === "ENOENT" ? "no existe" : err.message}`);
    }
  }
  if (process.stdin.isTTY) console.error("Escribe el diagrama (termina con Ctrl+D):");
  return fs.readFileSync(0, "utf8");
}

const avisar = (warnings, prefijo = "") => {
  for (const w of warnings) console.error(`${prefijo}aviso: ${w.line ? `línea ${w.line}: ` : ""}${w.message}`);
};

// dmk --comprobar: una línea por diagrama; los errores no paran el resto.
function comprobarTodos(op) {
  const { comprobar } = require("../lib/exportar.js");
  const archivos = op.archivos.length ? op.archivos : [null];
  let fallos = 0;
  for (const archivo of archivos) {
    const nombre = archivo || "(entrada)";
    try {
      const source = leerFuente(archivo);
      if (!source.trim()) throw new Error("El diagrama está vacío.");
      const r = comprobar(source);
      const n = (k, palabra) => `${k} ${palabra}${k === 1 ? "" : "s"}`;
      const extra = r.subgraphs ? `, ${n(r.subgraphs, "subgraph")}` : "";
      const avisos = r.warnings.length ? `, ${n(r.warnings.length, "aviso")}` : "";
      console.log(`ok     ${nombre}: ${n(r.nodos, "nodo")}, ${n(r.aristas, "arista")}${extra}${avisos}`);
      avisar(r.warnings, `       ${nombre}: `);
    } catch (err) {
      fallos++;
      console.error(`error  ${nombre}: ${err.message}`);
    }
  }
  if (archivos.length > 1) console.log(`${archivos.length - fallos} de ${archivos.length} sin errores.`);
  if (fallos) process.exitCode = 1;
}

// Un diagrama: exporta a SVG/PNG o genera (y abre) el HTML. Lanza Error si algo falla.
async function procesar(archivo, op, varios) {
  const source = leerFuente(archivo);
  if (!source.trim()) throw new Error("El diagrama está vacío.");
  const title = archivo ? path.basename(archivo).replace(/\.[^.]+$/, "") : "diagrama";
  const junto = (ext) => (archivo ? archivo.replace(/(\.[^./\\]+)?$/, `.${ext}`) : `${title}.${ext}`);

  // Exportar a SVG / PNG: sin navegador.
  if (op.formato === "svg" || op.formato === "png") {
    const { aSvg, aPng } = require("../lib/exportar.js");
    const tema = op.tema === "oscuro" ? "oscuro" : "claro";
    const resultado = aSvg(source, tema);
    avisar(resultado.warnings, varios ? `${archivo}: ` : "");
    const destino = op.salida || junto(op.formato);
    const datos = op.formato === "svg" ? resultado.svg : await aPng(resultado.svg, op.escala, tema);
    fs.writeFileSync(destino, datos);
    console.log(`${op.formato.toUpperCase()} generado: ${destino}`);
    return;
  }

  // HTML con el visor.
  const opciones = { mermaid: !op.ligero, tema: op.tema || "auto" };
  const html = construirHtml(source, title, null, opciones);
  const salida = op.salida || (archivo ? junto("html") : null);
  if (salida) {
    fs.writeFileSync(salida, html);
    console.log(`HTML generado: ${salida}`);
  } else if (!op.abrir || op.sinServidor) {
    throw new Error("Sin archivo de entrada hace falta -o para guardar el HTML.");
  }
  if (varios) return;
  if (op.watch) vigilar(archivo, title, { salida, abrirNavegador: op.abrir, ...opciones });
  else if (op.sinServidor) abrir(path.resolve(salida), { esArchivo: true });
  else if (op.abrir) await servirUnaVez(html);
}

async function main() {
  const op = leerArgumentos(process.argv.slice(2));
  if (op.comprobar) return comprobarTodos(op);
  const varios = op.archivos.length > 1;
  if (op.watch && !op.archivos.length) fallar("--watch necesita un archivo .mmd que vigilar (no funciona con la terminal ni con tuberías).");
  if (op.watch && varios) fallar("--watch vigila un solo archivo.");
  if (op.watch && op.formato !== "html") fallar("--watch es para el visor: no se combina con --svg ni --png.");
  if (op.salida && varios) fallar("-o no se combina con varios archivos: cada resultado va junto a su .mmd.");
  // Con varios archivos solo se generan (como --html); los errores no paran el resto.
  let fallos = 0;
  for (const archivo of op.archivos.length ? op.archivos : [null]) {
    try {
      await procesar(archivo, op, varios);
    } catch (err) {
      if (!varios) fallar(err.message);
      fallos++;
      console.error(`dmk: ${archivo}: ${err.message}`);
    }
  }
  if (fallos) process.exitCode = 1;
}

main();
