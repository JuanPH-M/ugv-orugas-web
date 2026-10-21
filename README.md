# UGV de orugas · gemelo digital en la finca

Sitio web del prototipo de vehículo terrestre de orugas, de bajo costo, que **transporta la cosecha** desde el cultivo hasta el punto de acopio en fincas colombianas (Corporación Universitaria Rafael Núñez, versión 3, 2026). El robot **no recolecta**: lleva lo que los trabajadores ya cosecharon, se maneja a distancia o recorre una misión por puntos (A → B → C → acopio), y la **Raspberry Pi** es su unidad central.

## Abrir la página

**▶ [https://juanph-m.github.io/ugv-orugas-web/](https://juanph-m.github.io/ugv-orugas-web/)**

Funciona en el computador y en el celular, en Chrome, Edge, Firefox o Safari actualizados.

**Sin internet:** descarga el proyecto (botón verde **Code → Download ZIP** en GitHub), descomprímelo y abre `index.html` con doble clic.

El informe completo está en [`docs/informe-version-3.pdf`](docs/informe-version-3.pdf) (también en Word: [`docs/informe-version-3.docx`](docs/informe-version-3.docx)).

## Qué tiene

| Sección | Para qué sirve |
| --- | --- |
| **Simulador** | Parcela de 36 × 36 m con dos lotes de café (uno en ladera de 10° y 15°), camino de servicio, barro, árboles de sombrío, recolectores y un acopio con báscula. El robot se maneja con joystick o teclado, o ejecuta la **misión por puntos**: espera la carga en A, la lleva al acopio, espera la descarga y vuelve. Localización con **GNSS** (autónomo ≈ 2 m o RTK ≈ 2 cm, peor bajo los árboles), encoders, IMU y ArUco en el acopio. Estados del informe: espera, manual, autónomo, pausa, retorno y **parada de emergencia** (pulsador o enlace LoRa perdido por más de 1 s). Baterías de 2 o 3 celdas, carga de 0 a 2 kg, bultos como obstáculos, gráficas, CSV y fotos. |
| **Circuito** | Esquema interactivo con la Raspberry Pi unida a la ESP32 por UART (GPIO 14/15 ↔ RX2/TX2), receptor GNSS por USB, radio LoRa en GPIO 18/19, paro de emergencia en la línea del L298N y DC-DC de 5 V para la lógica. La revisión eléctrica avisa de cortocircuitos, tensiones peligrosas y enlaces faltantes. |
| **Programas** | Genera el **firmware de la ESP32** con los pines del cableado (lazo de motores, tramas con CRC-16 hacia la Raspberry Pi, watchdog de 300 ms, LoRa, ultrasonido y paro) y el **programa de la Raspberry Pi** en Python (GNSS, filtro de Kalman, Pure Pursuit, misión y registro), más la misión en JSON. |
| **Piezas** | Ficha de cada pieza con modelo 3D, especificaciones, pines y conexiones. |
| **Pruebas** | Banco de pruebas del protocolo del informe en la finca virtual: recto, giro, barro, ladera con carga, misión completa, calle entre surcos con GNSS autónomo y con RTK, frenado ante un bulto, corte del enlace y autonomía con 2 y 3 celdas. Tabla para copiar a Word o Excel. |
| **Proyecto** | Resumen, arquitectura, supuestos del modelo, presupuesto con los precios verificados del informe y enlace al documento. |

Los cambios (piezas, posiciones, cables, bultos, precios y opciones) se guardan en el navegador. **Proyecto → Restablecer todo** vuelve a la configuración original.

## Supuestos del modelo

Valores de las fichas del vendedor, del informe o estimados; cuando los midan, se actualizan en `js/sim.js` (objetos `P` y `SOIL`) y `js/data.js`.

| Dato | Valor | Origen |
| --- | --- | --- |
| Chasis | 180 × 165 × 60 mm, 482 g | Ficha del vendedor |
| Motores | 9–12 V, 3,5 kg·cm, 100 mA sin carga, 350 RPM a 12 V | Ficha del vendedor |
| Rueda de tracción | ≈ 52 mm | Estimado de fotos |
| Baterías | 2 × 18650 en serie (7,4 V) hoy; 3 recomendadas (11,1 V) | Informe, sección 10.8 |
| Caída del L298N | 1,8 V | Hoja de datos (≈ 1,8 V a 1 A) |
| Rodadura | 0,08 camino · 0,10 lote · 0,15 barro | Informe (0,06–0,1 medido; 0,15 conservador) |
| GNSS | σ ≈ 1,7 m autónomo · 2 cm RTK · ×3 bajo árboles | NEO-M8N ≈ 2 m CEP; ZED-F9P 0,01 m + 1 ppm |
| Ultrasonido | reduce < 150 cm · frena < 60 cm | Informe, tabla 18 |
| Diferencia entre motores | 2 % | Estimado |
| Deslizamiento χ | 1,6 en camino (× 1,1 lote, × 1,3 barro) | Ajustable; el filtro lo estima en línea |

## Desarrollo

No hay compilación ni dependencias: es HTML, CSS y JavaScript con [three.js](https://threejs.org/) en `vendor/`.

```bash
npm start      # sirve la página en http://localhost:8765 (usa Python)
npm test       # pruebas automáticas del modelo, el análisis eléctrico y los generadores de código
```

Las pruebas (`tests/run.js`) corren en Node sin navegador: revisan que todas las conexiones apunten a pines existentes, que el montaje para la finca no tenga peligros eléctricos, que el paro de emergencia corte solo la potencia de los motores, que el firmware tenga los pines y el protocolo correctos, que el CRC sea el de CRC-16/CCITT-FALSE y que el programa Python de la Raspberry Pi compile. GitHub Actions las ejecuta en cada envío (`.github/workflows/pruebas.yml`).

Estructura:

```
index.html          interfaz
css/styles.css      estilos (tema claro y oscuro)
js/data.js          piezas, pines y conexiones
js/state.js         estado guardado y análisis eléctrico
js/models.js        modelos 3D de las piezas
js/sim.js           finca, física, GNSS, filtro, misión y banco de pruebas
js/circuit.js       esquema interactivo
js/catalog.js       fichas de las piezas
js/code.js          firmware de la ESP32
js/codepi.js        programa de la Raspberry Pi y misión en JSON
js/app.js           pestañas, controles y telemetría
docs/               informe, versión 3 (PDF y Word) y diagrama de conexiones
tests/run.js        pruebas automáticas
```

Al cambiar un archivo de `js/` o `css/`, sube el número `?v=` en `index.html` para que los navegadores no usen la versión vieja.
