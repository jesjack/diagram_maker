// Visor: monta el diagrama en la página, zoom con la rueda, arrastre, gestos táctiles y exportación.
// Con `live` (diagram.py --watch) pide al servidor el código nuevo cuando cambia el .mmd y vuelve
// a dibujar sin recargar la pestaña.

const DiagramViewer = (() => {
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 8;

  function start({ source: initialSource, title, live }) {
    const stage = document.getElementById("stage");
    const canvas = document.getElementById("canvas");
    const status = document.getElementById("status");
    document.title = title;

    // Estado del diagrama montado; mount() lo reemplaza entero cuando llega código nuevo.
    // Si el código tiene un error, result queda en null y los controles no hacen nada.
    let source = initialSource;
    let result = null;
    let svg = null;
    let size = null;
    let generation = 0; // para descartar la sombra de un montaje anterior que llegue tarde

    // ---- vista: translate(tx, ty) scale(s) con origen arriba a la izquierda
    const view = { s: 1, tx: 0, ty: 0 };
    const apply = () => {
      canvas.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`;
      // La cuadrícula de puntos del fondo se mueve y escala con el diagrama.
      const grid = 24 * view.s;
      stage.style.backgroundSize = `${grid}px ${grid}px`;
      stage.style.backgroundPosition = `${view.tx}px ${view.ty}px`;
      status.textContent = `${Math.round(view.s * 100)}%`;
    };
    const fit = () => {
      if (!size) return;
      const r = stage.getBoundingClientRect();
      view.s = Math.min(r.width / size.w, r.height / size.h, 1);
      view.tx = (r.width - size.w * view.s) / 2;
      view.ty = (r.height - size.h * view.s) / 2;
      apply();
    };
    const zoomAt = (factor, cx, cy) => {
      const s = clamp(view.s * factor, MIN_SCALE, MAX_SCALE);
      const f = s / view.s;
      view.tx = cx - (cx - view.tx) * f;
      view.ty = cy - (cy - view.ty) * f;
      view.s = s;
      apply();
    };
    const center = () => {
      const r = stage.getBoundingClientRect();
      return [r.width / 2, r.height / 2];
    };

    // Mientras hay un gesto en curso el diagrama se sube a su propia capa (will-change) y el
    // navegador solo mueve/escala esa imagen, sin volver a pintar el SVG (y sus sombras) en
    // cada fotograma. Al terminar se quita para que se vuelva a pintar nítido a la escala final.
    let motionTimer = 0;
    const beginMotion = () => {
      clearTimeout(motionTimer);
      canvas.style.willChange = "transform";
    };
    const endMotion = () => {
      clearTimeout(motionTimer);
      motionTimer = setTimeout(() => (canvas.style.willChange = ""), 150);
    };

    stage.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        beginMotion();
        endMotion();
        const r = stage.getBoundingClientRect();
        // deltaMode 1 = líneas (algunos ratones); se normaliza a píxeles.
        const delta = ev.deltaY * (ev.deltaMode === 1 ? 16 : 1);
        zoomAt(Math.exp(-delta * 0.0015), ev.clientX - r.left, ev.clientY - r.top);
      },
      { passive: false }
    );

    // ---- gestos: un dedo (o ratón) arrastra; dos dedos hacen zoom y arrastran a la vez.
    // Se usa el centro y la separación de los dos primeros punteros: en cada movimiento el
    // diagrama se desplaza lo que se movió el centro y se escala lo que cambió la separación.
    const pointers = new Map();
    let gesture = null; // { x, y, d } del último movimiento
    let lastTap = { time: 0, x: 0, y: 0 };
    let tapStart = null;
    const snapshot = () => {
      const pts = [...pointers.values()].slice(0, 2);
      const r = stage.getBoundingClientRect();
      const x = pts.reduce((acc, p) => acc + p.x, 0) / pts.length - r.left;
      const y = pts.reduce((acc, p) => acc + p.y, 0) / pts.length - r.top;
      const d = pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1 : 0;
      return { x, y, d };
    };
    stage.addEventListener("pointerdown", (ev) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      stage.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      stage.classList.add("dragging");
      beginMotion();
      gesture = snapshot();
      tapStart = pointers.size === 1 ? { x: ev.clientX, y: ev.clientY, time: ev.timeStamp } : null;
    });
    stage.addEventListener("pointermove", (ev) => {
      if (!pointers.has(ev.pointerId)) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const g = snapshot();
      view.tx += g.x - gesture.x;
      view.ty += g.y - gesture.y;
      if (g.d && gesture.d) zoomAt(g.d / gesture.d, g.x, g.y);
      else apply();
      gesture = g;
    });
    const release = (ev) => {
      if (!pointers.delete(ev.pointerId)) return;
      if (pointers.size) gesture = snapshot();
      else {
        stage.classList.remove("dragging");
        endMotion();
      }
      // Doble toque (táctil) = ajustar; en ratón ya lo cubre dblclick.
      if (ev.type === "pointerup" && ev.pointerType !== "mouse" && tapStart && !pointers.size) {
        const moved = Math.hypot(ev.clientX - tapStart.x, ev.clientY - tapStart.y);
        const quick = ev.timeStamp - tapStart.time < 300;
        if (moved < 10 && quick) {
          const near = Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 40;
          if (ev.timeStamp - lastTap.time < 350 && near) {
            fit();
            lastTap.time = 0;
          } else {
            lastTap = { time: ev.timeStamp, x: ev.clientX, y: ev.clientY };
          }
        }
      }
      if (!pointers.size) tapStart = null;
    };
    stage.addEventListener("pointerup", release);
    stage.addEventListener("pointercancel", release);
    stage.addEventListener("dblclick", fit);

    // ---- teclado y botones
    window.addEventListener("keydown", (ev) => {
      if (ev.key === "0") fit();
      else if (ev.key === "+" || ev.key === "=") zoomAt(1.2, ...center());
      else if (ev.key === "-") zoomAt(1 / 1.2, ...center());
    });
    // Botón «Mermaid» solo si el HTML lleva la librería incrustada (no con dmk --ligero).
    const btnMermaid = document.getElementById("btn-mermaid");
    if (mermaidLib()) btnMermaid.onclick = () => openInMermaid(source, title);
    else btnMermaid.hidden = true;
    // ---- depuración: ver cómo se construye el diagrama, nodo a nodo, en el orden en que el layout
    // los colocó (n.step) y con el motivo (n.why). Una flecha aparece cuando sus dos extremos están.
    let order = [];
    let total = 0;
    let shown = 0;
    const stepLabel = document.getElementById("step-label");
    const stepWhy = document.getElementById("step-why");
    const shadowCanvas = () => canvas.querySelector("canvas.shadow");
    // En un paso intermedio se dibuja el diagrama tal como estaba al terminar ese paso
    // (result.snapshotAt): las inserciones de filas/columnas y los nodos movidos aparecen en el
    // paso que los provocó. Para que el dibujo no salte, el primer nodo se mantiene fijo en pantalla.
    let shownSvg = null;
    let shownLayout = null;
    let anchorId = null;
    const localPos = (layout, el, id) => {
      const n = layout.nodes.find((x) => x.id === id);
      const vb = el.viewBox.baseVal;
      return n && { x: n.x - vb.x, y: n.y - vb.y };
    };
    const showLayout = (layout, el) => {
      const before = localPos(shownLayout, shownSvg, anchorId);
      if (el !== shownSvg) shownSvg.replaceWith(el);
      const after = localPos(layout, el, anchorId);
      if (before && after) {
        view.tx += (before.x - after.x) * view.s;
        view.ty += (before.y - after.y) * view.s;
        apply();
      }
      shownSvg = el;
      shownLayout = layout;
    };
    const showStep = (k) => {
      if (!result) return;
      shown = Math.max(1, Math.min(total, k));
      const all = shown === total;
      const current = all ? null : order[shown - 1];
      if (all) showLayout(result, svg);
      else {
        const snap = result.snapshotAt(shown - 1);
        const tmp = document.createElement("div");
        tmp.innerHTML = renderSvg(snap, THEME, { shadow: false, ids: true });
        showLayout(snap, tmp.firstElementChild);
        const el = shownSvg.querySelector(`g.node[data-id="${CSS.escape(current.id)}"], g.junction[data-id="${CSS.escape(current.id)}"]`);
        if (el) el.classList.add("step-current");
      }
      const sh = shadowCanvas();
      if (sh) sh.style.display = all ? "" : "none"; // la sombra es la del diagrama final
      stepLabel.textContent = `${shown} / ${total}`;
      stepWhy.textContent = current ? `${current.realId || current.junctionOf || current.id}: ${current.why}` : "";
      if (current) keepVisible(shownLayout.nodes.find((n) => n.id === current.id) || current);
    };
    const keepVisible = (n) => {
      const vb = shownSvg.viewBox.baseVal;
      const r = stage.getBoundingClientRect();
      const sx = view.tx + (n.x - vb.x) * view.s;
      const sy = view.ty + (n.y - vb.y) * view.s;
      if (sx < 40 || sx > r.width - 40 || sy < 120 || sy > r.height - 60) {
        view.tx = r.width / 2 - (n.x - vb.x) * view.s;
        view.ty = r.height / 2 - (n.y - vb.y) * view.s;
        apply();
      }
    };
    document.getElementById("btn-step-prev").onclick = () => showStep(shown - 1);
    document.getElementById("btn-step-next").onclick = () => showStep(shown + 1);
    window.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowLeft") showStep(shown - 1);
      else if (ev.key === "ArrowRight") showStep(shown + 1);
      else if (ev.key === "Home") showStep(1);
      else if (ev.key === "End") showStep(total);
    });

    // ---- tocar la pastilla de un empalme (o conector) lleva, con una animación, hasta su nodo
    // dueño, que parpadea. Si hay copias de ese nodo, va al original. Un arrastre no cuenta.
    let downAt = null;
    // El elemento tocado se guarda al apoyar el dedo: el arrastre captura el puntero y el click
    // posterior llega al lienzo, no a la pastilla.
    stage.addEventListener("pointerdown", (ev) => (downAt = { x: ev.clientX, y: ev.clientY, target: ev.target }), true);
    stage.addEventListener("click", (ev) => {
      if (downAt && Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 6) return;
      const t = downAt && downAt.target;
      const pill = t && t.closest && t.closest("g.junction");
      if (!pill || !shownLayout) return;
      const j = shownLayout.nodes.find((n) => n.id === pill.dataset.id);
      if (!j) return;
      const owner = j.junctionOf;
      const candidates = shownLayout.nodes.filter((n) => n.shape !== "junction" && (n.realId || n.id) === owner);
      const target = candidates.find((n) => n.id === owner) || candidates.find((n) => !n.copyOf) || candidates[0];
      if (target) flyTo(target);
    });
    let flight = 0;
    const flyTo = (n) => {
      const vb = shownSvg.viewBox.baseVal;
      const r = stage.getBoundingClientRect();
      const from = { tx: view.tx, ty: view.ty };
      const to = { tx: r.width / 2 - (n.x - vb.x) * view.s, ty: r.height / 2 - (n.y - vb.y) * view.s };
      const start = performance.now();
      const id = ++flight;
      const frame = (now) => {
        if (id !== flight) return; // otro toque empezó otra animación
        const t = Math.min(1, (now - start) / 450);
        const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // suave al salir y al llegar
        view.tx = from.tx + (to.tx - from.tx) * k;
        view.ty = from.ty + (to.ty - from.ty) * k;
        apply();
        if (t < 1) requestAnimationFrame(frame);
        else flash(n.id);
      };
      requestAnimationFrame(frame);
    };
    const flash = (id) => {
      const el = shownSvg.querySelector(`g.node[data-id="${CSS.escape(id)}"]`);
      if (!el) return;
      el.classList.remove("flash");
      void el.getBoundingClientRect(); // reinicia la animación si ya estaba
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1300);
    };

    // Lo exportado sale como se ve (pastillas incluidas: los empalmes se refieren a los nodos por su
    // id), con la sombra difuminada real dentro del SVG.
    const exportSvg = () => renderSvg(result, THEME, { ids: true });
    document.getElementById("btn-svg").onclick = () =>
      result && download(new Blob([exportSvg()], { type: "image/svg+xml" }), `${title}.svg`);
    document.getElementById("btn-png").onclick = () => result && exportPng(exportSvg(), size, title);

    // En móvil "resize" salta cada vez que aparece o se oculta la barra del navegador:
    // se conserva el punto que estaba en el centro en lugar de volver a ajustar.
    let stageSize = stage.getBoundingClientRect();
    window.addEventListener("resize", () => {
      const r = stage.getBoundingClientRect();
      view.tx += (r.width - stageSize.width) / 2;
      view.ty += (r.height - stageSize.height) / 2;
      stageSize = r;
      apply();
    });

    // ---- montar (o volver a montar) el diagrama a partir de su código.
    // Al volver a montar se conserva la vista (zoom y desplazamiento) sin re-ajustar; para que el
    // dibujo no salte si el diagrama crece por arriba o por la izquierda, el primer nodo colocado
    // se mantiene en el mismo punto de la pantalla (como en el paso a paso). Si se estaba en un
    // paso intermedio se vuelve al diagrama completo: con otro código los pasos ya no son los
    // mismos (cambian el orden y el número de nodos) y conservar el número confundiría.
    let fitted = false;
    const mount = (src) => {
      source = src;
      let next;
      try {
        const graph = parseDiagram(src);
        next = DiagramLayout.layoutDiagram(graph, { measure: makeMeasure() });
      } catch (err) {
        result = null;
        showError(err, src);
        return;
      }
      hideError();
      const nextOrder = [...next.nodes].sort((a, b) => a.step - b.step);
      const nextAnchor = nextOrder[0] && nextOrder[0].id;
      const before = shownSvg && shownSvg.isConnected ? localPos(shownLayout, shownSvg, nextAnchor) : null;

      result = next;
      generation++;
      canvas.innerHTML = renderSvg(result, THEME, { shadow: false, ids: true });
      svg = canvas.querySelector("svg");
      size = { w: parseFloat(svg.getAttribute("width")), h: parseFloat(svg.getAttribute("height")) };
      if (THEME.shadow) {
        const gen = generation;
        paintShadow(renderShadowSvg(result), size, canvas, () => gen === generation);
      }
      showWarnings(result.warnings);

      order = nextOrder;
      total = order.length;
      anchorId = nextAnchor;
      shownSvg = svg;
      shownLayout = result;
      const after = before && localPos(result, svg, anchorId);
      if (after) {
        view.tx += (before.x - after.x) * view.s;
        view.ty += (before.y - after.y) * view.s;
      }
      showStep(total);
      if (!fitted) fit();
      else apply();
      fitted = true;
    };
    mount(initialSource);
    if (live) watchSource(live.version, mount);
  }

  // ---- recarga en vivo: se pregunta al servidor cada segundo si hay una versión nueva del código
  // (GET /source?v=N responde 204 si sigue igual, o {version, source} si cambió). Es un sondeo
  // corto y no SSE ni una petición larga porque es lo más robusto en móvil: si el navegador
  // congela la pestaña en segundo plano o el servidor se reinicia, la siguiente petición sin más
  // vuelve a funcionar. Con la pestaña oculta no se pregunta; al volver se pregunta enseguida.
  function watchSource(version, onChange) {
    const badge = document.getElementById("live");
    const POLL_MS = 1000;
    let timer = 0;
    let busy = false;
    const setOnline = (ok) => {
      badge.hidden = false;
      badge.classList.toggle("off", !ok);
      badge.textContent = ok ? "● en vivo" : "○ sin conexión";
      badge.title = ok
        ? "Recarga en vivo: el diagrama se actualiza al guardar el .mmd"
        : "No se puede contactar con diagram.py --watch; se sigue intentando";
    };
    const check = async () => {
      clearTimeout(timer);
      if (busy) return;
      busy = true;
      try {
        const res = await fetch(`source?v=${version}`, { cache: "no-store" });
        if (res.status === 200) {
          const data = await res.json();
          version = data.version;
          onChange(data.source);
        } else if (res.status !== 204) throw new Error(`HTTP ${res.status}`);
        setOnline(true);
      } catch (err) {
        setOnline(false);
      } finally {
        busy = false;
        if (!document.hidden) timer = setTimeout(check, POLL_MS);
      }
    };
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) check();
      else clearTimeout(timer);
    });
    setOnline(true);
    check();
  }

  // Pinta la sombra una sola vez en un <canvas> debajo del SVG (ver renderShadowSvg en render.js).
  // Resolución: hasta 3 px por unidad, limitada a ~6 Mpx para no gastar memoria en diagramas grandes.
  // isCurrent: si ya se montó otro diagrama cuando la imagen termina de cargar, no se añade.
  function paintShadow(shadowSvg, size, parent, isCurrent = () => true) {
    const k = Math.min(3, Math.sqrt(6e6 / (size.w * size.h)));
    const c = document.createElement("canvas");
    c.className = "shadow";
    c.width = Math.ceil(size.w * k);
    c.height = Math.ceil(size.h * k);
    c.style.width = `${size.w}px`;
    c.style.height = `${size.h}px`;
    const url = URL.createObjectURL(new Blob([shadowSvg], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      if (isCurrent()) parent.prepend(c);
    };
    img.src = url;
  }

  // Mermaid oficial incrustado en el HTML (gzip + base64), o "" si no va (dmk --ligero).
  const mermaidLib = () => (document.getElementById("mermaid-lib")?.textContent || "").trim();

  // Abre el mismo código en una pestaña nueva dibujado con Mermaid oficial, para comparar, con la
  // librería incrustada (sin internet). La pestaña se abre al momento (si se abre después de
  // descomprimir, el navegador la bloquea como ventana emergente) y recibe la página cuando la
  // librería está lista. Ahí funciona el zoom normal del navegador.
  async function openInMermaid(source, title) {
    const tab = window.open("", "_blank");
    const esc = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    let libUrl;
    try {
      const bytes = Uint8Array.from(atob(mermaidLib()), (c) => c.charCodeAt(0));
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      libUrl = URL.createObjectURL(new Blob([await new Response(stream).text()], { type: "text/javascript" }));
    } catch (err) {
      if (tab) tab.close();
      alert("No se pudo preparar Mermaid en este navegador: " + err.message);
      return;
    }
    const page = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Mermaid</title>
<style>
  body { margin: 0; padding: 16px; background: #f4f5f7; color: #1f2328; font: 14px system-ui, sans-serif; }
  .mermaid svg { max-width: none !important; height: auto; }
  #msg { color: #656d76; }
</style></head><body>
<p id="msg">Mermaid oficial · dibujando…</p>
<pre class="mermaid">${esc(source)}</pre>
<script src="${libUrl}"><\/script>
<script>
  const msg = document.getElementById("msg");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
  mermaid.run().then(
    () => (msg.textContent = "Mermaid oficial"),
    (err) => (msg.textContent = "Mermaid no pudo dibujar el diagrama: " + err.message)
  );
<\/script></body></html>`; // <\/script: si no, cerraría el <script> del HTML generado
    const url = URL.createObjectURL(new Blob([page], { type: "text/html" }));
    if (tab) tab.location.href = url;
    else window.open(url, "_blank");
    setTimeout(() => {
      URL.revokeObjectURL(url);
      URL.revokeObjectURL(libUrl);
    }, 120000);
  }

  // Mide texto con la fuente con la que se va a pintar (la del nodo si su estilo la cambia).
  function makeMeasure() {
    const ctx = document.createElement("canvas").getContext("2d");
    const base = `${DiagramLayout.LAYOUT_DEFAULTS.fontSize}px ${DiagramLayout.LAYOUT_DEFAULTS.fontFamily}`;
    return (text, font) => {
      ctx.font = base; // si la fuente del nodo no es válida, el canvas la ignora: que no herede la anterior
      if (font) ctx.font = `${font.style} ${font.weight} ${font.size}px ${font.family}`;
      return ctx.measureText(text).width;
    };
  }

  function exportPng(svgText, size, title, scale = 2) {
    const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.ceil(size.w * scale);
      c.height = Math.ceil(size.h * scale);
      const ctx = c.getContext("2d");
      // El SVG no tiene fondo; en el PNG se pinta blanco para que se lea en cualquier visor
      // (muchas galerías muestran lo transparente en negro).
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, size.w, size.h);
      URL.revokeObjectURL(url);
      c.toBlob((blob) => download(blob, `${title}.png`), "image/png");
    };
    img.src = url;
  }

  function download(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function showError(err, source) {
    const panel = document.getElementById("error");
    panel.hidden = false;
    panel.querySelector(".message").textContent = err.message;
    const pre = panel.querySelector(".source");
    pre.textContent = ""; // con recarga en vivo el panel puede mostrarse varias veces
    source.split(/\r?\n/).forEach((text, i) => {
      const row = document.createElement("div");
      row.className = i + 1 === err.line ? "line bad" : "line";
      row.dataset.n = i + 1;
      row.textContent = text || " ";
      pre.appendChild(row);
    });
    pre.querySelector(".bad")?.scrollIntoView({ block: "center" });
    if (!(err instanceof DiagramError)) console.error(err);
  }

  function hideError() {
    document.getElementById("error").hidden = true;
  }

  function showWarnings(warnings) {
    const box = document.getElementById("warnings");
    box.hidden = !warnings.length;
    if (!warnings.length) return;
    box.textContent = warnings.map((w) => (w.line ? `Línea ${w.line}: ${w.message}` : w.message)).join("\n");
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  return { start };
})();
