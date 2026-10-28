"""Programa del prototipo de orugas: la Raspberry Pi 3 Model B controla directamente el puente H L298N.

Módulos (ver README.md):
  config      configuración, PIN de acceso y guardado seguro de archivos
  motores     PWM por hardware (GPIO 12 y 13) y sentido de giro (GPIO 17, 27, 22 y 23) hacia el L298N
  registro    registro de eventos en CSV y alertas recientes
  mapa        mapa de la finca o del lugar: puntos, caminos y zonas prohibidas
  navegacion  planificación (puntos, coordenadas en metros, instrucciones, tramos) y estimación de la posición
  rutas       rutas guardadas con identificador y versión
  celular     celular a bordo opcional: rumbo, golpes, inclinación, GPS y cámara
  seguridad   validación de órdenes, límites y cambios de modo
  misiones    máquina de estados: modos manual, autónomo y temporal autónomo
  websocket   WebSocket mínimo (RFC 6455) sin librerías externas
  servidor    servidor web: páginas, API, sesiones con PIN, HTTPS opcional
  app         arranque del programa
"""
VERSION = "2.0.0"
