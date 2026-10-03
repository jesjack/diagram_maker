// Parser: texto Mermaid (subconjunto flowchart) -> { nodes, edges, meta, warnings }
//
// nodes:  Map id -> { id, shape, text, line, group }   (group: id del subgraph, o null)
// edges:  [{ index, from, to, label, arrowStart, arrowEnd, style, line }]  (orden de declaración)
//         from/to pueden ser el id de un subgraph entero.
// meta:   { dirs: [{ from, to, dir, line }] }
// subgraphs: [{ id, title, parent, line }]  (orden de aparición; parent: id o null)
//
// Estilos (classDef, class, :::, style, linkStyle): se resuelven al final. Cada nodo o arista con
// estilo lleva css = [[propiedad, valor], ...], que el render pasa tal cual al SVG.

class DiagramError extends Error {
  constructor(message, line) {
    super(line ? `Línea ${line}: ${message}` : message);
    this.name = "DiagramError";
    this.line = line;
  }
}

const DIRECTIONS = ["down", "right", "left", "up"];

// Aperturas de forma, de la más larga a la más corta para que "((" gane a "(". Con varios cierres
// posibles ("[/" cierra con "/]" o con "\\]"), close es { cierre: forma }.
const SHAPES = [
  { open: "(((", close: ")))", shape: "dbl-circ" },
  { open: "((", close: "))", shape: "circle" },
  { open: "{{", close: "}}", shape: "hexagon" },
  { open: "[[", close: "]]", shape: "subroutine" },
  { open: "[(", close: ")]", shape: "cylinder" },
  { open: "([", close: "])", shape: "stadium" },
  { open: "[/", close: { "/]": "parallelogram", "\\]": "trap-b" } },
  { open: "[\\", close: { "\\]": "parallelogram-alt", "/]": "trap-t" } },
  { open: ">", close: "]", shape: "asymmetric" },
  { open: "[", close: "]", shape: "rect" },
  { open: "(", close: ")", shape: "round" },
  { open: "{", close: "}", shape: "diamond" },
];

// Formas de `id@{ shape: … }` (Mermaid 11.3+): nombre o alias -> forma interna. Las clásicas
// conservan su nombre; las nuevas usan el nombre corto de Mermaid (ver src/shapes.js).
const EXT_SHAPES = {};
for (const [shape, names] of Object.entries({
  rect: "rect proc process rectangle",
  round: "rounded event",
  stadium: "stadium pill terminal",
  subroutine: "fr-rect subproc subprocess subroutine framed-rectangle",
  cylinder: "cyl cylinder database db",
  circle: "circle circ",
  diamond: "diam diamond decision question",
  hexagon: "hex hexagon prepare",
  parallelogram: "lean-r lean-right in-out",
  "parallelogram-alt": "lean-l lean-left out-in",
  asymmetric: "odd asymmetric",
  "trap-b": "trap-b trapezoid trapezoid-bottom priority",
  "trap-t": "trap-t inv-trapezoid trapezoid-top manual",
  "dbl-circ": "dbl-circ double-circle",
  text: "text",
  "notch-rect": "notch-rect notched-rectangle card",
  "lin-rect": "lin-rect lined-rectangle lin-proc lined-process shaded-process",
  "sm-circ": "sm-circ small-circle start",
  "fr-circ": "fr-circ framed-circle stop",
  "f-circ": "f-circ filled-circle junction",
  "cross-circ": "cross-circ crossed-circle summary",
  fork: "fork join",
  hourglass: "hourglass collate",
  bolt: "bolt com-link lightning-bolt",
  brace: "brace brace-l comment",
  "brace-r": "brace-r",
  braces: "braces",
  doc: "doc document",
  "lin-doc": "lin-doc lined-document",
  "tag-doc": "tag-doc tagged-document",
  docs: "docs documents st-doc stacked-document multi-doc",
  processes: "processes procs st-rect stacked-rectangle multi-proc",
  "tag-rect": "tag-rect tag-proc tagged-rectangle tagged-process",
  delay: "delay half-rounded-rectangle",
  "h-cyl": "h-cyl das horizontal-cylinder",
  "lin-cyl": "lin-cyl disk lined-cylinder",
  "curv-trap": "curv-trap curved-trapezoid display",
  "div-rect": "div-rect div-proc divided-rectangle divided-process",
  tri: "tri triangle extract",
  "flip-tri": "flip-tri flipped-triangle manual-file",
  "win-pane": "win-pane window-pane internal-storage",
  "notch-pent": "notch-pent notched-pentagon loop-limit",
  "sl-rect": "sl-rect sloped-rectangle manual-input",
  flag: "flag paper-tape",
  "bow-rect": "bow-rect bow-tie-rectangle stored-data",
})) {
  for (const name of names.split(" ")) EXT_SHAPES[name] = shape;
}

