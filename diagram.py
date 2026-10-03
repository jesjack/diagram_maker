#!/usr/bin/env python3
"""Genera un diagrama HTML a partir de código Mermaid (subconjunto flowchart) y lo abre en el navegador.

Uso:
    python3 diagram.py archivo.mmd            # genera archivo.html junto al .mmd y lo abre
    python3 diagram.py archivo.mmd -o x.html  # elige dónde guardar el HTML
    python3 diagram.py                        # escribe el diagrama en la terminal (termina con Ctrl+D)
    cat archivo.mmd | python3 diagram.py      # también por tubería
    python3 diagram.py archivo.mmd --no-open  # solo genera el HTML
    python3 diagram.py archivo.mmd --watch    # recarga en vivo: al guardar el .mmd la página
                                              # abierta se actualiza sola (Ctrl+C para salir)

El HTML generado es autocontenido: parser, layout y visor van incrustados.
Con --watch el servidor sigue abierto y la página le pide el código nuevo cuando cambia el .mmd
(con --no-open no se abre el navegador, pero se sirve igual: abre la URL que se muestra).
"""

import argparse
import base64
import http.server
import json
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
SCRIPTS = ["parser.js", "shapes.js", "layout/base.js", "layout/text.js", "layout/directions.js", "layout/junctions.js", "layout/grid-room.js", "layout/grid-groups.js", "layout/grid-cleanup.js", "layout/grid.js", "layout/geometry.js", "layout.js", "render.js", "viewer.js"]
MERMAID = ROOT / "vendor" / "mermaid.min.js.gz"  # para el botón «Mermaid» sin internet
SERVE_TIMEOUT = 30  # segundos que se espera a que el navegador pida la página
WATCH_INTERVAL = 0.5  # segundos entre comprobaciones del .mmd con --watch


def js_literal(value):
    """JSON seguro para incrustar dentro de <script> (evita cerrar la etiqueta con '</')."""
    return json.dumps(value, ensure_ascii=False).replace("</", "<\\/")


def build_html(source, title, live=None):
    """live: None (HTML normal) o {"version": n} para la página servida con --watch, que
    pregunta al servidor por versiones nuevas del código."""
    template = (SRC / "template.html").read_text(encoding="utf-8")
    scripts = "\n".join((SRC / name).read_text(encoding="utf-8") for name in SCRIPTS)
    values = {
        "__DIAGRAM_SOURCE__": js_literal(source),
        "__DIAGRAM_TITLE__": js_literal(title),
        "__DIAGRAM_LIVE__": js_literal(live),
        "__DIAGRAM_THEME__": js_literal("auto"),
        "__DIAGRAM_MERMAID__": base64.b64encode(MERMAID.read_bytes()).decode("ascii") if MERMAID.exists() else "",
        "__DIAGRAM_SCRIPTS__": scripts,
    }
    # Una sola pasada, para que el contenido insertado nunca se vuelva a sustituir.
    return re.sub("|".join(values), lambda m: values[m.group(0)], template)


def read_source(path):
    if path:
        return Path(path).read_text(encoding="utf-8")
    if sys.stdin.isatty():
        print("Escribe el diagrama (termina con Ctrl+D):", file=sys.stderr)
    return sys.stdin.read()


def launch_browser(url):
    """Abre la URL; en Android (Termux) webbrowser no encuentra navegador y se usa termux-open-url."""
    if webbrowser.open(url):
        return
    opener = shutil.which("termux-open-url")
    if opener:
        subprocess.run([opener, url], check=False)
    else:
        print(f"No se encontró navegador. Abre {url} manualmente.", file=sys.stderr)


def open_in_browser(html):
    """Sirve la página una vez en 127.0.0.1 y la abre.

    Se usa un servidor en lugar de file:// porque los navegadores en sandbox (flatpak, snap)
    no suelen tener acceso a cualquier carpeta del disco.
    """
    body = html.encode("utf-8")
    served = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            served.append(True)

        def log_message(self, *args):
            pass

    with http.server.HTTPServer(("127.0.0.1", 0), Handler) as server:
        url = f"http://127.0.0.1:{server.server_address[1]}/"
        launch_browser(url)
        deadline = time.monotonic() + SERVE_TIMEOUT
        while not served and time.monotonic() < deadline:
            server.timeout = max(0.1, deadline - time.monotonic())
            server.handle_request()
        if not served:
            print(f"El navegador no pidió la página en {SERVE_TIMEOUT}s ({url}).", file=sys.stderr)
            return False
    return True


