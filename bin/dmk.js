#!/usr/bin/env node
// dmk: diagramas de flujo a partir de sintaxis Mermaid (ver README.md y SPEC.md).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { construirHtml } = require("../lib/html.js");
const { servirUnaVez, vigilar } = require("../lib/servir.js");
const { abrir, esTermux } = require("../lib/abrir.js");
const { expandir } = require("../lib/entradas.js");

const MOTORES = ["main", "jesjack"];

const AYUDA = `dmk: diagramas de flujo a partir de sintaxis Mermaid.

Uso:
  dmk archivo.mmd               genera archivo.html junto al .mmd y lo abre en el navegador
  dmk notas.md                  los bloques \`\`\`mermaid del .md en notas.html, con un selector de diagrama
  dmk carpeta/                  los .mmd y .md de la carpeta (sin subcarpetas) en carpeta/carpeta.html
  dmk notas.md --svg            con --svg/--png, un archivo por diagrama (notas-1.svg, notas-2.svg…)
  dmk archivo.mmd --watch       recarga en vivo: la página se actualiza al guardar el .mmd
  dmk archivo.mmd --svg         exporta archivo.svg (sin abrir nada)
  dmk archivo.mmd --png         exporta archivo.png (sin abrir nada)
  dmk archivo.mmd --html        solo genera el HTML
  dmk a.mmd b.mmd               varios archivos: todos en diagramas.html (o -o), con el selector
  dmk a.mmd b.mmd --svg         con --svg/--png, cada uno junto a su .mmd
  dmk *.mmd --check             valida sin dibujar: errores, avisos y tamaño de cada diagrama
  dmk archivo.mmd -e jesjack    coloca con jesjack engine en vez del motor principal
  dmk                           escribe el diagrama en la terminal (termina con Ctrl+D)
  cat archivo.mmd | dmk --svg   también por tubería
  dmk --png -o d.png <<'EOF'     o escrito en el propio comando (hasta la línea EOF)

Opciones:
  -o, --output RUTA     dónde guardar el resultado (.html, .svg o .png)
      --svg [RUTA]      exportar a SVG
      --png [RUTA]      exportar a PNG
      --scale N         escala del PNG (por defecto 2)
      --html            generar el HTML sin abrirlo
      --server          abrir sirviendo la página desde 127.0.0.1 en vez de abrir el archivo
                        (navegadores en sandbox, como Edge en flatpak; en Termux siempre es así)
      --theme TEMA      light, dark o auto (el del sistema; por defecto). SVG/PNG: light
      --dark            igual que --theme dark
  -e, --engine MOTOR    motor de colocación: main (por defecto) o jesjack (en desarrollo)
  -c, --check           validar sin generar nada (código de salida 1 si alguno tiene errores)
      --lite            HTML sin Mermaid incrustado (~130 kB en vez de ~1,4 MB; sin botón «Mermaid»)
  -w, --watch           servir hasta Ctrl+C y actualizar la página al guardar el .mmd
      --no-open         no abrir el navegador (con --watch se sirve igual)
  -h, --help            esta ayuda
  -v, --version         versión`;

// Las opciones en español de la 0.2.0 se siguen aceptando (sin documentar) para no romper scripts.
function leerArgumentos(argv) {
  const op = { archivos: [], tema: null, comprobar: false, salida: null, formato: "html", abrir: true, watch: false, escala: 2, servidor: false, ligero: false, motor: "main" };
  const conValor = (i, nombre) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("-")) fallar(`${nombre} necesita un valor.`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
      case "--ayuda":
        console.log(AYUDA);
        process.exit(0);
      case "-v":
      case "--version":
        console.log(require("../package.json").version);
        process.exit(0);
      case "-o":
      case "--output":
      case "--salida":
        op.salida = conValor(i++, a);
        break;
      case "--svg":
      case "--png": {
        op.formato = a.slice(2);
        const v = argv[i + 1];
        if (v && !v.startsWith("-") && v.toLowerCase().endsWith(`.${op.formato}`)) op.salida = argv[++i];
        break;
      }
      case "--scale":
      case "--escala":
        op.escala = Number(conValor(i++, a));
        if (!(op.escala > 0)) fallar(`${a} necesita un número mayor que 0.`);
        break;
      case "--html":
        op.abrir = false;
        break;
      case "--server":
      case "--servidor":
        op.servidor = true;
        break;
      case "--no-server": // ya es lo normal; se acepta por compatibilidad
      case "--sin-servidor":
        op.servidor = false;
        break;
      case "--lite":
      case "--light": // nombre anterior de --lite
      case "--ligero":
        op.ligero = true;
        break;
      case "--theme":
      case "--tema":
        op.tema = { light: "claro", dark: "oscuro", auto: "auto", claro: "claro", oscuro: "oscuro" }[conValor(i, a)];
        i++;
        if (!op.tema) fallar(`${a} admite light, dark o auto.`);
        break;
      case "--dark":
      case "--oscuro":
        op.tema = "oscuro";
        break;
      case "-e":
      case "--engine":
        op.motor = conValor(i++, a);
        if (!MOTORES.includes(op.motor)) fallar(`${a} admite ${MOTORES.join(" o ")}.`);
        break;
      case "-c":
      case "--check":
      case "--comprobar":
        op.comprobar = true;
        break;
      case "-w":
      case "--watch":
        op.watch = true;
        break;
      case "--no-open":
      case "--no-abrir":
        op.abrir = false;
        break;
      default:
        if (a.startsWith("-")) fallar(`Opción desconocida: ${a}. Usa dmk --help.`);
        op.archivos.push(a);
    }
  }
  return op;
}

function fallar(mensaje) {
  console.error(`dmk: ${mensaje}`);
  process.exit(1);
}

