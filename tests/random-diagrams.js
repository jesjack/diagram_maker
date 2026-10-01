// Diagramas aleatorios para probar el layout: generador determinista (semilla), comprobación de
// invariantes y reducción de un caso que falla hasta uno mínimo. Sin dependencias.
//
//   node tests/random-diagrams.js 42          -> muestra el diagrama de la semilla 42 y sus fallos
//   node tests/random-diagrams.js 42 reducir  -> además lo reduce al caso mínimo
//
// El generador solo produce entradas válidas: un DiagramError al procesarlas cuenta como fallo.

const { parseDiagram, DiagramError } = require("../src/parser.js");
const { layoutDiagram } = require("../src/layout.js");
const { renderSvg } = require("../src/render.js");

const OPPOSITE = { down: "up", up: "down", left: "right", right: "left" };
const DIRS = ["down", "right", "left", "up"];

// ---------------------------------------------------------------- azar con semilla

// mulberry32: PRNG de 32 bits, suficiente para tests y reproducible en cualquier Node.
function crearAzar(semilla) {
  let s = semilla >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (a, b) => a + Math.floor(next() * (b - a + 1)); // entero en [a, b]
  return {
    next,
    int,
    chance: (p) => next() < p,
    pick: (xs) => xs[Math.floor(next() * xs.length)],
  };
}

// ---------------------------------------------------------------- generador

const FORMAS = [
  ["[", "]"], // rect
  ["(", ")"], // round
  ["([", "])"], // stadium
  ["((", "))"], // circle
  ["{", "}"], // diamond
  ["{{", "}}"], // hexagon
  ["[(", ")]"], // cylinder
  ["[/", "/]"], // parallelogram
  ["[\\", "\\]"], // parallelogram-alt
];
const PALABRAS = [
  "caja", "venta", "usuario", "sesión", "abrir", "cerrar", "¿hay red?", "guardar", "BD", "LOG",
  "reintentar", "aviso", "main.ods", "plantilla", "cámaras", "sale", "Sí", "No", "error", "copia",
];
const FLECHAS = ["-->", "-->", "-->", "<-->", "---", "-.->", "==>"];
const CLASES = [
  ["verde", "fill:#dcfce7,stroke:#15803d"],
  ["rojo", "fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d"],
  ["grande", "font-size:20px,font-weight:bold"],
  ["gris", "fill:#f1f5f9,stroke-dasharray:5 5"],
];

const texto = (r) => {
  const n = r.int(1, r.chance(0.15) ? 9 : 3);
  const words = Array.from({ length: n }, () => r.pick(PALABRAS));
  if (n > 3 && r.chance(0.3)) words.splice(2, 0, "<br>");
  return words.join(" ");
};

// Tamaño: la mayoría pequeños o medianos, algunos grandes (hasta ~60 nodos).
function tamaño(r) {
  const t = r.next();
  if (t < 0.4) return r.int(2, 8);
  if (t < 0.8) return r.int(9, 25);
  return r.int(26, 60);
}

