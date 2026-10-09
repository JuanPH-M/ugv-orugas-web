# UGV de orugas · gemelo digital

Sitio web del prototipo de vehículo terrestre autónomo de orugas para el transporte de carga (Corporación Universitaria Rafael Núñez, 2025).

## Abrir la página

**▶ [https://juanph-m.github.io/ugv-orugas-web/](https://juanph-m.github.io/ugv-orugas-web/)**

Funciona en el computador y en el celular, en Chrome, Edge, Firefox o Safari actualizados.

**Sin internet:** descarga el proyecto (botón verde **Code → Download ZIP** en GitHub), descomprímelo y abre `index.html` con doble clic.

## Qué tiene

| Sección | Para qué sirve |
| --- | --- |
| **Simulador** | Robot en 3D, montado como el real: caja blanca adelante, portapilas atrás, L298N al centro y cables con sus colores. Se maneja como la app del robot (joystick, ruta, velocidad máxima, Luces, Bocina, Parar, Volver al inicio). Tiene modo automático con Pure Pursuit, rutas que se dibujan en el piso, carga de 0 a 2 kg, cajas como obstáculos, gráficas en vivo, descarga de datos en CSV y fotos de la vista. |
| **Circuito** | Esquema interactivo ESP32 → L298N → motores. Se agregan piezas, se conectan pines y se borran cables; la revisión eléctrica avisa de cortocircuitos y tensiones peligrosas. Genera el programa base de la ESP32 con los pines del cableado. |
| **Piezas** | Ficha de cada pieza con modelo 3D, especificaciones, pines y conexiones. |
| **Pruebas** | Banco de pruebas simulado (recto, giro, seguimiento de ruta, frenado, carga y autonomía) con tabla para copiar a Word o Excel. |
| **Proyecto** | Resumen, arquitectura, supuestos del modelo y presupuesto con precios editables. |

Los cambios (piezas, posiciones, cables, cajas y precios) se guardan en el navegador. **Proyecto → Restablecer todo** vuelve a la configuración original.

## Supuestos del modelo

Valores de las fichas del vendedor o estimados; cuando los midan, se actualizan en `js/sim.js` (objeto `P`) y `js/data.js`.

| Dato | Valor | Origen |
| --- | --- | --- |
| Chasis | 180 × 165 × 60 mm, 482 g | Ficha del vendedor |
| Motores | 9–12 V, 3,5 kg·cm, 100 mA sin carga, 350 RPM a 12 V | Ficha del vendedor |
| Rueda de tracción | ≈ 52 mm | Estimado de fotos |
| Baterías | 2 × 18650 de 3,7 V en serie (7,4 V), 2600 mAh | Código LGABB41865, verificar |
| Caída del L298N | 1,8 V | Típico |
| Fricción | rodadura 0,06 · lateral 0,45 | Estimado para cerámica |
| Diferencia entre motores | 2 % | Estimado |
| Deslizamiento χ | 1,6 | Ajustable en el simulador |
