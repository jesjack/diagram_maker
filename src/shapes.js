// Formas extra de Mermaid (asimétrica, trapecios y las de `id@{ shape: … }`): tamaño según el
// texto, contorno SVG y por dónde entran las flechas. Las formas clásicas (rect, rombo, círculo…)
// siguen en text.js y render.js.

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Shapes = factory();
})(typeof self !== "undefined" ? self : this, function () {
const fmt = (n) => Number(n.toFixed(2));
const poly = (pts, style) => `<polygon points="${pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ")}" ${style}/>`;
const path = (d, style) => `<path d="${d.replace(/-?\d+\.\d+/g, (v) => fmt(Number(v)))}" ${style}/>`;
const rect = (b, style) => `<rect x="${fmt(b.l)}" y="${fmt(b.t)}" width="${fmt(b.w)}" height="${fmt(b.h)}" rx="2" ${style}/>`;
const circle = (b, r, style) => `<circle cx="${fmt(b.x)}" cy="${fmt(b.y)}" r="${fmt(r)}" ${style}/>`;

// Caja normal para el texto (la misma que el rectángulo).
const baseW = (tw) => Math.max(tw + 32, 90);
const baseH = (th) => Math.max(th + 20, 40);
const fixed = (w, h, extra = {}) => () => ({ w, h, noText: true, ...extra });

// Contorno de documento: ola en el borde inferior (a = altura de la ola).
const docPath = (b, a, style) =>
  path(`M${b.l},${b.t} H${b.r} V${b.b - a} C${b.r - b.w * 0.25},${b.b - 3 * a} ${b.l + b.w * 0.25},${b.b + a} ${b.l},${b.b - a} Z`, style);
const docSize = (tw, th) => {
  const h0 = baseH(th);
  const a = h0 * 0.1;
  return { w: baseW(tw), h: h0 + 2 * a, wave: a, textDy: -a, inset: { b: a } };
};
// Tres copias desplazadas (pila de documentos o de procesos); la de delante, abajo a la izquierda.
const STACK = 5;
const stacked = (size, draw) => ({
  size: (tw, th) => {
    const s = size(tw, th);
    return { ...s, w: s.w + 2 * STACK, h: s.h + 2 * STACK, textDx: -STACK, textDy: (s.textDy || 0) + STACK };
  },
  draw: (b, st, n) => {
    const out = [];
    for (let i = 2; i >= 0; i--) {
      const l = b.l + i * STACK;
      const t = b.t + (2 - i) * STACK;
      const w = b.w - 2 * STACK;
      const h = b.h - 2 * STACK;
      out.push(draw({ l, t, r: l + w, b: t + h, w, h, x: l + w / 2, y: t + h / 2, hw: w / 2, hh: h / 2 }, st, n));
    }
    return out.join("");
  },
});
// Llave de comentario: la punta mira hacia fuera (dir -1 a la izquierda, 1 a la derecha).
const brace = (b, x, dir, style) => {
  const k = 10;
  const m = x - dir * (k / 2);
  const e = x - dir * k;
  return path(
    `M${e},${b.t} Q${m},${b.t} ${m},${b.t + k / 2} V${b.y - k / 2} Q${m},${b.y} ${x},${b.y} ` +
      `Q${m},${b.y} ${m},${b.y + k / 2} V${b.b - k / 2} Q${m},${b.b} ${e},${b.b}`,
    style,
  );
};
const slanted = (tw, th) => {
  const h = baseH(th);
  const k = h * 0.35;
  return { w: Math.max(tw + 32 + k * 1.4, 90), h, skew: k, inset: { l: k / 2, r: k / 2 } };
};
const triangle = (up) => (tw, th) => {
  // El texto va en la mitad ancha: a esa altura el triángulo mide al menos tw + 24.
  const h = Math.max(2 * (th + 12), 50);
  const w = Math.max(2 * (tw + 12), 60);
  const dy = h / 2 - 8 - th / 2;
  return { w, h, textDy: up ? dy : -dy, inset: { l: w / 4, r: w / 4 } };
};

const SHAPES = {
  // >texto] : bandera con la muesca hacia dentro en el lado izquierdo.
  asymmetric: {
    size: (tw, th) => {
      const h = baseH(th);
      const k = h * 0.35;
      return { w: Math.max(tw + 32 + k, 90), h, skew: k, textDx: k / 2, inset: { l: k } };
    },
    draw: (b, st, n) => poly([[b.l, b.t], [b.r, b.t], [b.r, b.b], [b.l, b.b], [b.l + n.skew, b.y]], st.style),
  },
  // [/texto\] : trapecio ancho abajo; [\texto/] : ancho arriba.
  "trap-b": { size: slanted, draw: (b, st, n) => poly([[b.l + n.skew, b.t], [b.r - n.skew, b.t], [b.r, b.b], [b.l, b.b]], st.style) },
  "trap-t": { size: slanted, draw: (b, st, n) => poly([[b.l, b.t], [b.r, b.t], [b.r - n.skew, b.b], [b.l + n.skew, b.b]], st.style) },
  "dbl-circ": {
    circle: true,
    size: (tw, th) => {
      const d = Math.max(Math.hypot(tw, th) + 26, 70);
      return { w: d, h: d };
    },
    draw: (b, st) => circle(b, b.hw, st.style) + circle(b, b.hw - 5, st.arc),
  },
  text: {
    size: (tw, th) => ({ w: tw + 16, h: Math.max(th + 8, 24) }),
    draw: (b) => `<rect x="${fmt(b.l)}" y="${fmt(b.t)}" width="${fmt(b.w)}" height="${fmt(b.h)}" fill="none" stroke="none"/>`,
  },
  "notch-rect": {
    size: (tw, th) => ({ w: baseW(tw), h: baseH(th) }),
    draw: (b, st) => poly([[b.l + 12, b.t], [b.r, b.t], [b.r, b.b], [b.l, b.b], [b.l, b.t + 12]], st.style),
  },
  "lin-rect": {
    size: (tw, th) => ({ w: baseW(tw) + 8, h: baseH(th), textDx: 4 }),
    draw: (b, st) => rect(b, st.style) + path(`M${b.l + 8},${b.t} V${b.b}`, st.arc),
  },
  "sm-circ": { circle: true, size: fixed(16, 16), draw: (b, st) => circle(b, b.hw, st.style) },
  "f-circ": { circle: true, size: fixed(16, 16), draw: (b, st) => circle(b, b.hw, st.solid) },
  "fr-circ": { circle: true, size: fixed(24, 24), draw: (b, st) => circle(b, b.hw, st.style) + circle(b, b.hw - 5, st.solid) },
  "cross-circ": {
    circle: true,
    size: fixed(30, 30),
    draw: (b, st) => {
      const d = b.hw * Math.SQRT1_2;
      return circle(b, b.hw, st.style) + path(`M${b.x - d},${b.y - d} L${b.x + d},${b.y + d} M${b.x + d},${b.y - d} L${b.x - d},${b.y + d}`, st.arc);
    },
  },
  fork: { size: fixed(80, 10), draw: (b, st) => rect(b, st.solid) },
  hourglass: {
    size: fixed(40, 50, { inset: { l: 20, r: 20 } }),
    draw: (b, st) => poly([[b.l, b.t], [b.r, b.t], [b.x, b.y], [b.l, b.b], [b.r, b.b], [b.x, b.y]], st.style),
  },
  bolt: {
    size: fixed(36, 56),
    draw: (b, st) =>
      poly(
        [[0.55, 0], [0.15, 0.55], [0.47, 0.55], [0.35, 1], [0.85, 0.42], [0.53, 0.42], [0.72, 0]].map(([x, y]) => [b.l + x * b.w, b.t + y * b.h]),
        st.style,
      ),
  },
  brace: { size: (tw, th) => ({ w: baseW(tw), h: baseH(th) }), draw: (b, st) => brace(b, b.l, -1, st.arc) },
  "brace-r": { size: (tw, th) => ({ w: baseW(tw), h: baseH(th) }), draw: (b, st) => brace(b, b.r, 1, st.arc) },
  braces: { size: (tw, th) => ({ w: baseW(tw), h: baseH(th) }), draw: (b, st) => brace(b, b.l, -1, st.arc) + brace(b, b.r, 1, st.arc) },
  doc: { size: docSize, draw: (b, st, n) => docPath(b, n.wave, st.style) },
  "lin-doc": {
    size: (tw, th) => ({ ...docSize(tw, th), w: baseW(tw) + 8, textDx: 4 }),
    draw: (b, st, n) => docPath(b, n.wave, st.style) + path(`M${b.l + 8},${b.t} V${b.b - n.wave}`, st.arc),
  },
  "tag-doc": {
    size: docSize,
    draw: (b, st, n) => docPath(b, n.wave, st.style) + path(`M${b.r - 18},${b.b - n.wave} L${b.r},${b.b - n.wave - 18}`, st.arc),
  },
  docs: stacked(docSize, (b, st, n) => docPath(b, n.wave, st.style)),
  processes: stacked((tw, th) => ({ w: baseW(tw), h: baseH(th) }), (b, st) => rect(b, st.style)),
  "tag-rect": {
    size: (tw, th) => ({ w: baseW(tw), h: baseH(th) }),
    draw: (b, st) => rect(b, st.style) + path(`M${b.r - 16},${b.b} L${b.r},${b.b - 16}`, st.arc),
  },
  delay: {
    size: (tw, th) => {
      const h = baseH(th);
      return { w: Math.max(tw + 32 + h * 0.3, 90), h, textDx: -h * 0.15 };
    },
    draw: (b, st) => path(`M${b.l},${b.t} H${b.r - b.hh} A${b.hh},${b.hh} 0 0 1 ${b.r - b.hh},${b.b} H${b.l} Z`, st.style),
  },
  "h-cyl": {
    size: (tw, th) => {
      const h = baseH(th);
      const rx = h * 0.2;
      return { w: Math.max(tw + 32 + 3 * rx, 90), h, skew: rx, textDx: -rx / 2 };
    },
    draw: (b, st, n) => {
      const rx = n.skew;
      return (
        path(`M${b.l + rx},${b.t} H${b.r - rx} A${rx},${b.hh} 0 0 1 ${b.r - rx},${b.b} H${b.l + rx} A${rx},${b.hh} 0 0 1 ${b.l + rx},${b.t} Z`, st.style) +
        path(`M${b.r - rx},${b.t} A${rx},${b.hh} 0 0 0 ${b.r - rx},${b.b}`, st.arc)
      );
    },
  },
  // Disco: cilindro con una segunda línea bajo la tapa.
  "lin-cyl": {
    size: (tw, th) => {
      const w = Math.max(tw + 32, 80);
      return { w, h: Math.max(th + 20, 40) + 2 * w * 0.12 + 6, textDy: w * 0.06 + 3 };
    },
    draw: (b, st) => {
      const ry = b.w * 0.12;
      const top = b.t + ry;
      const bottom = b.b - ry;
      return (
        path(`M${b.l},${top} L${b.l},${bottom} A${b.hw},${ry} 0 0 0 ${b.r},${bottom} L${b.r},${top} A${b.hw},${ry} 0 0 0 ${b.l},${top} Z`, st.style) +
        path(`M${b.l},${top} A${b.hw},${ry} 0 0 0 ${b.r},${top} M${b.l},${top + 6} A${b.hw},${ry} 0 0 0 ${b.r},${top + 6}`, st.arc)
      );
    },
  },
  // Pantalla: punta a la izquierda y arco a la derecha.
  "curv-trap": {
    size: (tw, th) => {
      const h = baseH(th);
      const k = h * 0.35;
      return { w: Math.max(tw + 32 + k * 1.6, 90), h, skew: k };
    },
    draw: (b, st, n) => {
      const k = n.skew;
      return path(`M${b.l + k},${b.t} H${b.r - k} A${k},${b.hh} 0 0 1 ${b.r - k},${b.b} H${b.l + k} L${b.l},${b.y} Z`, st.style);
    },
  },
  "div-rect": {
    size: (tw, th) => ({ w: baseW(tw), h: baseH(th) + 12, textDy: 6 }),
    draw: (b, st) => rect(b, st.style) + path(`M${b.l},${b.t + 12} H${b.r}`, st.arc),
  },
  tri: { size: triangle(true), draw: (b, st) => poly([[b.x, b.t], [b.r, b.b], [b.l, b.b]], st.style) },
  "flip-tri": { size: triangle(false), draw: (b, st) => poly([[b.l, b.t], [b.r, b.t], [b.x, b.b]], st.style) },
  "win-pane": {
    size: (tw, th) => ({ w: baseW(tw) + 10, h: baseH(th) + 10, textDx: 5, textDy: 5 }),
    draw: (b, st) => rect(b, st.style) + path(`M${b.l + 10},${b.t} V${b.b} M${b.l},${b.t + 10} H${b.r}`, st.arc),
  },
  "notch-pent": {
    size: (tw, th) => ({ w: baseW(tw), h: baseH(th) }),
    draw: (b, st) => {
      const k = Math.min(12, b.h * 0.3);
      return poly([[b.l + k, b.t], [b.r - k, b.t], [b.r, b.t + k], [b.r, b.b], [b.l, b.b], [b.l, b.t + k]], st.style);
    },
  },
  // Entrada manual: el borde superior sube hacia la derecha.
  "sl-rect": {
    size: (tw, th) => {
      const h = baseH(th);
      const k = h * 0.3;
      return { w: baseW(tw), h: h + k, skew: k, textDy: k / 2, inset: { t: k / 2 } };
    },
    draw: (b, st, n) => poly([[b.l, b.t + n.skew], [b.r, b.t], [b.r, b.b], [b.l, b.b]], st.style),
  },
  // Cinta perforada: olas arriba y abajo.
  flag: {
    size: (tw, th) => {
      const h0 = baseH(th);
      const a = h0 * 0.1;
      return { w: baseW(tw), h: h0 + 2 * a, wave: a, inset: { t: a, b: a } };
    },
    draw: (b, st, n) => {
      const a = n.wave;
      const q = b.w * 0.25;
      return path(
        `M${b.l},${b.t + a} C${b.l + q},${b.t - a} ${b.r - q},${b.t + 3 * a} ${b.r},${b.t + a} V${b.b - a} ` +
          `C${b.r - q},${b.b + a} ${b.l + q},${b.b - 3 * a} ${b.l},${b.b - a} Z`,
        st.style,
      );
    },
  },
  // Datos almacenados: lado izquierdo convexo y derecho cóncavo.
  "bow-rect": {
    size: (tw, th) => {
      const h = baseH(th);
      const rx = h * 0.2;
      return { w: Math.max(tw + 32 + 2 * rx, 90), h, skew: rx, inset: { r: rx } };
    },
    draw: (b, st, n) => {
      const rx = n.skew;
      return path(`M${b.l + rx},${b.t} H${b.r} A${rx},${b.hh} 0 0 0 ${b.r},${b.b} H${b.l + rx} A${rx},${b.hh} 0 0 1 ${b.l + rx},${b.t} Z`, st.style);
    },
  },
};

const has = (shape) => Object.prototype.hasOwnProperty.call(SHAPES, shape);

// Tamaño de una forma extra: { w, h, …extras que se copian al nodo } o null si no es extra.
function size(shape, tw, th) {
  return has(shape) ? SHAPES[shape].size(tw, th) : null;
}

const hasText = (shape) => !has(shape) || !SHAPES[shape].size(0, 0).noText;
const isRound = (shape) => has(shape) && !!SHAPES[shape].circle;

// st: { style, arc (líneas sin relleno), solid (relleno del color del borde) }.
function draw(n, st) {
  const hw = n.w / 2;
  const hh = n.h / 2;
  const b = { l: n.x - hw, t: n.y - hh, r: n.x + hw, b: n.y + hh, w: n.w, h: n.h, x: n.x, y: n.y, hw, hh };
  return SHAPES[n.shape].draw(b, st, n);
}

return { size, draw, has, hasText, isRound };
});
