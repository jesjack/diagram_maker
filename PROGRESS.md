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
src/layout.js         reglas de colocación -> rejilla -> coordenadas; historia del paso a paso
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

### Hecho

- **Fase 1, prototipo**: parser con errores por línea, layout en rejilla, render SVG, visor y CLI.
- **Fase 2, estética** (en parte): sombra difuminada pintada una vez en un canvas (rendimiento),
  diagrama sin fondo sobre rejilla de puntos, barra translúcida, pastillas con el id de cada nodo,
  estilos de Mermaid (`classDef`, `:::`, `class`, `style`, `linkStyle`) pasados tal cual al SVG.
- **Formas**: rectángulo, redondeado, estadio, círculo, rombo, hexágono, cilindro, subrutina y los
  dos paralelogramos.
- **Subgraphs**: cada uno es un diagrama aparte, en fila; referencias en ambos lados, nodos
  absorbidos, títulos.
- **Layout sin choques ni diagonales** (reglas 4 y 9–14 de SPEC.md): recorrido en profundidad con
  reserva de celdas, empalmes para más de 4 conexiones, cascada para hacer sitio (extensión flexible
  → desplazar el bloque mínimo validado con las posiciones finales → fila/columna entera), copias de
  hojas, conectores, reutilizar representantes al lado, grupos reconstruidos desde su conexión.
  `@dir` es una preferencia: nunca error ni choque, avisa si no se respeta.
- **Visor**: móvil (un dedo arrastra, dos hacen zoom, doble toque ajusta), paso a paso con la
  historia real de cada paso y su motivo, tocar la pastilla de un empalme lleva a su nodo, exportar
  SVG/PNG, botón para comparar con Mermaid oficial.
- **CLI**: `--watch` (recarga en vivo conservando zoom y posición), apertura en Termux con
  `termux-open-url`.
- **Tests**: 83 en Node, incluidos 400 diagramas aleatorios con reductor de casos
  (`node tests/random-diagrams.js <semilla> reducir`); solo falla la semilla 111 (registrada como
  conocida).

### Pendiente

1. **Herramienta seria** (lo siguiente que pidió el usuario):
   - comando global de consola;
   - paquetes de npm y pip;
   - exportar directamente a SVG/PNG desde el comando;
   - opción de generar el HTML y abrir el archivo sin levantar servidor;
   - otras utilidades.
   Hay que decidir antes dónde corre el motor fuera del navegador: es JavaScript, así que exportar
   desde la consola necesita Node (y medir el texto sin canvas, por estimación).
2. **Estética**: nodos con aspecto de "pegatina" y ajustes de la interfaz.
3. **Rotación "como engranajes"**: girar subárboles ya colocados para evitar empalmes, como pasada
   final que nunca empeore el diagrama, y visible como pasos propios en el paso a paso.
4. Semilla 111 (flechas sobre nodos).
5. Diagramas con muchos subgraphs quedan muy anchos (en fila): quizá varias filas.
6. Referencias repetidas cuando varios nodos lejanos apuntan al mismo nodo de otro subgraph.
7. Ordenar `src/layout.js` (~1500 líneas) apoyándose en los tests aleatorios.
8. TODO de SPEC.md: estilos de subgraph, `@bus`, `flowchart LR`.

## Decisiones y preferencias del usuario

- Lo usa sobre todo desde un **móvil Android con Termux** y Edge; también un PC Linux (Edge flatpak,
  por eso el mini servidor en 127.0.0.1 en vez de `file://`).
- Revisa los arreglos **visualmente**: para cada arreglo se le genera un PNG "antes / después"
  (`rsvg-convert` está disponible en Termux) y se le enseñan los casos difíciles antes de decidir.
- Le gustó la sombra difuminada (la "pegatina gris" sin desenfoque no), los empalmes como pastillas
  con el id de su dueño y las pastillas de id siempre visibles (también al exportar).
- Subgraphs sin cajas; no pisar nunca un nodo ni una línea está por encima del orden de salidas.
- Se probó con agentes en paralelo (worktrees aislados): funciona bien para tareas con archivos
  disjuntos; los agentes se pudieron escribir entre sí con `SendMessage`.
- Commits con `git -c user.name="Edgar Jesús Moreno Castañeda" -c user.email="jesjack25_03@hotmail.com"`
  (no hay identidad global configurada en Termux).

Notas del entorno: en Termux `node` está en el PATH; en el PC, Node v24 con nvm en `~/.config/nvm`
(`export PATH=$HOME/.config/nvm/versions/node/v24.21.0/bin:$PATH`).