const STYLE_RE = /^(classDef|class|style|linkStyle)\s+(\S+)(?:\s+(.*))?$/;
// Propiedades de HTML que no tienen efecto en un elemento SVG: se avisa para que no parezca un fallo.
const HTML_ONLY_PROPS = /^(background(-.*)?|padding(-.*)?|margin(-.*)?|border(-.*)?|width|height|display|box-shadow|text-align)$/;
const ID_RE = /^[\p{L}\p{N}_]+/u;

function parseDiagram(source) {
  const nodes = new Map();
  const edges = [];
  const meta = { dirs: [] };
  const warnings = [];
  const subgraphs = [];
  const open = []; // pila de subgraphs abiertos
  const styles = { classDefs: new Map(), classOf: [], style: [], linkStyle: [] };
  let headerSeen = false;

  const lines = source.split(/\r?\n/);
  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    if (trimmed.startsWith("%%")) {
      parseComment(trimmed.slice(2).trim(), lineNo, meta);
      return;
    }

    const line = stripTrailingComment(trimmed).trim();
    if (!line) return;

    if (!headerSeen && /^(graph|flowchart)\b/.test(line)) {
      headerSeen = true;
      return;
    }
    headerSeen = true;

    if (/^click\b/.test(line)) {
      warnings.push({ line: lineNo, message: "'click' ignorado" });
      return;
    }
    const st = line.match(STYLE_RE);
    if (st) {
      parseStyleStatement(st, lineNo, styles);
      return;
    }
    if (/^subgraph\b/.test(line)) {
      const sg = parseSubgraphHeader(line, lineNo);
      if (subgraphs.some((s) => s.id === sg.id)) throw new DiagramError(`Subgraph '${sg.id}' repetido`, lineNo);
      sg.parent = open.length ? open[open.length - 1].id : null;
      subgraphs.push(sg);
      open.push(sg);
      return;
    }
    if (line === "end") {
      if (!open.length) throw new DiagramError("'end' sin 'subgraph'", lineNo);
      open.pop();
      return;
    }
    if (/^direction\b/.test(line)) {
      warnings.push({ line: lineNo, message: "'direction' ignorada: el layout usa sus propias reglas" });
      return;
    }

    parseStatement(line, lineNo, nodes, edges, open.length ? open[open.length - 1].id : null, styles);
  });

  if (open.length) {
    const last = open[open.length - 1];
    throw new DiagramError(`Falta 'end' para el subgraph '${last.id}'`, last.line);
  }

  // Cada @dir debe referirse a una arista existente.
  for (const d of meta.dirs) {
    const exists = edges.some((e) => e.from === d.from && e.to === d.to);
    if (!exists) {
      throw new DiagramError(`@dir: no existe la arista '${d.from} -> ${d.to}'`, d.line);
    }
  }

  // Un id de subgraph usado en una arista apunta al subgraph entero, no a un nodo.
  for (const sg of subgraphs) {
    const node = nodes.get(sg.id);
    if (!node) continue;
    if (node.declared) {
      throw new DiagramError(`'${sg.id}' es a la vez un subgraph y un nodo con forma`, node.line);
    }
    nodes.delete(sg.id);
  }
  for (const n of nodes.values()) delete n.declared;
  resolveStyles(styles, nodes, edges, subgraphs, warnings);

  return { nodes, edges, meta, warnings, subgraphs };
}

// classDef a,b props | class id1,id2 clase | style id props | linkStyle 0,2|default props
function parseStyleStatement([, keyword, target, rest], lineNo, styles) {
  const list = target.split(",").filter(Boolean);
  if (keyword === "class") {
    if (!rest) throw new DiagramError("Uso: class id1,id2 clase", lineNo);
    for (const id of list) styles.classOf.push({ id, cls: rest.trim(), line: lineNo });
    return;
  }
  if (!rest) throw new DiagramError(`Faltan las propiedades de '${keyword}'`, lineNo);
  const props = parseProps(rest, lineNo);
  if (keyword === "classDef") {
    for (const name of list) styles.classDefs.set(name, { props, line: lineNo, order: styles.classDefs.size });
  } else if (keyword === "style") {
    for (const id of list) styles.style.push({ id, props, line: lineNo });
  } else styles.linkStyle.push({ targets: list, props, line: lineNo });
}

