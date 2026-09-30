// Visor: monta el diagrama en la página, zoom con la rueda, arrastre, gestos táctiles y exportación.

const DiagramViewer = (() => {
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 8;

  function start({ source, title }) {
    const stage = document.getElementById("stage");
    const canvas = document.getElementById("canvas");
    const status = document.getElementById("status");
    document.title = title;

    let svgText;
    let result;
    try {
      const graph = parseDiagram(source);
      result = layoutDiagram(graph, { measure: makeMeasure() });
      svgText = renderSvg(result);
    } catch (err) {
      showError(err, source);
      return;
    }
    canvas.innerHTML = svgText;
    const svg = canvas.querySelector("svg");
    const size = { w: parseFloat(svg.getAttribute("width")), h: parseFloat(svg.getAttribute("height")) };
    showWarnings(result.warnings);

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

    stage.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
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
      else stage.classList.remove("dragging");
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
    document.getElementById("btn-fit").onclick = fit;
    document.getElementById("btn-zoom-in").onclick = () => zoomAt(1.2, ...center());
    document.getElementById("btn-zoom-out").onclick = () => zoomAt(1 / 1.2, ...center());
    document.getElementById("btn-svg").onclick = () =>
      download(new Blob([svgText], { type: "image/svg+xml" }), `${title}.svg`);
    document.getElementById("btn-png").onclick = () => exportPng(svgText, size, title);

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
    fit();
  }

  // Mide texto con la misma fuente que usa el SVG.
  function makeMeasure() {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${LAYOUT_DEFAULTS.fontSize}px ${LAYOUT_DEFAULTS.fontFamily}`;
    return (text) => ctx.measureText(text).width;
  }

  function exportPng(svgText, size, title, scale = 2) {
    const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = Math.ceil(size.w * scale);
      c.height = Math.ceil(size.h * scale);
      const ctx = c.getContext("2d");
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

  function showWarnings(warnings) {
    if (!warnings.length) return;
    const box = document.getElementById("warnings");
    box.hidden = false;
    box.textContent = warnings.map((w) => (w.line ? `Línea ${w.line}: ${w.message}` : w.message)).join("\n");
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  return { start };
})();