function leerFuente(trabajo) {
  if (trabajo?.error) throw new Error(trabajo.error);
  if (trabajo?.fuente !== undefined) return trabajo.fuente;
  const archivo = trabajo?.archivo;
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

// dmk --check: una línea por diagrama; los errores no paran el resto.
function comprobarTodos(op) {
  const { comprobar } = require("../lib/exportar.js");
  const archivos = op.archivos.length ? expandir(op.archivos) : [null];
  let fallos = 0;
  for (const trabajo of archivos) {
    const nombre = trabajo?.nombre || "(entrada)";
    try {
      const source = leerFuente(trabajo);
      if (!source.trim()) throw new Error("El diagrama está vacío.");
      const r = comprobar(source, op.motor);
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
async function procesar(trabajo, op, varios) {
  const source = leerFuente(trabajo);
  if (!source.trim()) throw new Error("El diagrama está vacío.");
  const archivo = trabajo?.base;
  const title = archivo ? path.basename(archivo) : "diagrama";
  const junto = (ext) => (archivo ? `${archivo}.${ext}` : `${title}.${ext}`);

  // Exportar a SVG / PNG: sin navegador.
  if (op.formato === "svg" || op.formato === "png") {
    const { aSvg, aPng } = require("../lib/exportar.js");
    const tema = op.tema === "oscuro" ? "oscuro" : "claro";
    const resultado = aSvg(source, tema, op.motor);
    avisar(resultado.warnings, varios ? `${trabajo.nombre}: ` : "");
    const destino = op.salida || junto(op.formato);
    const datos = op.formato === "svg" ? resultado.svg : await aPng(resultado.svg, op.escala, tema);
    fs.writeFileSync(destino, datos);
    console.log(`${op.formato.toUpperCase()} generado: ${destino}`);
    return;
  }

  // HTML con el visor.
  const opciones = { mermaid: !op.ligero, tema: op.tema || "auto", motor: op.motor };
  const html = construirHtml(source, title, null, opciones);
  // Sin archivo ni -o (terminal o tubería) el HTML se guarda en la carpeta temporal para abrirlo.
  let salida = op.salida || (archivo ? junto("html") : null);
  if (!salida && op.abrir && !op.servidor && !op.watch && !esTermux()) salida = path.join(os.tmpdir(), "dmk-diagrama.html");
  if (salida) {
    fs.writeFileSync(salida, html);
    console.log(`HTML generado: ${salida}`);
  } else if (!op.abrir) {
    throw new Error("Sin archivo de entrada hace falta -o para guardar el HTML.");
  }
  if (op.watch) vigilar(trabajo.archivo, title, { salida, abrirNavegador: op.abrir, ...opciones });
  else await abrirHtml(salida, html, op);
}

// Se abre el archivo guardado; con --server, o en Termux (el navegador no puede leer los
// archivos de com.termux), se sirve una vez desde 127.0.0.1.
async function abrirHtml(salida, html, op) {
  if (!op.abrir) return;
  if (op.servidor || esTermux()) await servirUnaVez(html);
  else abrir(path.resolve(salida), { esArchivo: true });
}

// Varios diagramas en HTML: una sola página con un selector. Se guarda en -o, junto al .md o
// dentro de la carpeta (con su nombre), o en diagramas.html si hay varios argumentos.
async function procesarJuntos(trabajos, op) {
  const diagramas = [];
  for (const t of trabajos) {
    try {
      diagramas.push({ title: path.basename(t.base), source: leerFuente(t) });
    } catch (err) {
      console.error(`dmk: ${t.nombre}: ${err.message}`);
      process.exitCode = 1;
    }
  }
  if (!diagramas.length) return;
  const [arg] = op.archivos;
  let salida = op.salida;
  if (!salida && op.archivos.length > 1) salida = "diagramas.html";
  else if (!salida && fs.statSync(arg).isDirectory()) salida = path.join(arg, `${path.basename(path.resolve(arg))}.html`);
  else if (!salida) salida = `${trabajos[0].base.replace(/-1$/, "")}.html`;
  const title = path.basename(salida).replace(/\.[^.]+$/, "");
  const html = construirHtml(diagramas, title, null, { mermaid: !op.ligero, tema: op.tema || "auto", motor: op.motor });
  fs.writeFileSync(salida, html);
  console.log(`HTML generado: ${salida} (${diagramas.length} diagramas)`);
  await abrirHtml(salida, html, op);
}

async function main() {
  const op = leerArgumentos(process.argv.slice(2));
  if (op.comprobar) return comprobarTodos(op);
  const trabajos = op.archivos.length ? expandir(op.archivos) : [null];
  const varios = trabajos.length > 1;
  if (op.watch && !op.archivos.length) fallar("--watch necesita un archivo .mmd que vigilar (no funciona con la terminal ni con tuberías).");
  if (op.watch && (varios || trabajos[0].fuente !== undefined)) fallar("--watch vigila un solo archivo .mmd.");
  if (op.watch && op.formato !== "html") fallar("--watch es para el visor: no se combina con --svg ni --png.");
  if (varios && op.formato === "html") return procesarJuntos(trabajos, op);
  if (op.salida && varios) fallar("-o no se combina con varios diagramas en SVG/PNG: cada resultado va junto a su archivo.");
  // Con varios diagramas en SVG/PNG, los errores no paran el resto.
  let fallos = 0;
  for (const trabajo of trabajos) {
    try {
      await procesar(trabajo, op, varios);
    } catch (err) {
      if (!varios) fallar(trabajo?.error ? `${trabajo.nombre}: ${err.message}` : err.message);
      fallos++;
      console.error(`dmk: ${trabajo.nombre}: ${err.message}`);
    }
  }
  if (fallos) process.exitCode = 1;
}

main();
