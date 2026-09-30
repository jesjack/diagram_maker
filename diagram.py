#!/usr/bin/env python3
"""Genera un diagrama HTML a partir de código Mermaid (subconjunto flowchart) y lo abre en el navegador.

Uso:
    python3 diagram.py archivo.mmd            # genera archivo.html junto al .mmd y lo abre
    python3 diagram.py archivo.mmd -o x.html  # elige dónde guardar el HTML
    python3 diagram.py                        # escribe el diagrama en la terminal (termina con Ctrl+D)
    cat archivo.mmd | python3 diagram.py      # también por tubería
    python3 diagram.py archivo.mmd --no-open  # solo genera el HTML

El HTML generado es autocontenido: parser, layout y visor van incrustados.
"""

import argparse
import http.server
import json
import re
import shutil
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
SCRIPTS = ["parser.js", "layout.js", "render.js", "viewer.js"]
SERVE_TIMEOUT = 30  # segundos que se espera a que el navegador pida la página


def js_literal(value):
    """JSON seguro para incrustar dentro de <script> (evita cerrar la etiqueta con '</')."""
    return json.dumps(value, ensure_ascii=False).replace("</", "<\\/")


def build_html(source, title):
    template = (SRC / "template.html").read_text(encoding="utf-8")
    scripts = "\n".join((SRC / name).read_text(encoding="utf-8") for name in SCRIPTS)
    values = {
        "__DIAGRAM_SOURCE__": js_literal(source),
        "__DIAGRAM_TITLE__": js_literal(title),
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


def main():
    parser = argparse.ArgumentParser(description="Genera un diagrama HTML a partir de código Mermaid.")
    parser.add_argument("file", nargs="?", help="archivo .mmd (si se omite, se lee de la terminal)")
    parser.add_argument("-o", "--output", help="ruta del HTML generado")
    parser.add_argument("--no-open", action="store_true", help="no abrir el navegador")
    args = parser.parse_args()

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

    if not args.no_open:
        open_in_browser(html)


if __name__ == "__main__":
    main()
