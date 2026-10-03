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

## Mapa del layout (módulos UMD en src/layout/; archivo: línea función)
src/layout.js (entrada): 39 layoutDiagram · 151 splitBySubgraph · 232 layoutSingle
base.js (constantes, late) · text.js: 59 sizeNode · junctions.js: 42 addJunctions
directions.js: 16 assignDirections · 47 assignSlots · geometry.js: 7 computeCoordinates · 89 routeEdge
grid.js: 18 placeInGrid (estado g, historia) · 70 place · 94 placeNextTo · 130 findAnchor · 187 expand · nextStart (grupos sueltos según la dirección)
grid-room.js: 25 makeRoom · 55 applyRoom · 93 insertLine (desplazar bloque)
grid-groups.js: 39 simulateGroup · 86 placeGroupByLink · 133 planExtension
grid-cleanup.js: 24 farLeaf · 45 copyLeaves · 91 fixLongLinks · 136 tidyUp
Los grid-*.js reciben g (estado de placeInGrid). Orden de carga en el navegador: SCRIPTS de lib/html.js.
Otros: parser.js (sintaxis, estilos), render.js (SVG, pastillas), viewer.js (visor), template.html.

## Reglas de ahorro
- No leer ni buscar en examples/*.html, vendor/, node_modules/, x.html.
- Imágenes: no abrirlas para comprobar; comprobar con datos (posiciones, choques, diagonales).
  Los PNG de antes/después son solo para el usuario (en /storage/emulated/0/Pictures/diagram_maker/).
- Salidas de tests y trazas: filtrar con grep/tail, máximo ~20 líneas.
- Subagentes solo para tareas grandes e independientes.