// "fill:#f9f,stroke:#333,stroke-dasharray:5 5" -> [[prop, valor], ...]. Un trozo sin ':' (la coma
// de "stroke-dasharray: 5, 5") se une a la propiedad anterior; "\," también es una coma.
function parseProps(text, lineNo) {
  const props = [];
  for (const piece of text.replace(/;\s*$/, "").split(/(?<!\\),/)) {
    const m = piece.replace(/\\,/g, ",").match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
    if (m) props.push([m[1].toLowerCase(), m[2]]);
    else if (props.length) props[props.length - 1][1] += `,${piece.trim()}`;
    else throw new DiagramError(`Propiedad de estilo inválida: '${piece.trim()}'`, lineNo);
  }
  return props;
}

// Prioridad (como en Mermaid): classDef default -> clases del nodo (gana la definida más tarde)
// -> style del nodo. Una propiedad repetida se queda con el último valor.
function resolveStyles(styles, nodes, edges, subgraphs, warnings) {
  const warned = new Set();
  const warnOnce = (key, line, message) => {
    if (warned.has(key)) return;
    warned.add(key);
    warnings.push({ line, message });
  };
  const merge = (css, props, line) => {
    const map = new Map(css);
    for (const [k, v] of props) {
      if (HTML_ONLY_PROPS.test(k)) warnOnce(`prop:${k}`, line, `La propiedad '${k}' no tiene efecto en SVG: se ignora`);
      else {
        map.delete(k); // al final, para que el orden refleje la prioridad
        map.set(k, v);
      }
    }
    return [...map];
  };
  const isSubgraph = (id) => subgraphs.some((sg) => sg.id === id);

  const classesOf = new Map();
  for (const c of styles.classOf) {
    if (nodes.has(c.id)) classesOf.set(c.id, [...(classesOf.get(c.id) || []), c]);
    else if (isSubgraph(c.id)) warnOnce(`sg:${c.id}`, c.line, `Estilo del subgraph '${c.id}' ignorado (los subgraphs no tienen caja)`);
    else warnings.push({ line: c.line, message: `class: no existe el nodo '${c.id}'` });
  }
  const def = styles.classDefs.get("default");
  for (const n of nodes.values()) {
    let css = def ? merge([], def.props, def.line) : [];
    const defs = [];
    for (const c of classesOf.get(n.id) || []) {
      const d = styles.classDefs.get(c.cls);
      if (d) defs.push(d);
      else warnOnce(`cls:${c.cls}`, c.line, `La clase '${c.cls}' no tiene classDef: se ignora`);
    }
    for (const d of defs.sort((a, b) => a.order - b.order)) css = merge(css, d.props, d.line);
    if (css.length) n.css = css;
  }
  for (const st of styles.style) {
    const n = nodes.get(st.id);
    if (n) n.css = merge(n.css || [], st.props, st.line);
    else if (isSubgraph(st.id)) warnOnce(`sg:${st.id}`, st.line, `Estilo del subgraph '${st.id}' ignorado (los subgraphs no tienen caja)`);
    else warnings.push({ line: st.line, message: `style: no existe el nodo '${st.id}'` });
  }
  for (const ls of styles.linkStyle) {
    for (const t of ls.targets) {
      const targets = t === "default" ? edges : /^\d+$/.test(t) && edges[Number(t)] ? [edges[Number(t)]] : null;
      if (!targets) {
        warnings.push({ line: ls.line, message: `linkStyle: no existe la flecha número '${t}' (se cuentan desde 0)` });
        continue;
      }
      for (const e of targets) e.css = merge(e.css || [], ls.props, ls.line);
    }
  }
}

// subgraph ID["título"] | subgraph ID[título] | subgraph "título" | subgraph título
function parseSubgraphHeader(line, lineNo) {
  const rest = line.slice("subgraph".length).trim();
  if (!rest) throw new DiagramError("Falta el nombre del subgraph", lineNo);
  const m = rest.match(/^([\p{L}\p{N}_]+)\s*\[\s*("?)(.*?)\2\s*\]$/u);
  if (m) return { id: m[1], title: m[3], line: lineNo };
  const quoted = rest.match(/^"(.*)"$/);
  const title = quoted ? quoted[1] : rest;
  return { id: title, title, line: lineNo };
}

// "%% @dir a -> b : down"  (comentarios normales se ignoran)
function parseComment(body, lineNo, meta) {
  if (!body.startsWith("@")) return;
  const m = body.match(/^@(\w+)\s*(.*)$/);
  const directive = m[1];
  const args = m[2].trim();

  if (directive === "dir") {
    const d = args.match(/^([\p{L}\p{N}_]+)\s*->\s*([\p{L}\p{N}_]+)\s*:\s*(\w+)$/u);
    if (!d) {
      throw new DiagramError("Formato de @dir inválido. Uso: %% @dir origen -> destino : down|right|left|up", lineNo);
    }
    if (!DIRECTIONS.includes(d[3])) {
      throw new DiagramError(`Dirección '${d[3]}' inválida. Usa: ${DIRECTIONS.join(", ")}`, lineNo);
    }
    meta.dirs.push({ from: d[1], to: d[2], dir: d[3], line: lineNo });
    return;
  }

  throw new DiagramError(`Metadato desconocido '@${directive}'`, lineNo);
}

// Quita "%% ..." al final de una línea, respetando el texto entre comillas.
function stripTrailingComment(line) {
  let inQuotes = false;
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] === '"') inQuotes = !inQuotes;
    else if (!inQuotes && line[i] === "%" && line[i + 1] === "%") return line.slice(0, i);
  }
  return line;
}