// Devuelve el texto Mermaid del diagrama de una semilla.
function generarDiagrama(semilla) {
  const r = crearAzar(semilla);
  const n = tamaño(r);
  const ids = Array.from({ length: n }, (_, i) => `n${i}`);
  const forma = new Map(ids.map((id) => [id, r.pick(FORMAS)]));
  const textoDe = new Map(ids.map((id) => [id, texto(r)]));

  // Aristas: un árbol (cada nodo cuelga de uno anterior, con preferencia por los recientes y por
  // algunos "concentradores" que acaban con más de 4 conexiones) más aristas extra: varios
  // padres, ciclos (hacia atrás) y alguna repetida.
  const aristas = [];
  const hubs = ids.filter(() => r.chance(0.12));
  for (let i = 1; i < n; i++) {
    if (r.chance(0.06)) continue; // a veces un grupo desconectado
    let p;
    if (hubs.length && r.chance(0.25)) p = r.pick(hubs.filter((h) => ids.indexOf(h) < i)) ?? ids[i - 1];
    else if (r.chance(0.6)) p = ids[Math.max(0, i - r.int(1, 3))];
    else p = ids[r.int(0, i - 1)];
    aristas.push({ from: p, to: ids[i] });
  }
  const extra = r.int(0, Math.ceil(n * (r.chance(0.3) ? 0.6 : 0.25)));
  for (let k = 0; k < extra; k++) {
    const a = r.pick(ids);
    const b = r.pick(ids);
    if (a !== b) aristas.push({ from: a, to: b });
  }
  // Mezcla un poco el orden de declaración (cambia el layout).
  for (let k = 0; k < aristas.length / 4; k++) {
    const i = r.int(0, aristas.length - 1);
    const j = r.int(0, aristas.length - 1);
    [aristas[i], aristas[j]] = [aristas[j], aristas[i]];
  }
  for (const e of aristas) {
    e.flecha = r.pick(FLECHAS);
    if (r.chance(0.15)) e.label = r.pick(PALABRAS);
    e.labelAlt = r.chance(0.3); // -- "x" --> en vez de -->|x|
  }

  // Subgraphs: algunos diagramas reparten parte de sus nodos en subgraphs, a veces anidados.
  const subgraphs = [];
  const grupo = new Map(ids.map((id) => [id, null]));
  if (n >= 4 && r.chance(0.3)) {
    const k = r.int(1, Math.min(4, Math.floor(n / 3)));
    for (let i = 0; i < k; i++) {
      const parent = i > 0 && r.chance(0.35) ? r.pick(subgraphs).id : null;
      subgraphs.push({ id: `S${i}`, title: r.chance(0.5) ? `Parte ${i}` : null, parent });
    }
    for (const id of ids) if (r.chance(0.55)) grupo.set(id, r.pick(subgraphs).id);
    // Alguna arista hacia o desde un subgraph entero.
    if (r.chance(0.3)) {
      const sg = r.pick(subgraphs).id;
      const a = r.pick(ids);
      aristas.push(r.chance(0.5) ? { from: a, to: sg, flecha: "-->" } : { from: sg, to: a, flecha: "-->" });
    }
  }

  // @dir: sin pedir dos veces el mismo lado de un nodo (ni como salida ni como entrada), que sería
  // un error fatal, y solo en aristas no repetidas (el @dir se aplicaría a todas las copias).
  const dirs = [];
  if (r.chance(0.35)) {
    const lados = new Map(); // nodo -> lados ya pedidos
    const ladoLibre = (id, d) => !(lados.get(id) || new Set()).has(d);
    const pedir = (id, d) => lados.set(id, new Set([...(lados.get(id) || []), d]));
    const veces = new Map();
    for (const e of aristas) veces.set(`${e.from}>${e.to}`, (veces.get(`${e.from}>${e.to}`) || 0) + 1);
    for (const e of aristas) {
      if (!r.chance(0.2) || veces.get(`${e.from}>${e.to}`) > 1 || !ids.includes(e.from) || !ids.includes(e.to)) continue;
      const d = r.pick(DIRS);
      if (!ladoLibre(e.from, d) || !ladoLibre(e.to, OPPOSITE[d])) continue;
      pedir(e.from, d);
      pedir(e.to, OPPOSITE[d]);
      dirs.push(`%% @dir ${e.from} -> ${e.to} : ${d}`);
    }
  }

  // Estilos.
  const clases = r.chance(0.3) ? CLASES.filter(() => r.chance(0.6)) : [];
  const claseDe = new Map();
  for (const id of ids) if (clases.length && r.chance(0.3)) claseDe.set(id, r.pick(clases)[0]);

  // ---- escritura
  const decl = (id) => `${id}${forma.get(id)[0]}"${textoDe.get(id)}"${forma.get(id)[1]}${claseDe.has(id) ? `:::${claseDe.get(id)}` : ""}`;
  const declarado = new Set();
  // Un extremo de arista: con forma la primera vez si no se declaró antes (solo sin subgraphs, donde
  // la pertenencia no depende de dónde aparece).
  const ref = (id) => {
    if (declarado.has(id) || !forma.has(id)) return id;
    declarado.add(id);
    return decl(id);
  };
  const flecha = (e) => {
    if (!e.label) return ` ${e.flecha} `;
    if (e.labelAlt && e.flecha === "-->") return ` -- "${e.label}" --> `;
    return ` ${e.flecha}|${e.label}| `;
  };
  const lineasAristas = (lista) => {
    const out = [];
    for (let i = 0; i < lista.length; i++) {
      let line = `${ref(lista[i].from)}${flecha(lista[i])}${ref(lista[i].to)}`;
      // Cadena: a --> b --> c cuando la siguiente arista sigue desde el destino de esta.
      while (i + 1 < lista.length && lista[i + 1].from === lista[i].to && r.chance(0.6)) {
        i++;
        line += `${flecha(lista[i])}${ref(lista[i].to)}`;
      }
      out.push(line);
    }
    return out;
  };

  const lines = [r.chance(0.8) ? "flowchart TD" : "graph TD"];
  for (const [name, props] of clases) lines.push(`classDef ${name} ${props}`);
  if (!subgraphs.length) {
    for (const id of ids) if (r.chance(0.5)) lines.push(`${ref(id)}`);
    lines.push(...lineasAristas(aristas));
    for (const id of ids) if (!declarado.has(id)) lines.push(ref(id)); // nodos sueltos
  } else {
    for (const id of ids) {
      if (grupo.get(id) !== null) continue;
      declarado.add(id);
      lines.push(decl(id));
    }
    // Cada subgraph: sus nodos, sus subgraphs hijos y al final (si toca) sus aristas internas,
    // para que ningún nodo aparezca antes en otro bloque.
    const dentro = new Set();
    const bloque = (sg, sangria) => {
      lines.push(`${sangria}subgraph ${sg.id}${sg.title ? `["${sg.title}"]` : ""}`);
      for (const id of ids) {
        if (grupo.get(id) !== sg.id) continue;
        declarado.add(id);
        lines.push(`${sangria}  ${decl(id)}`);
      }
      for (const hijo of subgraphs) if (hijo.parent === sg.id) bloque(hijo, `${sangria}  `);
      const propias = aristas.filter((e) => grupo.get(e.from) === sg.id && grupo.get(e.to) === sg.id && !dentro.has(e) && r.chance(0.6));
      for (const e of propias) dentro.add(e);
      for (const l of lineasAristas(propias)) lines.push(`${sangria}  ${l}`);
      lines.push(`${sangria}end`);
    };
    for (const sg of subgraphs) if (!sg.parent) bloque(sg, "");
    lines.push(...lineasAristas(aristas.filter((e) => !dentro.has(e))));
  }
  lines.push(...dirs);
  if (clases.length && r.chance(0.3)) lines.push(`class ${ids.slice(0, 2).join(",")} ${clases[0][0]}`);
  if (r.chance(0.1)) lines.push(`style ${r.pick(ids)} stroke:#1d4ed8,stroke-width:3px`);
  if (r.chance(0.1)) lines.push("linkStyle 0 stroke:#dc2626");
  // Un @dir puede mandar un nodo a una celda ocupada: la SPEC lo permite (queda el aviso), pero no
  // es lo que se quiere probar. Se quitan, uno a uno, los @dir del nodo que choca.
  let src = lines.join("\n");
  for (let p = revisar(src)[0]; p && p.inv === CHOQUE_POR_DIR; p = revisar(src)[0]) {
    const re = new RegExp(`^%% @dir .*\\b${p.nodo}\\b`);
    const quitar = src.split("\n").findIndex((l) => re.test(l));
    src = src.split("\n").filter((_, i) => i !== quitar).join("\n");
  }
  return src;
}

