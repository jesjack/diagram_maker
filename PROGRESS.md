# Progreso del proyecto

Archivo para retomar el trabajo (con cualquier persona o modelo de IA). Las reglas acordadas están
en [`SPEC.md`](SPEC.md) y la presentación del proyecto en [`README.md`](README.md): léelos primero.

## Cómo retomar

1. Lee `SPEC.md` (reglas) y este archivo (estado y decisiones).
2. Mira "Pendiente" más abajo y `git log` para ver los últimos cambios.
3. Pasa los tests antes y después de tocar nada:
   ```sh
   node --test tests/*.test.js          # parser, layout, render y 400 diagramas aleatorios (~15 s)
   python3 -m unittest discover tests   # servidor de --watch
   ```
4. No cambies las reglas de SPEC.md sin preguntar al usuario. Al terminar algo: actualiza SPEC.md si
   cambia una regla, este archivo y haz commit.

Prompt sugerido para otro modelo:

> Estoy construyendo un generador de diagramas (repo: github.com/jesjack/diagram_maker).
> Lee SPEC.md, PROGRESS.md y README.md y continúa con lo pendiente. No cambies las reglas de
> SPEC.md sin preguntarme.

## Estructura

```
diagram.py            CLI en Python sin dependencias: lee el .mmd, incrusta los scripts en la
                      plantilla, guarda el HTML y lo sirve en 127.0.0.1 (una vez, o con --watch)
src/parser.js         texto Mermaid -> nodos, aristas, subgraphs, estilos y metadatos @dir
src/layout.js         entrada del layout: subgraphs, empalmes, historia del paso a paso
src/layout/          módulos UMD: base, text, directions, junctions, grid (+ grid-room,
                      grid-groups, grid-cleanup, que comparten el estado g), geometry
src/render.js         SVG: formas, flechas, etiquetas, pastillas de id, sombra
src/viewer.js         visor: zoom, gestos, paso a paso, exportar, recarga en vivo, botón Mermaid
src/template.html     plantilla de la página
examples/             diagramas (.mmd); los .html generados están en .gitignore
docs/                 imágenes del README (diagrama del propio proyecto)
tests/                node:test (+ diagramas aleatorios con semilla) y unittest para --watch
```

El HTML generado es un único archivo autocontenido: ningún `.js` puede contener el texto
`</script` (hay un test que lo vigila).

## Estado

Última actualización: 2026-10-04. Versión publicada en npm: `@jesjack/diagram-maker` 0.2.0
(etiqueta `v0.2.0`: entradas .md y carpetas, varios diagramas en un HTML con selector, Termux con
servidor). Para publicar: `npm version patch|minor`, `git push --follow-tags` y `npm publish`
desde una terminal normal de Termux (el agente no puede: pide confirmar con la huella). En el
agente `npm version` no puede hacer el commit (git sin autor): hacer a mano el commit y
`git tag -a vX.Y.Z` con `-c user.name=… -c user.email=…` (ver CLAUDE.md).

### Hecho

- **Motor**: parser (formas: rect, redondeado, estadio, círculo, rombo, hexágono, cilindro,
  subrutina, paralelogramos, trapecios, asimétrica, círculo doble y todas las
  de `id@{ shape: … }`; aristas con etiqueta, `&` en origen/destino, estilos de Mermaid),
  subgraphs como diagramas aparte, layout sin choques ni diagonales (reglas 1–15 de SPEC.md),
  render SVG con pastillas de id (los empalmes son pastillas `● dueño`).
- **Layout, arreglos recientes**: un empalme solo lo coloca su dueño; se cuentan vecinos y no
  flechas (la ida y la vuelta de un ciclo comparten lado); reutilizar el original o un
  representante que ya está al lado; limpieza final (copias de sobra, empalmes de una rama
  alineada, empalmes de cadena vacíos → se saltan o pasan a ser un codo); desplazamientos
  validados con posiciones finales; grupos reconstruidos sin forzar nodos sin sitio; `@dir` es
  una preferencia (nunca error ni choque, avisa si no se respeta).
- **Visor**: móvil (gestos), paso a paso con la historia real de cada paso, tocar un empalme
  lleva a su dueño, exportar SVG/PNG, botón «Mermaid» **sin internet** (Mermaid incrustado en el
  HTML; `--ligero` lo quita y oculta el botón).
- **Comando `dmk`** (Node): HTML + navegador, `--watch`, `--svg`/`--png` sin navegador (texto
  medido y pintado con DejaVu; PNG con resvg WASM), `--html`, `--servidor`, `--ligero`,
  entrada por tubería o `<<EOF`.
- **Pastillas de id** con el fondo al 80 % de opacidad (dejan ver la forma de debajo).
- **Dirección** (`flowchart TB/TD/BT/LR/RL`, `direction` dentro de un subgraph): decide hacia dónde
  van los diagramas de los subgraphs y los grupos desconectados. Sin dirección es TB, como en
  Mermaid (antes todo iba en fila a la derecha, como LR). Los nodos y aristas de salida llevan
  `diagram` (índice del diagrama), que usa el comprobador de los tests aleatorios. Ejemplo:
  `examples/direcciones_{TB,BT,LR,RL}.mmd`. `dmk` avisa al abrir el navegador (con qué orden, si
  falla, mientras espera y cuando la página llega).
- **Tests**: 106 en Node (incluye 400 diagramas aleatorios, sin fallos conocidos; por encima de
  400 aún fallan, entre otras, 889, 1247, 1281, 1400, 1665 y 1728) + 8 en Python. `tools/comparar.js` genera imágenes antes/después.
