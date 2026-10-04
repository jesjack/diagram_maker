// Abre una URL o un archivo con el navegador del sistema: Termux (termux-open-url / termux-open),
// macOS (open), Windows (start) o Linux (xdg-open).

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

// ¿Hay un ejecutable con ese nombre en el PATH? Se busca a mano: en Termux no existe el programa
// "which" (es una orden interna del shell).
const existe = (cmd) =>
  (process.env.PATH || "").split(path.delimiter).some((dir) => {
    for (const ext of process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]) {
      try {
        fs.accessSync(path.join(dir, cmd + ext), fs.constants.X_OK);
        return true;
      } catch {}
    }
    return false;
  });

function abrir(destino, { esArchivo = false } = {}) {
  let cmd;
  let args = [destino];
  if (existe(esArchivo ? "termux-open" : "termux-open-url")) cmd = esArchivo ? "termux-open" : "termux-open-url";
  else if (process.platform === "darwin") cmd = "open";
  else if (process.platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", destino];
  } else if (existe("xdg-open")) cmd = "xdg-open";
  if (!cmd) {
    console.error(`No se encontró cómo abrir el navegador. Abre ${destino} manualmente.`);
    return false;
  }
  // Se avisa de lo que pasa: qué orden se usa y si falla al lanzarla o termina con error.
  console.log(`Abriendo ${esArchivo ? "el archivo" : "la página"} con ${cmd}…`);
  const hijo = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], detached: true });
  let errores = "";
  hijo.stderr.on("data", (d) => (errores += d));
  hijo.on("error", (e) => console.error(`No se pudo ejecutar ${cmd} (${e.code || e.message}). Abre ${destino} manualmente.`));
  hijo.on("exit", (codigo) => {
    if (codigo) console.error(`${cmd} terminó con error (código ${codigo})${errores.trim() ? `: ${errores.trim()}` : ""}. Abre ${destino} manualmente.`);
    else if (esArchivo) console.log("Archivo abierto en el navegador.");
  });
  hijo.stderr.unref?.();
  hijo.unref();
  return true;
}

const esTermux = () => (process.env.PREFIX || "").includes("com.termux") || Boolean(process.env.TERMUX_VERSION);

module.exports = { abrir, esTermux };
