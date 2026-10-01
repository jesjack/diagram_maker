// Abre una URL o un archivo con el navegador del sistema: Termux (termux-open-url / termux-open),
// macOS (open), Windows (start) o Linux (xdg-open).

const { spawn, spawnSync } = require("node:child_process");

const existe = (cmd) => spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" }).status === 0;

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
