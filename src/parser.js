// Parser: texto Mermaid (subconjunto flowchart) -> { nodes, edges, meta, warnings }
//
// nodes:  Map id -> { id, shape, text, line }
// edges:  [{ index, from, to, label, arrowStart, arrowEnd, style, line }]  (orden de declaración)
// meta:   { dirs: [{ from, to, dir, line }] }

class DiagramError extends Error {
  constructor(message, line) {
    super(line ? `Línea ${line}: ${message}` : message);
    this.name = "DiagramError";
    this.line = line;
  }
}

const DIRECTIONS = ["down", "right", "left", "up"];

// Aperturas de forma, de la más larga a la más corta para que "((" gane a "(".
const SHAPES = [
  { open: "((", close: "))", shape: "circle" },
  { open: "[(", close: ")]", shape: "cylinder" },
  { open: "[", close: "]", shape: "rect" },
  { open: "(", close: ")", shape: "round" },
  { open: "{", close: "}", shape: "diamond" },
];

// Líneas de Mermaid que se ignoran (estilos) con un aviso.
const IGNORED_KEYWORDS = /^(classDef|class|style|linkStyle|click)\b/;
const ID_RE = /^[\p{L}\p{N}_]+/u;

function parseDiagram(source) {
  const nodes = new Map();
  const edges = [];
  const meta = { dirs: [] };
  const warnings = [];
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

    if (IGNORED_KEYWORDS.test(line)) {
      warnings.push({ line: lineNo, message: "Estilos de Mermaid ignorados" });
      return;
    }
    if (/^(subgraph|end|direction)\b/.test(line)) {
      throw new DiagramError("'subgraph' todavía no está soportado", lineNo);
    }

    parseStatement(line, lineNo, nodes, edges);
  });

  // Cada @dir debe referirse a una arista existente.
  for (const d of meta.dirs) {
    const exists = edges.some((e) => e.from === d.from && e.to === d.to);
    if (!exists) {
      throw new DiagramError(`@dir: no existe la arista '${d.from} -> ${d.to}'`, d.line);
    }
  }

  return { nodes, edges, meta, warnings };
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
function parseStatement(line, lineNo, nodes, edges) {
  let pos = 0;
  const skipSpaces = () => {
    while (pos < line.length && /\s/.test(line[pos])) pos++;
  };

  skipSpaces();
  let prev = parseNodeRef(line, pos, lineNo, nodes);
  pos = prev.end;

  for (;;) {
    skipSpaces();
    if (pos >= line.length) break;
    if (line[pos] === ";") { pos++; continue; }

    const edge = parseEdge(line, pos, lineNo);
    pos = edge.end;
    skipSpaces();
    if (pos >= line.length) throw new DiagramError("Falta el nodo destino de la arista", lineNo);

    const next = parseNodeRef(line, pos, lineNo, nodes);
    pos = next.end;
    edges.push({
      index: edges.length,
      from: prev.id,
      to: next.id,
      label: edge.label,
      arrowStart: edge.arrowStart,
      arrowEnd: edge.arrowEnd,
      style: edge.style,
      line: lineNo,
    });
    prev = next;
  }
}

// id, opcionalmente seguido de forma y texto: a["texto"], a(("texto")), a{texto}...
function parseNodeRef(line, pos, lineNo, nodes) {
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
    shape = spec.shape;
    text = parsed.text;
    pos = parsed.end;
  }

  // Clase de Mermaid "a:::clase": se ignora.
  const cls = line.slice(pos).match(/^:::[\w-]+/);
  if (cls) pos += cls[0].length;

  const existing = nodes.get(id);
  if (!existing) {
    nodes.set(id, { id, shape: shape || "rect", text: text ?? id, line: lineNo });
  } else if (shape) {
    // Una definición posterior con forma sustituye a la anterior (como en Mermaid).
    existing.shape = shape;
    existing.text = text;
  }
  return { id, end: pos };
}

function parseShapeText(line, pos, close, lineNo) {
  let text;
  if (line[pos] === '"') {
    const endQuote = line.indexOf('"', pos + 1);
    if (endQuote < 0) throw new DiagramError("Comilla sin cerrar", lineNo);
    text = line.slice(pos + 1, endQuote);
    pos = endQuote + 1;
    if (!line.startsWith(close, pos)) throw new DiagramError(`Se esperaba '${close}' después del texto`, lineNo);
  } else {
    const endIdx = line.indexOf(close, pos);
    if (endIdx < 0) throw new DiagramError(`Falta cerrar la forma con '${close}'`, lineNo);
    text = line.slice(pos, endIdx).trim();
    pos = endIdx;
  }
  // "<br>" de Mermaid como salto de línea explícito.
  text = text.replace(/<br\s*\/?>/gi, "\n");
  return { text, end: pos + close.length };
}

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
      label: m[3],
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
    label = labelMatch[1].trim().replace(/^"(.*)"$/, "$1");
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
