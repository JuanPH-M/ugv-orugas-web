# UGV de orugas · gemelo digital

Sitio web del prototipo de vehículo terrestre autónomo de orugas para el transporte de carga (Corporación Universitaria Rafael Núñez, 2025).

Tiene cuatro secciones:

| Sección | Qué hace |
| --- | --- |
| **Simulador** | Robot en 3D con el control de la app real: joystick, ruta, velocidad máxima, Luces, Bocina, Parar, Volver al inicio y Borrar ruta. Incluye modo automático con Pure Pursuit sobre marcadores ArUco, vista desde la cámara del robot, cables en 3D y piezas que se pueden mover. |
| **Circuito** | Esquema interactivo con el cableado ESP32 → L298N → motores. Se pueden agregar piezas, conectar pines y borrar cables. Una revisión eléctrica avisa de cortocircuitos y de tensiones peligrosas en los GPIO. |
| **Piezas** | Catálogo con modelo 3D, especificaciones, pines y conexiones de cada pieza, montada o faltante. |
| **Proyecto** | Resumen del trabajo, arquitectura y supuestos del modelo. |

## Cómo abrirlo

**Sin instalar nada:** abre `index.html` con doble clic. Funciona sin internet; con internet carga además las fuentes tipográficas.

**Con un servidor local** (opcional):

```bash
python -m http.server 8000
```

y entra a `http://localhost:8000`.

## Publicarlo en GitHub Pages

1. Crea un repositorio en GitHub y sube esta carpeta.
2. En el repositorio: **Settings → Pages → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. La página queda en `https://<usuario>.github.io/<repositorio>/`.

## Estructura

```
index.html        página principal
css/styles.css    estilos (tema claro y oscuro)
js/data.js        piezas, pines y conexiones  ← aquí se cambian datos
js/models.js      modelos 3D de cada pieza
js/state.js       estado guardado y revisión eléctrica
js/sim.js         simulador 3D, física y control
js/circuit.js     esquema interactivo
js/catalog.js     catálogo de piezas
js/app.js         interfaz y pestañas
vendor/           three.js r147 (copia local, licencia MIT)
```

## Supuestos del modelo

Valores tomados de las fichas del vendedor o estimados; conviene medirlos y actualizarlos en `js/data.js` y `js/sim.js` (objeto `P`).

| Dato | Valor | Origen |
| --- | --- | --- |
| Chasis | 180 × 165 × 60 mm, 482 g | Ficha del vendedor |
| Motores | 9–12 V, 3,5 kg·cm, 100 mA sin carga, 350 RPM a 12 V | Ficha del vendedor |
| Rueda de tracción | ≈ 52 mm | Estimado de fotos |
| Baterías | 2 × 18650 de 3,7 V en serie (7,4 V), 2600 mAh | Código LGABB41865, verificar |
| Caída del L298N | 1,8 V | Típico |
| Corriente por motor | 0,1 A + 0,9 A × PWM | Estimado, medir |
| Deslizamiento χ | 1,6 | Ajustable en el simulador |

Los cambios (piezas montadas, posiciones y cables) se guardan en el navegador. El botón **Restablecer todo** en la pestaña Proyecto vuelve a la configuración original.