- **Ahorro de tokens**: `CLAUDE.md` corto con comandos y mapa del layout;
  `.claude/settings.json` bloquea leer `node_modules/`, `vendor/`, `examples/*.html`.
- **`src/layout.js` dividido en módulos UMD** (patrón returnExports de umdjs/umd) en `src/layout/`:
  funcionan con `require` y pegados en el HTML sin compilar. Resultado idéntico al de antes en los
  ejemplos y 2.000 diagramas aleatorios. En el navegador la API queda en `DiagramLayout`.

- **Utilidades** (2026-10-03): `dmk --comprobar` (`-c`, valida sin dibujar), varios archivos a
  la vez (cada resultado junto a su .mmd; sin `-o` ni `--watch`), tema oscuro (`--tema
  claro|oscuro|auto`, `--oscuro`; `DARK_THEME` en render.js, `data-theme` en la plantilla, botón ◐
  del visor recordado en localStorage; SVG/PNG en claro salvo `--tema oscuro`).
- **Entradas y apertura** (2026-10-04): `dmk` abre el HTML como archivo (`xdg-open`…); en Termux
  siempre con el servidor (Edge no lee `content://com.termux.files`, ni siquiera en Download: probado
  `file://`, ruta sola y MediaStore sin éxito); `--servidor` lo fuerza fuera de Termux
  (`--sin-servidor` se acepta y no hace nada). Entradas `.md` (cada bloque mermaid) y carpetas (sin
  subcarpetas), en lib/entradas.js (`expandir`). Varios diagramas en HTML: una página con selector
  (`source` es una lista `[{title, source}]` en el visor, `#picker`); SVG/PNG: `nombre-N`.
- **Opciones en inglés y `--engine`** (2026-10-04): `--output`, `--scale`, `--server`, `--theme
  light|dark|auto`, `--dark`, `--check`, `--lite` (antes `--ligero`/`--light`), `--no-open`,
  `--help`; las españolas siguen aceptándose sin documentar. `-e/--engine main|jesjack` llega a
  `layoutDiagram` en exportar.js (SVG/PNG/--check) y al visor (`engine` en `DiagramViewer.start`).
  Instalado en Windows con `npm link` (ahí `dmk` funciona directo).

### Pendiente

1. **Estética**: nodos con aspecto de "pegatina" (generar variantes en PNG para que elija) y
   ajustes de la interfaz.
2. **Paquete pip**: envoltorio que llame a `dmk` (publicar en PyPI con su cuenta).
3. **Layout**: rotación "como engranajes" (el usuario la ve más sofisticada que solo girar bloques:
   hablarlo antes); semillas >400 que fallan (ver Tests); referencias repetidas entre subgraphs.
4. TODO de SPEC.md: estilos de subgraph.
5. Sin probar en navegador por el agente: `dmk` + `--watch` en el móvil; el selector de varios
   diagramas.
6. **`direction` para el crecimiento de cada árbol** (que `flowchart LR` haga crecer las ramas hacia
   la derecha): de momento la dirección solo coloca los subgraphs y los grupos desconectados.
7. **jesjack engine** (`src/engines/jesjack.js`): motor de colocación desde cero, alternativo a
   main engine, con **cada decisión auditada por el usuario** (proponer alternativas, no decidir).
   Recibe nodos y conexiones crudos y decide él los empalmes; contrato en la cabecera del archivo,
   adaptador `layoutJesjack` en src/layout.js (`layoutDiagram(g, { engine: "jesjack" })`; `dmk -e jesjack`).
   Progreso: `node --test tests/jesjack.test.js` (primera semilla que falla y cuántas de 400 pasan);
   detalle de una: `node tests/jesjack.test.js <semilla>`. Estado: vacío (0/400).

## Decisiones y preferencias del usuario

- Lo usa sobre todo desde un **móvil Android con Termux** y Edge; también un PC Linux (Edge flatpak,
  por eso el mini servidor en 127.0.0.1 en vez de `file://`).
- Revisa los arreglos **visualmente**: para cada arreglo se le genera un PNG "antes / después"
  (`tools/comparar.js`) en `/storage/emulated/0/Pictures/diagram_maker/arreglos/`, pero el agente
  **no abre** esas imágenes (ahorro de tokens): comprueba con datos. Sí mira sus capturas.
- Le gustó la sombra difuminada (la "pegatina gris" sin desenfoque no), los empalmes como pastillas
  con el id de su dueño y las pastillas de id siempre visibles (también al exportar).
- Subgraphs sin cajas; no pisar nunca un nodo ni una línea está por encima del orden de salidas.
- Se probó con agentes en paralelo (worktrees aislados): funciona bien para tareas con archivos
  disjuntos; los agentes se pudieron escribir entre sí con `SendMessage`.
- Commits con `git -c user.name="Edgar Jesús Moreno Castañeda" -c user.email="jesjack25_03@hotmail.com"`
  (no hay identidad global configurada en Termux).
- Quiere ahorrar tokens (plan Pro): sesiones cortas por tema, salidas filtradas, subagentes solo
  para tareas grandes. Ver `CLAUDE.md`.

Notas del entorno: en Termux `node` está en el PATH; en el PC, Node v24 con nvm en `~/.config/nvm`
(`export PATH=$HOME/.config/nvm/versions/node/v24.21.0/bin:$PATH`).