// ---------------------------------------------------------------- invariantes

// Aristas que el resultado debe dibujar (sin contar extensiones a empalmes), según la SPEC: con
// subgraphs, una arista entre diagramas se dibuja en los dos, salvo en el lado de un nodo absorbido
// (que no se dibuja en su diagrama); una arista con un subgraph entero, solo en el del nodo; y
// entre dos subgraphs enteros se ignora.
function aristasEsperadas(g) {
  if (!g.subgraphs.length) return g.edges.length;
  const absorbido = new Set();
  for (const n of g.nodes.values()) {
    if (n.group !== null) continue;
    const own = g.edges.filter((e) => e.from === n.id || e.to === n.id);
    const soloDentro = own.every((e) => {
      const otro = g.nodes.get(e.from === n.id ? e.to : e.from);
      return otro && otro.group !== null;
    });
    if (own.length && soloDentro) absorbido.add(n.id);
  }
  let total = 0;
  for (const e of g.edges) {
    const a = g.nodes.get(e.from);
    const b = g.nodes.get(e.to);
    if (a && b) total += a.group === b.group ? 1 : 2 - absorbido.has(e.from) - absorbido.has(e.to);
    else if (a || b) total += 1;
  }
  return total;
}

// Diagrama (índice) al que pertenece una x: cada subgraph es un diagrama aparte a la derecha del
// anterior y su título marca dónde empieza (el nivel superior, sin título, es el 0). Hace falta
// porque cada diagrama tiene su propia rejilla y un nodo absorbido puede repetirse con el mismo id.
const diagramaDe = (titles) => (x) => titles.filter((t) => t.x <= x + 1e-6).length;

