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
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  return true;
}

module.exports = { abrir };