// nodo (arista nodo)*   p. ej. "a --> b -->|x| c"
function parseStatement(line, lineNo, nodes, edges, group, styles) {
  let pos = 0;
  const skipSpaces = () => {
    while (pos < line.length && /\s/.test(line[pos])) pos++;
  };

  skipSpaces();
  let prev = parseNodeRefs(line, pos, lineNo, nodes, group, styles);
  pos = prev.end;

  for (;;) {
    skipSpaces();
    if (pos >= line.length) break;
    if (line[pos] === ";") { pos++; continue; }

    const edge = parseEdge(line, pos, lineNo);
    pos = edge.end;
    skipSpaces();
    if (pos >= line.length) throw new DiagramError("Falta el nodo destino de la arista", lineNo);

    const next = parseNodeRefs(line, pos, lineNo, nodes, group, styles);
    pos = next.end;
    for (const from of prev.ids) {
      for (const to of next.ids) {
        edges.push({
          index: edges.length,
          from,
          to,
          label: edge.label,
          arrowStart: edge.arrowStart,
          arrowEnd: edge.arrowEnd,
          style: edge.style,
          line: lineNo,
        });
      }
    }
    prev = next;
  }
}

function parseNodeRefs(line, pos, lineNo, nodes, group, styles) {
  const first = parseNodeRef(line, pos, lineNo, nodes, group, styles);
  const ids = [first.id];
  pos = first.end;
  for (;;) {
    while (pos < line.length && /\s/.test(line[pos])) pos++;
    if (line[pos] !== "&") break;
    pos++;
    while (pos < line.length && /\s/.test(line[pos])) pos++;
    const next = parseNodeRef(line, pos, lineNo, nodes, group, styles);
    ids.push(next.id);
    pos = next.end;
  }
  return { ids, end: pos };
}

// id, opcionalmente seguido de forma y texto: a["texto"], a(("texto")), a{texto}...
function parseNodeRef(line, pos, lineNo, nodes, group, styles) {
  const idMatch = line.slice(pos).match(ID_RE);
  if (!idMatch) throw new DiagramError(`Se esperaba un id de nodo en '${line.slice(pos)}'`, lineNo);
  const id = idMatch[0];
  pos += id.length;

  let shape = null;
  let text = null;
  const spec = SHAPES.find((s) => line.startsWith(s.open, pos));
  if (spec) {
    pos += spec.open.length;
    const parsed = parseShapeText(line, pos, spec.close, lineNo);
    shape = typeof spec.close === "string" ? spec.shape : spec.close[parsed.close];
    text = parsed.text;
    pos = parsed.end;
  }

  // Forma de Mermaid 11.3+: id@{ shape: doc, label: "texto" }.
  if (line[pos] === "@" && line[pos + 1] === "{") {
    const ext = parseExtendedShape(line, pos + 2, lineNo);
    if (ext.shape) shape = ext.shape;
    if (ext.text !== null) text = ext.text;
    if (!shape) shape = nodes.get(id)?.shape || "rect";
    if (text === null) text = nodes.get(id)?.text ?? id;
    pos = ext.end;
  }

  // Clase de Mermaid "a:::clase".
  const cls = line.slice(pos).match(/^:::([\w-]+)/);
  if (cls) {
    pos += cls[0].length;
    if (styles) styles.classOf.push({ id, cls: cls[1], line: lineNo });
  }

  const existing = nodes.get(id);
  if (!existing) {
    // El nodo pertenece al subgraph donde aparece por primera vez.
    nodes.set(id, { id, shape: shape || "rect", text: text ?? id, line: lineNo, group, declared: !!shape });
  } else if (shape) {
    existing.declared = true;
    // Una definición posterior con forma sustituye a la anterior (como en Mermaid).
    existing.shape = shape;
    existing.text = text;
  }
  return { id, end: pos };
}

