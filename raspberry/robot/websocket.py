"""WebSocket mínimo (RFC 6455) sobre http.server, sin librerías externas.

Solo lo necesario para la página de control: mensajes de texto (JSON) y binarios, ping/pong y cierre.
El navegador abre ws://10.42.0.1/ws; el servidor responde el apretón de manos y luego intercambian marcos."""
import base64
import hashlib
import socket
import struct

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
MAX_MARCO = 1_000_000


def aceptar(handler):
    """Responde el apretón de manos. Devuelve False si la petición no es un WebSocket válido."""
    clave = handler.headers.get("Sec-WebSocket-Key")
    if handler.headers.get("Upgrade", "").lower() != "websocket" or not clave:
        return False
    acepta = base64.b64encode(hashlib.sha1((clave + GUID).encode()).digest()).decode()
    handler.send_response(101, "Switching Protocols")
    handler.send_header("Upgrade", "websocket")
    handler.send_header("Connection", "Upgrade")
    handler.send_header("Sec-WebSocket-Accept", acepta)
    handler.end_headers()
    handler.wfile.flush()
    return True


class Cerrado(Exception):
    pass


def _leer(f, n):
    datos = b""
    while len(datos) < n:
        parte = f.read(n - len(datos))
        if not parte:
            raise Cerrado()
        datos += parte
    return datos


def recibir(f):
    """Lee un mensaje completo. Devuelve (opcode, datos). Lanza Cerrado si la conexión terminó."""
    mensaje, opcode_msg = b"", None
    while True:
        b1, b2 = _leer(f, 2)
        fin, opcode = b1 & 0x80, b1 & 0x0F
        enmascarado, n = b2 & 0x80, b2 & 0x7F
        if n == 126:
            n = struct.unpack(">H", _leer(f, 2))[0]
        elif n == 127:
            n = struct.unpack(">Q", _leer(f, 8))[0]
        if n > MAX_MARCO:
            raise Cerrado()
        mascara = _leer(f, 4) if enmascarado else b""
        datos = _leer(f, n)
        if mascara:
            datos = bytes(b ^ mascara[i % 4] for i, b in enumerate(datos))
        if opcode >= 0x8:                       # control: cierre, ping, pong (nunca fragmentados)
            return opcode, datos
        if opcode != 0:
            opcode_msg = opcode
        mensaje += datos
        if len(mensaje) > MAX_MARCO:
            raise Cerrado()
        if fin:
            return opcode_msg, mensaje


def enviar(sock, datos, opcode=0x1):
    """Envía un marco (texto por defecto) sin máscara, como corresponde al servidor."""
    if isinstance(datos, str):
        datos = datos.encode("utf-8")
    n = len(datos)
    cabecera = bytes([0x80 | opcode])
    if n < 126:
        cabecera += bytes([n])
    elif n < 65536:
        cabecera += bytes([126]) + struct.pack(">H", n)
    else:
        cabecera += bytes([127]) + struct.pack(">Q", n)
    try:
        sock.sendall(cabecera + datos)
    except (OSError, socket.timeout):
        raise Cerrado()
