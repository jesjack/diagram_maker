// Layout: tamaño de los nodos según su texto (partir en líneas, fuentes, estilos de texto).

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LayoutText = factory();
})(typeof self !== "undefined" ? self : this, function () {
function wrapText(text, maxWidth, measure) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && measure(candidate) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

// ---------------------------------------------------------------- fuentes

const baseFont = (opts) => ({ size: opts.fontSize, family: opts.fontFamily, weight: "normal", style: "normal", bold: false });

// Tamaño en px de un valor CSS de font-size (px, pt, em, rem, %); null si no se entiende.
function fontSizePx(value, base) {
  const m = String(value).trim().match(/^(\d*\.?\d+)\s*(px|pt|em|rem|%)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return { px: n, "": n, pt: (n * 4) / 3, em: n * base, rem: n * base, "%": (n * base) / 100 }[m[2] || ""];
}

// Medidas de texto según el css de un nodo o arista: el layout tiene que medir con la misma
// fuente con la que se pinta, o el texto no cabe en la forma.
function textMetrics(css, measure, opts) {
  const font = baseFont(opts);
  let spacing = 0;
  for (const [k, v] of css || []) {
    if (k === "font-size") font.size = fontSizePx(v, opts.fontSize) || font.size;
    else if (k === "font-family") font.family = v;
    else if (k === "font-weight") font.weight = v;
    else if (k === "font-style") font.style = v;
    else if (k === "letter-spacing") spacing = fontSizePx(v, font.size) || 0;
  }
  font.bold = /bold|^[6-9]00$/.test(font.weight);
  const k = font.size / opts.fontSize;
  return {
    font,
    scale: k,
    lineHeight: opts.lineHeight * k,
    measure: (text) => measure(text, font) + spacing * text.length,
  };
}

function sizeNode(node, rawMeasure, opts) {
  const tm = textMetrics(node.css, rawMeasure, opts);
  const measure = tm.measure;
  const lines = wrapText(node.text, opts.wrapWidth[node.shape] * tm.scale, measure);
  const tw = Math.max(...lines.map((l) => measure(l)), 0);
  const th = lines.length * tm.lineHeight;
  let w;
  let h;
  switch (node.shape) {
    case "circle": {
      const d = Math.max(Math.hypot(tw, th) + 16, 60);
      w = h = d;
      break;
    }
    case "diamond":
      // El rectángulo del texto debe caber dentro del rombo: tw/w + th/h <= 1
      w = Math.max(tw * 1.7 + 20, 80);
      h = Math.max(th * 2.4 + 16, 60);
      break;
    case "cylinder": {
      w = Math.max(tw + 32, 80);
      const ry = w * 0.12;
      h = Math.max(th + 20, 40) + 2 * ry;
      break;
    }
    case "stadium":
      // Los extremos son semicírculos: se deja medio alto a cada lado para que el texto no toque la curva.
      h = Math.max(th + 20, 40);
      w = Math.max(tw + h * 0.8 + 16, 90);
      break;
    case "hexagon":
    case "parallelogram":
    case "parallelogram-alt": {
      // skew: desplazamiento horizontal de los lados inclinados (lo usa también render.js). En el
      // hexágono son las puntas laterales; el texto cabe igual que en el paralelogramo.
      h = Math.max(th + 20, 40);
      const skew = h * 0.35;
      w = Math.max(tw + 32 + skew, 90);
      return { lines, w, h, skew, lineHeight: tm.lineHeight };
    }
    case "subroutine": // rectángulo con una franja a cada lado: 10 px más por lado
      w = Math.max(tw + 52, 110);
      h = Math.max(th + 20, 40);
      break;
    default:
      w = Math.max(tw + 32, 90);
      h = Math.max(th + 20, 40);
  }
  return { lines, w, h, lineHeight: tm.lineHeight };
}

return { wrapText, baseFont, textMetrics, sizeNode };
});
