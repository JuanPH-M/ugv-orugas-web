# UGV de orugas · gemelo digital y programa de la Raspberry Pi

Sitio web y software del **prototipo a escala** de vehículo terrestre de orugas (Corporación Universitaria Rafael Núñez, 2026). Es un chasis de unos 180 × 165 × 60 mm con carga útil máxima de 2 kg que se prueba en banco, sobre superficie firme, en tierra y en arena. No transporta cosecha real: el transporte de la cosecha en fincas es la motivación y una posible versión futura.

**Diseño final:** la **Raspberry Pi 3 Model B controla directamente el puente H L298N** (se retiró la ESP32). Solo seis elementos: Raspberry Pi, L298N, 2 baterías de 3,7 V en serie (7,4 V), convertidor DC-DC de 5 V / 3 A, chasis con 2 motores DC y cables.

## Abrir la página

**▶ [https://juanph-m.github.io/ugv-orugas-web/](https://juanph-m.github.io/ugv-orugas-web/)**

Funciona en el computador y en el celular. **Sin internet:** descarga el proyecto (**Code → Download ZIP**), descomprímelo y abre `index.html`.

El diagrama de conexiones final está en [`docs/diagrama-conexiones-final.png`](docs/diagrama-conexiones-final.png).

## Programa real de la Raspberry Pi

La carpeta [`raspberry/`](raspberry/) tiene el programa que corre en el prototipo, listo para instalar (instrucciones en [`raspberry/README.md`](raspberry/README.md)):

- `ugv.py` y el paquete `robot/`: programa modular (configuración, motores, navegación, mapa, misiones, rutas, seguridad, servidor y registro). **PWM por hardware** en GPIO 12 (ENA) y GPIO 13 (ENB), sentido de giro en GPIO 17, 27, 22 y 23, **tres modos: manual, autónomo y temporal autónomo**, rutas en **metros y grados**, por **coordenadas** o por los puntos de la finca (sin pisar cultivos), rutas guardadas con **versión**, pausa y reanudar, **PIN**, WebSocket, **parada si dejan de llegar órdenes** y registro CSV. Sin sensores: la posición se **estima** con la calibración. Solo usa Python 3 y `gpiozero`, que ya vienen en Raspberry Pi OS: todo gratis.
- `finca.json`: el mapa de la finca (puntos, caminos y lotes). El mismo archivo lo usa el simulador.
- `web/index.html`: el **panel del operador** (celular o computador): flechas, misión en curso con progreso, pausar/reanudar/tomar control manual, mapa con la posición estimada, editor de rutas (metros y grados, coordenadas tocando el mapa, tramos), modo temporal, calibración, cámara del celular a bordo, datos de la prueba y alertas. `web/abordo.html`: página **opcional** para un celular sujeto al robot (rumbo para giros exactos, parada por golpe o vuelco, GPS y cámara).
- `instalar.sh`, `actualizar.sh`, `ugv.service` y `config.json`: instalación con un comando (crea el PIN y la red Wi-Fi **UGV-Orugas**, panel en `http://10.42.0.1`), arranque automático y **actualización desde GitHub** que solo instala si pasan las 49 pruebas.

```bash
python3 raspberry/ugv.py --simular          # probarlo sin hardware: http://localhost:8080 (PIN 1234)
```

## Qué tiene el sitio

| Sección | Para qué sirve |
| --- | --- |
| **Simulador** | Una **finca colombiana**: cafetal, platanera, maizal y huerta de yuca y fríjol, caminos de tierra de 1,6 m, **almacén de la cosecha**, **puesto del robot** con cargador, casa con techo de teja, guaduales, árboles, cerca de alambre y colinas, más un patio de pruebas (firme, tierra, arena y rampa) y la mesa del banco. El robot ejecuta **la misma lógica del programa real**: control remoto (el joystick hace de celular), **modos autónomo y temporal autónomo** (recorrido completo con 1 s de espera en cada punto, desde cero, esperar tu orden y siguiente punto, ir directo a un punto, rutas en metros y grados y por coordenadas, pausa y reanudar) solo por los caminos, y recorrido por tramos. «Cultivos tocados» cuenta si el robot se sale del camino. Se puede cortar el Wi-Fi, **bloquear el programa** y **desconectar la batería**. |
| **Circuito** | Esquema interactivo del diagrama final. La revisión eléctrica avisa si llegan 5 V a un GPIO, si falta la tierra común o si la Raspberry Pi se alimenta del 5 V del L298N. Desde aquí se ve y se descarga el programa de la Raspberry Pi. |
| **Piezas** | Ficha de cada pieza con modelo 3D, especificaciones, pines y conexiones. |
| **Pruebas** | Protocolo P1–P10 simulado: motores en banco, línea recta y giro en cada superficie, carga de 0, 1 y 2 kg, rampa, detención sin órdenes, recorrido A-B-C, consumo y calor en el L298N. Son valores de un modelo con supuestos: sirven para preparar el protocolo, no para el informe. |
| **Proyecto** | Objetivo, diseño final, supuestos del modelo y presupuesto (solo materiales del diagrama; lo no consultado queda «[completar]»). |

Los cambios (posiciones, cables, precios y opciones) se guardan en el navegador. **Proyecto → Restablecer todo** vuelve a la configuración original.

## Desarrollo

No hay compilación: HTML, CSS y JavaScript con [three.js](https://threejs.org/) en `vendor/`.

```bash
npm start            # sirve la página en http://localhost:8765 (usa Python)
npm run raspberry    # programa de la Raspberry Pi con pines simulados en http://localhost:8080
npm run empaquetar   # copia raspberry/ dentro de js/codepi.js (después de editar el programa)
npm test             # pruebas automáticas
```

`npm test` revisa que el cableado sea exactamente el del diagrama final, que ningún camino del mapa pase por los cultivos, que el planificador del simulador (`js/auto.js`) dé **los mismos pasos** que el de la Raspberry Pi, que el análisis eléctrico detecte los errores típicos, que `js/codepi.js` esté al día con `raspberry/` y ejecuta las **pruebas de extremo a extremo del servidor real** (`raspberry/test_ugv.py`, 49 pruebas: PIN y sesiones, pines del L298N, rampa, parada sin órdenes, WebSocket, rutas con versión, modos autónomo y temporal, pausa y reanudar, coordenadas que pisan un lote, calibración, celular a bordo con giro en lazo cerrado, HTTPS y registro CSV). GitHub Actions las corre en cada envío.

```
index.html             interfaz
css/styles.css         estilos (tema claro y oscuro)
js/data.js             piezas, pines y conexiones del diagrama final
js/state.js            estado guardado y análisis eléctrico
js/models.js           modelos 3D
js/finca3d.js          la finca en 3D (lotes, caminos, almacén, puesto, casa, árboles y colinas)
js/auto.js             planificación del modo autónomo (la misma de raspberry/robot/navegacion.py)
js/sim.js              física y programa de la Raspberry Pi simulado
js/circuit.js          esquema interactivo
js/catalog.js          catálogo de piezas
js/codepi.js           copia de raspberry/ para verla y descargarla desde la página (generado)
js/app.js              interfaz
raspberry/             programa real de la Raspberry Pi
tools/empaquetar.js    genera js/codepi.js
tests/run.js           pruebas automáticas
docs/                  informe y diagrama de conexiones
```