// Comprueba col/row de un conjunto de nodos y aristas: sin celdas compartidas, extremos existentes,
// sin diagonales y sin flechas rectas por encima de otro nodo. Devuelve los problemas encontrados.
function revisarRejilla({ nodes, edges, titles }, { completo = true } = {}) {
  const problemas = [];
  const enDiagrama = diagramaDe(titles || []);
  const diag = new Map(); // nodo -> diagrama
  const porDiagrama = new Map(); // diagrama -> Map id -> nodo
  const celdas = new Map(); // "d|col,row" -> nodo
  for (const n of nodes) {
    const d = enDiagrama(n.x - n.w / 2);
    diag.set(n, d);
    if (!porDiagrama.has(d)) porDiagrama.set(d, new Map());
    porDiagrama.get(d).set(n.id, n);
    const key = `${d}|${n.col},${n.row}`;
    if (completo && celdas.has(key)) problemas.push({ inv: "celda compartida", detalle: `${celdas.get(key).id} y ${n.id} en ${key}` });
    celdas.set(key, n);
  }
  for (const e of edges) {
    const d = enDiagrama(Math.min(e.points[0].x, e.points[1].x));
    const m = porDiagrama.get(d) || new Map();
    const a = m.get(e.from);
    const b = m.get(e.to);
    if (!a || !b) {
      problemas.push({ inv: "extremo inexistente", detalle: `${e.from} -> ${e.to}` });
      continue;
    }
    if (a.col !== b.col && a.row !== b.row) {
      problemas.push({ inv: "diagonal", detalle: `${a.id}(${a.col},${a.row}) -> ${b.id}(${b.col},${b.row})` });
      continue;
    }
    if (!completo) continue;
    const pasos = Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
    const dc = Math.sign(b.col - a.col);
    const dr = Math.sign(b.row - a.row);
    for (let i = 1; i < pasos; i++) {
      const otro = celdas.get(`${d}|${a.col + dc * i},${a.row + dr * i}`);
      if (otro) {
        problemas.push({ inv: "flecha sobre un nodo", detalle: `${a.id} -> ${b.id} pasa por ${otro.id}` });
        break;
      }
    }
  }
  return problemas;
}

// Choques permitidos: los de un nodo con un @dir explícito (la SPEC deja el aviso en ese caso).
// Una copia de hoja ('n4⧉1') cuenta como su original, y una referencia (que el aviso nombra por su
// texto) como el nodo real con ese texto, porque ambas heredan el @dir de su flecha. Devuelve el
// id de ese nodo, o null.
const CHOQUE_POR_DIR = "choque por @dir (permitido)";
function choquePermitido(message, conDir, g) {
  const m = message.match(/^Choque: (el empalme de |la referencia a )?'([^']*)'/);
  if (!m) return null;
  const ids = m[1] === "la referencia a "
    ? [...g.nodes.values()].filter((n) => n.text.replace(/\n/g, " ") === m[2]).map((n) => n.id)
    : [m[2].replace(/⧉\d+$/, "")];
  return ids.find((id) => conDir.has(id)) || null;
}

