"""Tests de la recarga en vivo (diagram.py --watch): vigilante del .mmd, servidor y CLI.

Ejecutar: python3 -m unittest discover tests
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import diagram  # noqa: E402

UNO = 'flowchart TD\n  a["Uno"] --> b["Dos"]\n'
DOS = 'flowchart TD\n  a["Uno"] --> b["Dos"] --> c["Tres"]\n'


def get(url):
    """(código, cuerpo) sin lanzar excepción con 204/404."""
    try:
        with urllib.request.urlopen(url, timeout=5) as res:
            return res.status, res.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        err.close()
        return err.code, ""


def write(path, text):
    path.write_text(text, encoding="utf-8")
    # Algunos sistemas de archivos tienen mtime de grano grueso: se fuerza uno distinto.
    st = path.stat()
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))


class WatcherTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "d.mmd"
        self.path.write_text(UNO, encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def test_sube_la_version_solo_si_cambia_el_contenido(self):
        w = diagram.SourceWatcher(self.path)
        self.assertEqual(w.current(), (1, UNO))
        self.assertFalse(w.poll())
        write(self.path, UNO)  # guardado sin cambios
        self.assertFalse(w.poll())
        write(self.path, DOS)
        self.assertTrue(w.poll())
        self.assertEqual(w.current(), (2, DOS))

    def test_archivo_borrado_un_momento_no_rompe(self):
        w = diagram.SourceWatcher(self.path)
        self.path.unlink()
        self.assertFalse(w.poll())
        write(self.path, DOS)
        self.assertTrue(w.poll())


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "d.mmd"
        self.path.write_text(UNO, encoding="utf-8")
        self.watcher = diagram.SourceWatcher(self.path)
        self.server = diagram.make_live_server(self.watcher, "d")
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.dir.cleanup()

    def test_pagina_con_recarga_en_vivo(self):
        code, html = get(self.url)
        self.assertEqual(code, 200)
        self.assertIn('live: {"version": 1}', html)
        self.assertIn("Uno", html)

    def test_source_204_si_no_hay_cambios_y_json_si_los_hay(self):
        self.assertEqual(get(self.url + "source?v=1")[0], 204)
        write(self.path, DOS)
        self.assertTrue(self.watcher.poll())
        code, body = get(self.url + "source?v=1")
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body), {"version": 2, "source": DOS})
        self.assertEqual(get(self.url + "source?v=2")[0], 204)
        # Recargar la pestaña da ya el código nuevo.
        self.assertIn('live: {"version": 2}', get(self.url)[1])

    def test_ruta_desconocida(self):
        self.assertEqual(get(self.url + "otra")[0], 404)


class CliTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "d.mmd"
        self.path.write_text(UNO, encoding="utf-8")

    def tearDown(self):
        self.dir.cleanup()

    def run_cli(self, *args, **kw):
        return subprocess.run(
            [sys.executable, str(ROOT / "diagram.py"), *args], capture_output=True, text=True, timeout=20, **kw
        )

    def test_sin_watch_el_html_no_tiene_recarga_en_vivo(self):
        res = self.run_cli(str(self.path), "--no-open")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("live: null,", self.path.with_suffix(".html").read_text(encoding="utf-8"))

    def test_watch_sin_archivo_da_error(self):
        res = self.run_cli("--watch", input=UNO)
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("--watch necesita un archivo", res.stderr)

    def test_watch_de_principio_a_fin(self):
        proc = subprocess.Popen(
            [sys.executable, str(ROOT / "diagram.py"), str(self.path), "--watch", "--no-open"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            url = None
            deadline = time.monotonic() + 10
            while url is None and time.monotonic() < deadline:
                line = proc.stdout.readline()
                m = re.search(r"http://127\.0\.0\.1:\d+/", line)
                if m:
                    url = m.group(0)
            self.assertIsNotNone(url, "no se mostró la URL")
            self.assertEqual(get(url + "source?v=1")[0], 204)
            write(self.path, DOS)
            deadline = time.monotonic() + 5
            code = 204
            while code == 204 and time.monotonic() < deadline:
                time.sleep(0.2)
                code, body = get(url + "source?v=1")
            self.assertEqual(code, 200)
            self.assertEqual(json.loads(body)["source"], DOS)
            # El HTML guardado también se regenera (sin recarga en vivo).
            saved = self.path.with_suffix(".html").read_text(encoding="utf-8")
            self.assertIn("Tres", saved)
            self.assertIn("live: null,", saved)
        finally:
            proc.terminate()  # SIGTERM: cierra igual que Ctrl+C
            out, _ = proc.communicate(timeout=5)
        self.assertEqual(proc.returncode, 0)
        self.assertIn("Servidor detenido", out)


if __name__ == "__main__":
    unittest.main()
