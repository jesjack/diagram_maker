#!/usr/bin/env node
// dmk: diagramas de flujo a partir de sintaxis Mermaid (ver README.md y SPEC.md).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { construirHtml } = require("../lib/html.js");
const { servirUnaVez, vigilar } = require("../lib/servir.js");
const { abrir } = require("../lib/abrir.js");
const { expandir } = require("../lib/entradas.js");

const AYUDA = `dmk: diagramas de flujo a partir de sintaxis Mermaid.

Uso:
  dmk archivo.mmd               genera archivo.html junto al .mmd y lo abre en el navegador
  dmk notas.md                  cada bloque \`\`\`mermaid del .md (notas.html, o notas-1.html, notas-2.html…)
  dmk carpeta/ --svg            todos los .mmd y .md de la carpeta (sin entrar en subcarpetas)
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
      --servidor        abrir sirviendo la página desde 127.0.0.1 en vez de abrir el archivo
                        (para navegadores en sandbox, como Edge en flatpak, que no leen cualquier carpeta)
      --tema TEMA       claro, oscuro o auto (el del sistema; por defecto). SVG/PNG: claro
  -c, --comprobar       validar sin generar nada (código de salida 1 si alguno tiene errores)
      --ligero          HTML sin Mermaid incrustado (~130 kB en vez de ~1,4 MB; sin botón «Mermaid»)
  -w, --watch           servir hasta Ctrl+C y actualizar la página al guardar el .mmd
      --no-abrir        no abrir el navegador (con --watch se sirve igual)
  -h, --ayuda           esta ayuda
  -v, --version         versión`;

function leerArgumentos(argv) {
  const op = { archivos: [], tema: null, comprobar: false, salida: null, formato: "html", abrir: true, watch: false, escala: 2, servidor: false, ligero: false };
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
      case "--servidor":
      case "--server":
        op.servidor = true;
        break;
      case "--sin-servidor": // ya es lo normal; se acepta por compatibilidad
      case "--no-server":
        op.servidor = false;
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

// dmk --comprobar: una línea por diagrama; los errores no paran el resto.
function comprobarTodos(op) {
  const { comprobar } = require("../lib/exportar.js");
  const archivos = op.archivos.length ? expandir(op.archivos) : [null];
  let fallos = 0;
  for (const trabajo of archivos) {
    const nombre = trabajo?.nombre || "(entrada)";
    try {
      const source = leerFuente(trabajo);
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
    const resultado = aSvg(source, tema);
    avisar(resultado.warnings, varios ? `${trabajo.nombre}: ` : "");
    const destino = op.salida || junto(op.formato);
    const datos = op.formato === "svg" ? resultado.svg : await aPng(resultado.svg, op.escala, tema);
    fs.writeFileSync(destino, datos);
    console.log(`${op.formato.toUpperCase()} generado: ${destino}`);
    return;
  }

  // HTML con el visor.
  const opciones = { mermaid: !op.ligero, tema: op.tema || "auto" };
  const html = construirHtml(source, title, null, opciones);
  // Sin archivo ni -o (terminal o tubería) el HTML se guarda en la carpeta temporal para abrirlo.
  let salida = op.salida || (archivo ? junto("html") : null);
  if (!salida && op.abrir && !op.servidor && !op.watch) salida = path.join(os.tmpdir(), "dmk-diagrama.html");
  if (salida) {
    fs.writeFileSync(salida, html);
    console.log(`HTML generado: ${salida}`);
  } else if (!op.abrir) {
    throw new Error("Sin archivo de entrada hace falta -o para guardar el HTML.");
  }
  if (varios) return;
  if (op.watch) vigilar(trabajo.archivo, title, { salida, abrirNavegador: op.abrir, ...opciones });
  else if (!op.abrir) return;
  else if (op.servidor) await servirUnaVez(html);
  else abrir(path.resolve(salida), { esArchivo: true });
}

async function main() {
  const op = leerArgumentos(process.argv.slice(2));
  if (op.comprobar) return comprobarTodos(op);
  const trabajos = op.archivos.length ? expandir(op.archivos) : [null];
  const varios = trabajos.length > 1;
  if (op.watch && !op.archivos.length) fallar("--watch necesita un archivo .mmd que vigilar (no funciona con la terminal ni con tuberías).");
  if (op.watch && (varios || trabajos[0].fuente !== undefined)) fallar("--watch vigila un solo archivo .mmd.");
  if (op.watch && op.formato !== "html") fallar("--watch es para el visor: no se combina con --svg ni --png.");
  if (op.salida && varios) fallar("-o no se combina con varios diagramas: cada resultado va junto a su archivo.");
  // Con varios archivos solo se generan (como --html); los errores no paran el resto.
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