// Procesa un texto y devuelve la lista de invariantes rotos (vacía si todo va bien).
function revisar(src) {
  let g;
  let L;
  try {
    g = parseDiagram(src);
    L = layoutDiagram(g);
  } catch (err) {
    return [{ inv: err instanceof DiagramError ? "error fatal" : "excepción", detalle: err.message }];
  }
  const problemas = [];
  // Un choque provocado por un @dir es legítimo, pero lo que venga después ya no se puede juzgar:
  // el diagrama se descarta entero (el generador quita esos @dir y el reductor no los acepta).
  const conDir = new Set(g.meta.dirs.flatMap((d) => [d.from, d.to]));
  const porDir = L.warnings.find((w) => /^Choque/.test(w.message) && choquePermitido(w.message, conDir, g));
  if (porDir) return [{ inv: CHOQUE_POR_DIR, detalle: porDir.message, nodo: choquePermitido(porDir.message, conDir, g) }];
  for (const w of L.warnings) if (/^Choque/.test(w.message)) problemas.push({ inv: "choque", detalle: w.message });
  problemas.push(...revisarRejilla(L));
  const dibujadas = L.edges.filter((e) => !e.bus).length;
  const esperadas = aristasEsperadas(g);
  if (dibujadas !== esperadas) problemas.push({ inv: "aristas perdidas", detalle: `${dibujadas} dibujadas, ${esperadas} esperadas` });

  // Paso a paso: el paso k muestra k+1 nodos y ninguna flecha en diagonal.
  try {
    for (let k = 0; k < L.nodes.length; k++) {
      const s = L.snapshotAt(k);
      if (s.nodes.length !== k + 1) {
        problemas.push({ inv: "paso a paso: nº de nodos", detalle: `paso ${k}: ${s.nodes.length} nodos` });
        break;
      }
      const p = revisarRejilla(s, { completo: false }).find((x) => x.inv === "diagonal" || x.inv === "extremo inexistente");
      if (p) {
        problemas.push({ inv: `paso a paso: ${p.inv}`, detalle: `paso ${k}: ${p.detalle}` });
        break;
      }
    }
  } catch (err) {
    problemas.push({ inv: "paso a paso: excepción", detalle: err.message });
  }

  try {
    const svg = renderSvg(L);
    if (/NaN|undefined/.test(svg)) problemas.push({ inv: "SVG con NaN/undefined", detalle: svg.match(/.{0,40}(NaN|undefined).{0,20}/)[0] });
  } catch (err) {
    problemas.push({ inv: "excepción en el render", detalle: err.message });
  }
  return problemas;
}

// ---------------------------------------------------------------- reducción