// close: un cierre o { cierre: forma }; devuelve también el cierre encontrado.
function parseShapeText(line, pos, close, lineNo) {
  const closes = typeof close === "string" ? [close] : Object.keys(close);
  const shown = closes.map((c) => `'${c}'`).join(" o ");
  let text;
  let found;
  if (line[pos] === '"') {
    const endQuote = line.indexOf('"', pos + 1);
    if (endQuote < 0) throw new DiagramError("Comilla sin cerrar", lineNo);
    text = line.slice(pos + 1, endQuote);
    pos = endQuote + 1;
    found = closes.find((c) => line.startsWith(c, pos));
    if (!found) throw new DiagramError(`Se esperaba ${shown} después del texto`, lineNo);
  } else {
    let endIdx = -1;
    for (const c of closes) {
      const i = line.indexOf(c, pos);
      if (i >= 0 && (endIdx < 0 || i < endIdx)) [endIdx, found] = [i, c];
    }
    if (endIdx < 0) throw new DiagramError(`Falta cerrar la forma con ${shown}`, lineNo);
    text = line.slice(pos, endIdx).trim();
    pos = endIdx;
  }
  // "<br>" de Mermaid como salto de línea explícito.
  text = text.replace(/<br\s*\/?>/gi, "\n");
  return { text, end: pos + found.length, close: found };
}

// Cuerpo de "@{ … }" desde pos (después de "@{"): pares clave: valor separados por comas, valores
// con o sin comillas. Se usan shape y label; el resto (icon, img, pos…) se ignora.
function parseExtendedShape(line, pos, lineNo) {
  const fields = [];
  let current = "";
  let quoted = false;
  let i = pos;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "}") break;
    if (!quoted && ch === ",") {
      fields.push(current);
      current = "";
    } else current += ch;
  }
  if (i >= line.length) throw new DiagramError("Falta cerrar '@{' con '}'", lineNo);
  fields.push(current);
  let shape = null;
  let text = null;
  for (const field of fields.map((f) => f.trim()).filter(Boolean)) {
    const m = field.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!m) throw new DiagramError(`Se esperaba 'clave: valor' en '@{ … }' y hay '${field}'`, lineNo);
    const value = m[2].trim().replace(/^"(.*)"$/, "$1");
    if (m[1] === "shape") {
      shape = EXT_SHAPES[value];
      if (!shape) throw new DiagramError(`Forma no soportada: '${value}'`, lineNo);
    } else if (m[1] === "label") text = value.replace(/<br\s*\/?>/gi, "\n");
  }
  return { shape, text, end: i + 1 };
}

// Texto de una etiqueta de arista: sin comillas y con "<br>" como salto de línea, como en los nodos.
const labelText = (t) => t.replace(/^"(.*)"$/, "$1").replace(/<br\s*\/?>/gi, "\n");

// Aristas soportadas:
//   a --> b    a <--> b    a --- b    a ==> b    a -.-> b
//   a -->|etiqueta| b      a -- etiqueta --> b
function parseEdge(line, pos, lineNo) {
  const rest = line.slice(pos);
  const styleOf = (s) => (s.includes("=") ? "thick" : s.includes(".") ? "dotted" : "solid");

  // Forma con texto en medio: "-- texto -->"
  let m = rest.match(/^(<?)(--|==|-\.)\s+(.+?)\s+(-{2,}|={2,}|\.+-)(>?)/);
  if (m && !/^(<?)(-{2,}|={2,}|-\.+-)>/.test(rest)) {
    return {
      label: labelText(m[3]), // -- "texto" --> : sin las comillas, como en -->|"texto"|
      arrowStart: m[1] === "<",
      arrowEnd: m[5] === ">",
      style: styleOf(m[2] + m[4]),
      end: pos + m[0].length,
    };
  }

  m = rest.match(/^(<?)(-{2,}|={2,}|-\.+-)(>)/) || rest.match(/^()(-{3,}|={3,}|-\.+-)()/);
  if (!m) throw new DiagramError(`Se esperaba una arista (-->) en '${rest}'`, lineNo);

  let end = pos + m[0].length;
  let label = null;
  const labelMatch = line.slice(end).match(/^\s*\|([^|]*)\|/);
  if (labelMatch) {
    label = labelText(labelMatch[1].trim());
    end += labelMatch[0].length;
  }
  return {
    label,
    arrowStart: m[1] === "<",
    arrowEnd: m[3] === ">",
    style: styleOf(m[2]),
    end,
  };
}

if (typeof module !== "undefined") module.exports = { parseDiagram, DiagramError, DIRECTIONS };
