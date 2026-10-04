// Servidores en 127.0.0.1 (como diagram.py): se usa un servidor en lugar de file:// porque los
// navegadores en sandbox (flatpak, snap) no suelen tener acceso a cualquier carpeta del disco.

const fs = require("node:fs");
const http = require("node:http");
const { construirHtml } = require("./html.js");
const { abrir } = require("./abrir.js");

const ESPERA = 30000; // ms que se espera a que el navegador pida la página
const SONDEO = 500; // ms entre comprobaciones del .mmd con --watch

// Sirve la página una vez y termina.
function servirUnaVez(html, { abrirNavegador = true } = {}) {
  return new Promise((resolve) => {
    const servidor = http.createServer((req, res) => {
      if (req.url !== "/") {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
      clearTimeout(limite);
      console.log("Listo: el navegador ha recibido la página.");
      servidor.close(() => resolve(true));
    });
    const limite = setTimeout(() => {
      console.error(`El navegador no pidió la página en ${ESPERA / 1000}s (${url()}). Vuelve a intentarlo o abre el HTML guardado.`);
      servidor.close(() => resolve(false));
    }, ESPERA);
    const url = () => `http://127.0.0.1:${servidor.address().port}/`;
    servidor.listen(0, "127.0.0.1", () => {
      if (abrirNavegador && abrir(url())) console.log(`Esperando a que el navegador pida ${url()} (máximo ${ESPERA / 1000}s)…`);
      else console.log(`Página en ${url()}`);
    });
  });
}

// --watch: "/" da la página con el código y la versión actuales y "/source?v=N" responde 204 si N
// sigue siendo la versión actual o { version, source } en JSON si hay una nueva. Se vigila el
// .mmd por sondeo (fecha y tamaño); la versión solo sube si el contenido cambia de verdad.
function vigilar(ruta, title, { salida = null, abrirNavegador = true, mermaid = true, tema = "auto", motor = "main" } = {}) {
  let version = 1;
  let source = fs.readFileSync(ruta, "utf8");
  const sello = () => {
    try {
      const st = fs.statSync(ruta);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return null; // p. ej. un editor que guarda borrando y renombrando: se vuelve a mirar luego
    }
  };
  let ultimo = sello();

  const servidor = http.createServer((req, res) => {
    const [ruta2, query = ""] = req.url.split("?");
    const responder = (code, tipo, texto = "") => {
      const cabeceras = { "Cache-Control": "no-store" };
      if (tipo) cabeceras["Content-Type"] = tipo;
      res.writeHead(code, cabeceras).end(texto);
    };
    if (ruta2 === "/") responder(200, "text/html; charset=utf-8", construirHtml(source, title, { version }, { mermaid, tema, motor }));
    else if (ruta2 === "/source") {
      const v = new URLSearchParams(query).get("v");
      if (v === String(version)) responder(204);
      else responder(200, "application/json; charset=utf-8", JSON.stringify({ version, source }));
    } else responder(404);
  });

  servidor.listen(0, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${servidor.address().port}/`;
    console.log(`Recarga en vivo en ${url}`);
    console.log(`Vigilando ${ruta}: al guardarlo, la página se actualiza sola. Ctrl+C para salir.`);
    if (abrirNavegador) abrir(url);
  });

  const reloj = setInterval(() => {
    const s = sello();
    if (s === null || s === ultimo) return;
    let nuevo;
    try {
      nuevo = fs.readFileSync(ruta, "utf8");
    } catch {
      return; // a medio escribir: se reintenta en la siguiente vuelta
    }
    ultimo = s;
    if (nuevo === source) return; // guardado sin cambios
    source = nuevo;
    version++;
    if (salida) fs.writeFileSync(salida, construirHtml(source, title, null, { mermaid, tema, motor }));
    console.log(`[${new Date().toTimeString().slice(0, 8)}] Cambio detectado (versión ${version}).`);
  }, SONDEO);

  const parar = () => {
    clearInterval(reloj);
    servidor.close();
    console.log("\nServidor detenido.");
    process.exit(0);
  };
  process.on("SIGINT", parar);
  process.on("SIGTERM", parar);
  return servidor;
}

module.exports = { servirUnaVez, vigilar };
