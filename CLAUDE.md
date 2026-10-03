# diagram-maker
Diagramas de flujo desde sintaxis Mermaid con layout propio (rejilla, líneas rectas, sin cruces).
JS: `src/` (motor y visor), `bin/dmk.js` + `lib/` (comando, npm `@jesjack/diagram-maker`).
`diagram.py`: comando anterior en Python. Reglas en SPEC.md; estado y pendientes en PROGRESS.md
(leer solo si hace falta). No cambiar reglas de SPEC.md sin preguntar.

## Comandos
- Tests: `node --test tests/*.test.js 2>&1 | grep -E "^ℹ (pass|fail)|^✖"` (~15 s, 400 aleatorios)
- Python: `python3 -m unittest discover tests 2>&1 | tail -1`
- Render/abrir: `node bin/dmk.js archivo.mmd [--svg|--png|--html|--watch]`
  (desde aquí `dmk` falla: el shell no carga termux-exec; usar `node bin/dmk.js`)
- Antes/después de un arreglo: `node tools/comparar.js <src_antes> src caso.mmd salida.png "título"`
- Git: `git -c user.name="Edgar Jesús Moreno Castañeda" -c user.email="jesjack25_03@hotmail.com" commit …`
- Entorno: Termux (Android). `node`, `rsvg-convert` en el PATH. Temporales en `$PREFIX/tmp`.

## Mapa de src/layout.js (línea: función)
60 layoutDiagram · 154 splitBySubgraph · 233 layoutSingle · 304 addJunctions · 383 sizeNode
439 assignDirections · 470 assignSlots · 574 placeInGrid (historia, place) · 645 placeNextTo
682 makeRoom · 712 applyRoom · 750 insertLine (desplazar bloque) · 906 findAnchor
946 twinNextTo · 963 expand/visit · 1018 placeRoot · 1065 simulateGroup · 1112 placeGroupByLink
1159 planExtension · 1212 farLeaf · 1233 copyLeaves · 1279 fixLongLinks · 1324 tidyUp
1449 computeCoordinates · 1510 borderDistance · 1531 routeEdge
Otros: parser.js (sintaxis, estilos), render.js (SVG, pastillas), viewer.js (visor), template.html.

## Reglas de ahorro
- No leer ni buscar en examples/*.html, vendor/, node_modules/, x.html.
- Imágenes: no abrirlas para comprobar; comprobar con datos (posiciones, choques, diagonales).
  Los PNG de antes/después son solo para el usuario (en /storage/emulated/0/Pictures/diagram_maker/).
- Salidas de tests y trazas: filtrar con grep/tail, máximo ~20 líneas.
- Subagentes solo para tareas grandes e independientes.
