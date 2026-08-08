# Sim Studio

Sim Studio es un editor 3D experimental para construir mecanismos compatibles con piezas LEGO® Technic y probar su comportamiento físico directamente en el navegador. Permite colocar modelos LDraw, conectarlos mediante pines y ejes, fijar piezas, configurar cada unión y ejecutar una simulación con gravedad, colisiones y motores.

> El proyecto está en desarrollo. No es una herramienta oficial de LEGO Group ni de BrickLink Studio.

## Funciones principales

- Catálogo organizado de vigas, ejes, pines, conectores, engranajes y ruedas.
- Modelos 3D cargados desde la biblioteca LDraw.
- Búsqueda por nombre o referencia y carga de referencias externas.
- Arrastrar piezas desde la paleta hasta la zona de construcción.
- Movimiento y rotación de piezas colocadas.
- Importación de modelos `.ldr` y `.mpd`.
- Exportación del montaje como archivo `.ldr`.
- Tema claro y oscuro, incluido el entorno 3D.
- Simulación con gravedad, rozamiento, colisiones, uniones y arrastre mediante resorte.
- Piezas fijables con `Alt + clic`.
- Restauración automática del montaje al detener la simulación.
- Registro JSON de cada simulación.
- Visualización de colliders, conectores, cuerpos físicos, pivotes y uniones.

## Sistema Connect

El mapa de conexiones utiliza cuatro tipos visuales:

| Color | Tipo | Compatibilidad |
| --- | --- | --- |
| Azul | Agujero redondo | Pines naranjas y ejes morados |
| Naranja | Punto macho de pin | Agujeros azules |
| Verde | Agujero en cruz | Ejes morados |
| Morado | Recorrido utilizable de un eje | Agujeros verdes y azules |

El autoconectado alinea únicamente los ejes necesarios y conserva la rotación que la pieza ya tenía alrededor de ellos. Los centros de conexión de los pines se ajustan a posiciones LEGO de medio stud para evitar la superposición de piezas.

Las piezas mixtas, como un `axle pin` o un eje con agujero perpendicular, pueden contener conectores macho y hembra simultáneamente.

### Modos de unión

Cada unión se configura por separado desde el panel de propiedades. Sólo aparecen los modos compatibles con su geometría:

| Unión | Fija | Rotación | Lineal | Rotación + lineal | Motor |
| --- | :---: | :---: | :---: | :---: | :---: |
| Pin naranja ↔ agujero azul | ✓ | ✓ | — | — | ✓ |
| Eje morado ↔ agujero verde | ✓ | — | ✓ | — | — |
| Eje morado ↔ agujero azul | ✓ | ✓ | ✓ | ✓ | ✓ |

El modo **Motor** crea una unión rotatoria accionada. Su deslizador permite elegir velocidad y sentido entre `-12` y `12 rad/s`. Las configuraciones se conservan al cambiar de selección y cuando el autoconectado reconstruye una unión durante la sesión.

## Colliders simplificados

La malla LDraw visible se mantiene completa, pero la física utiliza colliders compuestos más ligeros. El análisis se realiza automáticamente cuando se carga una pieza del catálogo y el resultado se guarda en caché para reutilizarlo.

Según la geometría detectada se generan:

- Vigas rectas: caja longitudinal y remates cilíndricos.
- Vigas en L, T o formas angulares: varias cajas siguiendo sus tramos y cilindros en extremos o intersecciones.
- Pines y ejes: uno o dos cilindros, incluyendo topes o casquillos cuando corresponde.
- Ruedas, engranajes y casquillos: cilindros.
- Otras piezas: una aproximación por caja ajustada.

Puedes revisar el resultado activando **Mallas de colisión** en el panel de propiedades.

## Controles

| Acción | Control |
| --- | --- |
| Colocar una pieza | Arrastrarla desde la paleta hasta la mesa |
| Seleccionar | Clic sobre una pieza |
| Mover en X/Z | Arrastrar una pieza colocada |
| Mover en Y | `Shift` + arrastrar |
| Orbitar la cámara | Botón derecho o `Alt` + arrastrar |
| Zoom | Rueda del ratón |
| Fijar o liberar una pieza | `Alt` + clic |
| Aplicar fuerza en simulación | Arrastrar desde un punto de la pieza |
| Rotar 90° | Botones X, Y o Z del panel de propiedades |

## Instalación

Requiere Node.js `22.13.0` o posterior.

```bash
git clone https://github.com/WorketeWorks/SimStudio.git
cd SimStudio
npm install
npm run dev
```

Abre la dirección local que aparece en la terminal.

## Comandos

```bash
npm run dev      # servidor de desarrollo
npm run build    # compilación de producción
npm run start    # ejecutar la compilación
npm run lint     # análisis estático
npm test         # compilación y pruebas automatizadas
```

## Tecnologías

- React 19 y TypeScript.
- Three.js para renderizado 3D y carga de modelos LDraw.
- Rapier 3D para cuerpos rígidos, colliders y uniones físicas.
- Vinext y Vite para desarrollo y compilación.
- Cloudflare Workers/Sites como entorno de despliegue compatible.

## Estructura relevante

```text
app/
├── page.tsx          # editor, interacción, autoconectado y simulación
├── connectors.ts     # detección Connect y cálculo de colliders
├── palette.ts        # piezas incluidas en la paleta
├── ldraw.ts          # importación y exportación LDraw
├── globals.css       # interfaz y temas
└── api/parts/        # búsqueda de referencias externas
```

## Importación, exportación y datos

- La importación reconstruye posición, orientación, referencia y color de las piezas LDraw.
- La exportación genera `sim-studio-model.ldr`.
- LDraw no almacena los modos físicos propios de Sim Studio; actualmente esos ajustes no se incluyen en el archivo exportado.
- El último registro físico se conserva en el navegador y puede descargarse como `sim-studio-physics-log.json`.
- La biblioteca de piezas y sus miniaturas se descargan desde servicios LDraw, por lo que la primera carga necesita conexión a Internet.

## Limitaciones actuales

- La detección de conectores en piezas irregulares es geométrica y puede necesitar ajustes para referencias concretas.
- Los colliders son aproximaciones optimizadas para simulación, no geometría de fabricación.
- Las uniones y motores son un sistema experimental y pueden requerir más estabilización en mecanismos grandes.
- GitHub puede alojar el código, pero GitHub Pages estático no ejecuta la ruta dinámica de búsqueda `/api/parts`. Para conservar todas las funciones usa un despliegue compatible con Workers o servidor Node.

## Créditos y licencia de marcas

Los modelos de piezas proceden del ecosistema [LDraw](https://www.ldraw.org/). LEGO® es una marca registrada de LEGO Group. Este proyecto es independiente y no está patrocinado, autorizado ni respaldado por LEGO Group o BrickLink Studio.
