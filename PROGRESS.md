# Progreso del proyecto

Archivo para retomar el trabajo (con cualquier persona o modelo de IA).
La especificación completa está en [`SPEC.md`](SPEC.md). Léela primero.

## Cómo retomar

1. Lee `SPEC.md` (reglas acordadas) y este archivo (estado actual).
2. Busca abajo el primer paso sin marcar `[ ]`: ahí es donde se quedó el trabajo.
3. Revisa `git log` para ver los últimos cambios.
4. Al terminar un paso: márcalo `[x]`, actualiza "Último estado" y haz commit.

Prompt sugerido para otro modelo:

> Estoy construyendo un generador de diagramas (repo: github.com/jesjack/diagram_maker).
> Lee SPEC.md y PROGRESS.md y continúa desde el primer paso pendiente de la Fase 1.
> No cambies las reglas de SPEC.md sin preguntarme.

## Estructura de archivos (planeada)

```
diagram.py          CLI en Python (sin dependencias): lee .mmd, genera HTML, abre navegador
src/parser.js       texto Mermaid -> { nodes, edges, meta }
src/layout.js       aplica reglas de dirección -> coordenadas x,y de cada nodo
src/render.js       dibuja el SVG (formas, líneas rectas con flecha, etiquetas)
src/viewer.js       zoom con scroll, arrastre, exportar PNG/SVG
src/template.html   plantilla; el CLI incrusta los .js y el código del diagrama
examples/           diagramas de prueba (.mmd)
tests/              tests con el runner integrado de Node: `node --test`
```

El CLI concatena los `.js` dentro de `template.html`, así que el HTML generado es un único archivo autocontenido.

## Fase 1: prototipo

- [x] 1. **Parser**: texto Mermaid -> nodos, aristas y metadatos `@dir`. Errores claros con número de línea.
- [x] 2. **Layout**: reglas de dirección de SPEC.md -> coordenadas.
- [x] 3. **Render SVG**: 4 formas (rectángulo, círculo, rombo, cilindro), líneas rectas con flecha, etiquetas.
- [x] 4. **Visor**: zoom con scroll, arrastre, exportar PNG y SVG.
- [x] 5. **CLI Python**: `python3 diagram.py archivo.mmd` o texto escrito en la terminal -> HTML -> navegador.

Caso de prueba principal: el ejemplo "Inicio App" de SPEC.md (se guardará en `examples/inicio_app.mmd`).

## Fases siguientes

- Fase 2: estética (formas, colores, tipografía, etiquetas).
- Fase 3: TODOs de SPEC.md (bucles, choques entre ramas, más de 3 salidas), más formas, recarga en vivo.

## Último estado

2026-09-30: **Fase 1 completa** (pasos 1-5). Probar con:

    python3 diagram.py examples/inicio_app.mmd

Pendiente: que el usuario revise el visor en su navegador y dé su opinión antes de pasar a la Fase 2.

Notas:
- El CLI abre la página con un mini servidor en 127.0.0.1 que sirve una sola vez y termina, porque el
  navegador del usuario (Edge por flatpak) no tiene acceso a carpetas fuera de Descargas/Documentos.
  El HTML también se guarda en disco (junto al .mmd, o con `-o`).
- Los .html generados están en .gitignore.

Notas del entorno: Node v24 instalado con nvm en `~/.config/nvm` (si `node` no se encuentra:
`export PATH=$HOME/.config/nvm/versions/node/v24.21.0/bin:$PATH`).