class SourceWatcher:
    """Vigila el .mmd por sondeo del mtime (sin dependencias). Cada cambio real de contenido
    sube la versión; la página la compara con la suya para saber si tiene que volver a dibujar."""

    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.Lock()
        self.version = 1
        self.source = self.path.read_text(encoding="utf-8")
        self.stamp = self._stamp()

    def _stamp(self):
        try:
            st = self.path.stat()
        except OSError:
            return None  # p. ej. un editor que guarda borrando y renombrando: se vuelve a mirar luego
        return (st.st_mtime_ns, st.st_size)

    def poll(self):
        """Devuelve True si el contenido cambió desde la última vez."""
        stamp = self._stamp()
        if stamp is None or stamp == self.stamp:
            return False
        try:
            source = self.path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            return False  # a medio escribir: se reintenta en la siguiente vuelta
        self.stamp = stamp
        with self.lock:
            if source == self.source:
                return False  # guardado sin cambios
            self.source = source
            self.version += 1
        return True

    def current(self):
        with self.lock:
            return self.version, self.source


def make_live_server(watcher, title, port=0):
    """Servidor de --watch: "/" da la página con el código y la versión actuales (recargar la
    pestaña también funciona) y "/source?v=N" responde 204 si N sigue siendo la versión actual
    o {"version", "source"} en JSON si hay una nueva."""

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            path, _, query = self.path.partition("?")
            if path == "/":
                version, source = watcher.current()
                self.reply(200, "text/html; charset=utf-8", build_html(source, title, {"version": version}))
            elif path == "/source":
                version, source = watcher.current()
                params = dict(p.partition("=")[::2] for p in query.split("&") if p)
                if params.get("v") == str(version):
                    self.reply(204)
                else:
                    data = json.dumps({"version": version, "source": source}, ensure_ascii=False)
                    self.reply(200, "application/json; charset=utf-8", data)
            else:
                self.send_error(404)

        def reply(self, code, content_type=None, text=""):
            body = text.encode("utf-8")
            self.send_response(code)
            self.send_header("Cache-Control", "no-store")
            if content_type:
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body:
                self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    return server


def _interrupt(*_):
    raise KeyboardInterrupt


def watch(path, title, output, open_browser=True):
    """--watch: sirve la página hasta Ctrl+C y vigila el .mmd. El HTML guardado se regenera en
    cada cambio, pero sin recarga en vivo (abierto como archivo no hay servidor al que preguntar)."""
    watcher = SourceWatcher(path)
    server = make_live_server(watcher, title)
    signal.signal(signal.SIGTERM, _interrupt)  # kill cierra igual que Ctrl+C
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    print(f"Recarga en vivo en {url}", flush=True)
    print(f"Vigilando {path}: al guardarlo, la página se actualiza sola. Ctrl+C para salir.", flush=True)
    if open_browser:
        launch_browser(url)
    try:
        while True:
            time.sleep(WATCH_INTERVAL)
            if watcher.poll():
                version, source = watcher.current()
                if output:
                    output.write_text(build_html(source, title), encoding="utf-8")
                print(f"[{time.strftime('%H:%M:%S')}] Cambio detectado (versión {version}).", flush=True)
    except KeyboardInterrupt:
        print("\nServidor detenido.")
    finally:
        server.shutdown()
        server.server_close()


def main():
    parser = argparse.ArgumentParser(description="Genera un diagrama HTML a partir de código Mermaid.")
    parser.add_argument("file", nargs="?", help="archivo .mmd (si se omite, se lee de la terminal)")
    parser.add_argument("-o", "--output", help="ruta del HTML generado")
    parser.add_argument("--no-open", action="store_true", help="no abrir el navegador")
    parser.add_argument(
        "--watch", action="store_true", help="servir hasta Ctrl+C y actualizar la página al guardar el .mmd"
    )
    args = parser.parse_args()
    if args.watch and not args.file:
        parser.error("--watch necesita un archivo .mmd que vigilar (no funciona con la terminal ni con tuberías).")

    try:
        source = read_source(args.file)
    except OSError as err:
        sys.exit(f"No se pudo leer '{args.file}': {err.strerror}")
    if not source.strip():
        sys.exit("El diagrama está vacío.")

    title = Path(args.file).stem if args.file else "diagrama"
    html = build_html(source, title)

    output = Path(args.output) if args.output else (Path(args.file).with_suffix(".html") if args.file else None)
    if output:
        output.write_text(html, encoding="utf-8")
        print(f"HTML generado: {output}")
    elif args.no_open:
        sys.exit("Con --no-open y sin archivo de entrada hace falta -o para guardar el HTML.")

    if args.watch:
        watch(args.file, title, output, open_browser=not args.no_open)
    elif not args.no_open:
        open_in_browser(html)


if __name__ == "__main__":
    main()