// Variantes más simples de un texto, de lo más grueso a lo más fino. Cada una quita algo: un
// subgraph (su cabecera y su end, conservando el contenido), un nodo (todas sus líneas), una
// línea, o simplifica una línea (parte una cadena, quita etiqueta, clase o texto).
function* variantes(src) {
  const lines = src.split("\n");
  const sin = (...idx) => lines.filter((_, i) => !idx.includes(i)).join("\n");
  // Subgraphs.
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*subgraph\b/.test(lines[i])) continue;
    let depth = 0;
    for (let j = i; j < lines.length; j++) {
      if (/^\s*subgraph\b/.test(lines[j])) depth++;
      else if (lines[j].trim() === "end" && --depth === 0) {
        yield sin(i, j);
        break;
      }
    }
  }
  // Nodos: todas las líneas que lo nombran (las cadenas se parten antes en otra variante).
  const ids = [...new Set(src.match(/\bn\d+\b/g) || [])];
  for (const id of ids) {
    const re = new RegExp(`\\b${id}\\b`);
    yield lines.filter((l) => !re.test(l)).join("\n");
  }
  // Líneas sueltas (de abajo arriba: los @dir y estilos primero).
  for (let i = lines.length - 1; i > 0; i--) if (lines[i].trim() !== "end" && !/^\s*subgraph\b/.test(lines[i])) yield sin(i);
  // Simplificaciones de una línea.
  const FLECHA = /\s*(?:<-->|-->|---|-\.->|==>|-- "[^"]*" -->)(?:\|[^|]*\|)?\s*/g;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    const cambiar = (nueva) => (nueva !== l ? lines.map((x, j) => (j === i ? nueva : x)).join("\n") : null);
    const trozos = l.trim().split(FLECHA);
    const flechas = l.trim().match(FLECHA);
    if (flechas && flechas.length > 1) {
      // Cadena a --> b --> c: una línea por arista.
      const sangria = l.match(/^\s*/)[0];
      // El origen de cada tramo, salvo el primero, ya se declaró con su forma en el tramo anterior.
      const soloId = (t) => t.match(/^[\p{L}\p{N}_]+/u)[0];
      const partes = flechas.map((f, k) => `${sangria}${k ? soloId(trozos[k]) : trozos[k]}${f}${trozos[k + 1]}`);
      yield lines.map((x, j) => (j === i ? partes.join("\n") : x)).join("\n");
    }
    for (const nueva of [
      l.replace(/\|[^|]*\|/g, "").replace(/-- "[^"]*" -->/g, "-->"),
      l.replace(/<-->|---|-\.->|==>/g, "-->"),
      l.replace(/:::\w+/g, ""),
      l.replace(/"[^"]*"/g, (t) => (t.length > 3 ? '"x"' : t)),
    ]) {
      const v = cambiar(nueva);
      if (v) yield v;
    }
  }
}

// Reduce src mientras siga rompiendo el invariante `inv` (por defecto, el primero que rompe).
// sin: invariantes que no deben aparecer en el caso reducido, para no acabar en otro fallo
// conocido (p. ej. una diagonal del paso a paso que no sea también del diagrama final).
function reducir(src, inv = null, { sin = [] } = {}) {
  const objetivo = inv || revisar(src)[0]?.inv;
  if (!objetivo) return src;
  // En un error, además del tipo tiene que coincidir el mensaje (sin línea ni nombres): si no, el
  // reductor acabaría en cualquier otro error, como un @dir de una arista quitada.
  const forma = (p) => (/error|excepción/.test(p.inv) ? `${p.inv}: ${p.detalle.replace(/^Línea \d+: /, "").replace(/'[^']*'/g, "''")}` : p.inv);
  const original = revisar(src).find((p) => p.inv === objetivo);
  const clave = original ? forma(original) : objetivo;
  const falla = (s) => {
    const p = revisar(s);
    return p.some((x) => forma(x) === clave) && !p.some((x) => sin.includes(x.inv));
  };
  let actual = src;
  for (let mejora = true; mejora; ) {
    mejora = false;
    for (const v of variantes(actual)) {
      if (v.length < actual.length || v.split("\n").length > actual.split("\n").length) {
        if (v !== actual && falla(v)) {
          actual = v;
          mejora = true;
          break;
        }
      }
    }
  }
  return actual;
}

module.exports = { CHOQUE_POR_DIR, crearAzar, generarDiagrama, revisar, reducir, aristasEsperadas };

// Uso desde la línea de órdenes, para explorar una semilla.
if (require.main === module) {
  const semilla = Number(process.argv[2] || 1);
  const src = generarDiagrama(semilla);
  // process.stdout.write y no console.log: console.log convertiría "%%" en "%".
  process.stdout.write(`${src}\n\n`);
  console.log(revisar(src));
  if (process.argv[3] === "reducir") {
    const min = reducir(src);
    process.stdout.write(`\n--- caso mínimo ---\n${min}\n`);
    console.log(revisar(min));
  }
}
