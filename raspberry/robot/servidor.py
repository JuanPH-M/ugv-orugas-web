"""Servidor web del robot: páginas, API HTTP con sesión por PIN y WebSocket para el control en tiempo real.

Páginas
  /         panel del operador (control manual, rutas, modos, calibración, cámara, alertas)
  /abordo   página del celular a bordo (sensores y cámara); se abre por HTTPS porque el navegador lo exige
Acceso
  POST /api/entrar {pin} devuelve un token; las demás peticiones lo envían en la cabecera X-Token.
  Sin token solo se puede: ver /api/info y DETENER el robot (POST /api/parar). Detener nunca pide PIN.
Tiempo real
  /ws: el primer mensaje es {"t": "hola", "token", "cliente"}. Luego el servidor envía el estado cada 200 ms y recibe
  {"t": "mover", "izq", "der"}, {"t": "latido"}, {"t": "parar"} o {"t": "celular", ...} (lecturas del celular a bordo)."""
import json
import logging
import os
import socket
import ssl
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from . import VERSION, websocket as ws
from .misiones import OcupadoError

log = logging.getLogger("ugv")
WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")
PAGINAS = {"/": "index.html", "/index.html": "index.html", "/abordo": "abordo.html", "/abordo.html": "abordo.html"}
MAX_JSON, MAX_FOTO = 65536, 400_000
PERIODO_ESTADO = 0.2


class NoAutorizado(Exception):
    pass


class Manejador(BaseHTTPRequestHandler):
    server_version = "UGV-Orugas/" + VERSION
    protocol_version = "HTTP/1.1"
    timeout = 60                    # conexiones inactivas se cierran solas
    app = None                     # se asigna en app.crear(): ctl, rutas, registro, sesiones, mapa, cfg, celular

    def log_message(self, fmt, *args):
        log.debug("%s %s", self.address_string(), fmt % args)

    # ------------------------------------------------------------ respuestas
    def _enviar(self, codigo, cuerpo, tipo="application/json; charset=utf-8", extra=None):
        datos = cuerpo if isinstance(cuerpo, bytes) else json.dumps(cuerpo, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(datos)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(datos)

    def _cuerpo(self, maximo):
        n = int(self.headers.get("Content-Length") or 0)
        if n < 0 or n > maximo:
            self.close_connection = True
            raise ValueError("Petición demasiado grande.")
        return self.rfile.read(n) if n else b""

    def _json(self):
        try:
            d = json.loads(self._cuerpo(MAX_JSON) or b"{}")
        except json.JSONDecodeError:
            raise ValueError("JSON no válido.")
        if not isinstance(d, dict):
            raise ValueError("Se esperaba un objeto JSON.")
        return d

    def _autorizar(self):
        if not self.app.sesiones.valida(self.headers.get("X-Token")):
            raise NoAutorizado()

    def _cliente(self, d=None):
        c = (d or {}).get("cliente") or self.headers.get("X-Cliente") or ""
        return str(c)[:64] or None

    def _errores(self, accion):
        try:
            accion()
        except NoAutorizado:
            self._enviar(401, {"error": "Inicia sesión con el PIN del robot."})
        except PermissionError as e:
            self._enviar(403, {"error": str(e)})
        except OcupadoError as e:
            self._enviar(409, {"error": str(e)})
        except KeyError as e:
            self._enviar(404, {"error": f"No existe {e.args[0] if e.args else ''}."})
        except (ValueError, TypeError) as e:
            self._enviar(400, {"error": str(e)})

    # ------------------------------------------------------------ GET
    def do_GET(self):
        u = urlparse(self.path)
        if u.path in PAGINAS:
            try:
                with open(os.path.join(WEB, PAGINAS[u.path]), "rb") as f:
                    return self._enviar(200, f.read(), "text/html; charset=utf-8")
            except OSError:
                return self._enviar(404, {"error": "Falta la página en la carpeta web/."})
        if u.path == "/ws":
            return self._websocket()
        if u.path == "/api/info":
            return self._enviar(200, {"version": VERSION, "mapa": self.app.mapa is not None,
                                      "simulado": self.app.ctl.m.tipo_pwm == "simulada",
                                      "https": self.app.puerto_https})
        self._errores(lambda: self._get_api(u, parse_qs(u.query)))

    def _get_api(self, u, q):
        self._autorizar()
        a = self.app
        if u.path == "/api/estado":
            return self._enviar(200, a.ctl.estado_dict(self._cliente()))
        if u.path == "/api/rutas":
            return self._enviar(200, a.rutas.todas())
        if u.path == "/api/mapa":
            return self._enviar(200, a.mapa.datos if a.mapa else {})
        if u.path == "/api/config":
            return self._enviar(200, {k: v for k, v in a.cfg.items() if k != "pin"})
        if u.path == "/api/registro":
            n = max(1, min(200, int((q.get("n") or ["30"])[0])))
            return self._enviar(200, list(a.registro.ultimos)[-n:])
        if u.path == "/api/camara.jpg":
            if a.celular is None or a.celular.foto is None:
                raise KeyError("ninguna foto del celular a bordo")
            return self._enviar(200, a.celular.foto, "image/jpeg")
        if u.path == "/registro.csv":
            ruta = a.registro.archivo()
            datos = b""
            if os.path.exists(ruta):
                with open(ruta, "rb") as f:
                    datos = f.read()
            return self._enviar(200, datos, "text/csv; charset=utf-8",
                                {"Content-Disposition": f'attachment; filename="{os.path.basename(ruta)}"'})
        raise KeyError("esa dirección")

    # ------------------------------------------------------------ POST
    def do_POST(self):
        u = urlparse(self.path)
        self._errores(lambda: self._post_api(u.path))

    def _post_api(self, ruta):
        a = self.app
        if ruta == "/api/camara":                       # foto JPEG del celular a bordo (cuerpo binario)
            self._autorizar()
            if a.celular is None:
                raise ValueError("El celular a bordo no está habilitado.")
            a.celular.guardar_foto(self._cuerpo(MAX_FOTO))
            return self._enviar(200, {"ok": True})
        d = self._json()
        cliente = self._cliente(d)
        if ruta == "/api/entrar":
            return self._enviar(200, {"token": a.sesiones.entrar(d.get("pin")), "version": VERSION})
        if ruta == "/api/parar":                        # sin PIN: cualquiera puede detener el robot
            a.ctl.parar(cliente)
            return self._enviar(200, {"ok": True, "estado": a.ctl.estado})
        self._autorizar()
        ctl = a.ctl
        temporal = d.get("temporal") or None
        if temporal is not None and not isinstance(temporal, dict):
            raise ValueError("Datos del modo temporal no válidos.")
        opciones = dict(temporal=temporal, esperar_orden=bool(d.get("esperar_orden")), usar_celular=bool(d.get("usar_celular")))
        if ruta == "/api/salir":
            a.sesiones.salir(self.headers.get("X-Token"))
            return self._enviar(200, {"ok": True})
        elif ruta == "/api/mover":
            ctl.mover(cliente, d.get("izq", 0), d.get("der", 0))
        elif ruta == "/api/latido":
            ctl.latido(cliente)
        elif ruta == "/api/rutas":
            r = a.rutas.guardar(d.get("nombre"), d.get("tipo"), d.get("datos"))
            return self._enviar(200, r)
        elif ruta == "/api/ejecutar":
            r = a.rutas.obtener(str(d.get("id", "")))
            ctl.ejecutar_ruta(cliente, r, d.get("version"), **opciones)
        elif ruta == "/api/ir":
            ctl.ir(cliente, str(d.get("destino", "")), **opciones)
        elif ruta == "/api/recorrido":
            ctl.recorrido_completo(cliente, bool(d.get("desde_cero")), **opciones)
        elif ruta == "/api/siguiente":
            ctl.siguiente(cliente)
        elif ruta == "/api/pausar":
            ctl.pausar(cliente)
        elif ruta == "/api/reanudar":
            ctl.reanudar(cliente)
        elif ruta == "/api/manual":
            ctl.tomar_manual(cliente)
        elif ruta == "/api/posicion":
            ctl.fijar_posicion(cliente, d.get("punto") or None, d.get("x_m"), d.get("y_m"), d.get("rumbo"))
        elif ruta == "/api/calibrar":
            ctl.calibrar(cliente, str(d.get("prueba", "")))
        elif ruta == "/api/calibracion":
            ctl.guardar_calibracion(d.get("medido_cm"), d.get("medido_grados"), d.get("vel_auto"), d.get("medido_desvio_cm"))
        elif ruta == "/api/celular":
            ctl.datos_celular(d)
            return self._enviar(200, {"ok": True})
        elif ruta == "/api/celular/alinear":
            ctl.alinear_celular(cliente)
        elif ruta == "/api/prueba":
            a.registro.prueba = {"codigo": str(d.get("codigo", ""))[:20], "superficie": str(d.get("superficie", ""))[:20],
                                 "carga_kg": str(d.get("carga_kg", ""))[:6]}
            a.registro.anotar(ctl.estado, "datos de la prueba")
        else:
            raise KeyError("esa dirección")
        self._enviar(200, ctl.estado_dict(cliente))

    # ------------------------------------------------------------ DELETE
    def do_DELETE(self):
        u = urlparse(self.path)

        def borrar():
            self._autorizar()
            if not u.path.startswith("/api/rutas/"):
                raise KeyError("esa dirección")
            self.app.rutas.borrar(unquote(u.path[len("/api/rutas/"):]))
            self._enviar(200, {"ok": True})
        self._errores(borrar)

    # ------------------------------------------------------------ WebSocket
    def _websocket(self):
        if not ws.aceptar(self):
            return self._enviar(400, {"error": "Se esperaba un WebSocket."})
        self.close_connection = True
        sock, envio = self.connection, threading.Lock()
        sock.settimeout(30)                              # la página manda latidos: 30 s sin nada = conexión muerta
        a, vivo = self.app, threading.Event()
        cliente = None

        def mandar(obj, opcode=0x1):
            with envio:
                ws.enviar(sock, json.dumps(obj, ensure_ascii=False), opcode)

        def empujar():                                   # estado cada 200 ms
            try:
                while not vivo.wait(PERIODO_ESTADO):
                    mandar({"t": "estado", "estado": a.ctl.estado_dict(cliente)})
            except (ws.Cerrado, OSError):
                vivo.set()

        try:
            op, datos = ws.recibir(self.rfile)
            hola = json.loads(datos) if op == 0x1 else {}
            if hola.get("t") != "hola" or not a.sesiones.valida(hola.get("token")):
                mandar({"t": "error", "error": "Inicia sesión con el PIN del robot.", "codigo": 401})
                return
            cliente = str(hola.get("cliente") or "")[:64] or None
            mandar({"t": "estado", "estado": a.ctl.estado_dict(cliente)})
            threading.Thread(target=empujar, name="ws-estado", daemon=True).start()
            while not vivo.is_set():
                op, datos = ws.recibir(self.rfile)
                if op == 0x8:                            # cierre
                    break
                if op == 0x9:                            # ping -> pong
                    with envio:
                        ws.enviar(sock, datos, 0xA)
                    continue
                if op != 0x1:
                    continue
                self._mensaje_ws(cliente, datos, mandar)
        except (ws.Cerrado, OSError, socket.timeout, ValueError):
            pass
        finally:
            vivo.set()

    def _mensaje_ws(self, cliente, datos, mandar):
        ctl = self.app.ctl
        try:
            m = json.loads(datos)
            t = m.get("t")
            if t == "mover":
                ctl.mover(cliente, m.get("izq", 0), m.get("der", 0))
            elif t == "latido":
                ctl.latido(cliente)
            elif t == "parar":
                ctl.parar(cliente)
            elif t == "celular":
                ctl.datos_celular(m)
            else:
                raise ValueError("Mensaje desconocido.")
        except OcupadoError as e:
            mandar({"t": "error", "error": str(e), "codigo": 409})
        except (ValueError, TypeError, KeyError, AttributeError, json.JSONDecodeError) as e:
            mandar({"t": "error", "error": str(e) or "Mensaje no válido.", "codigo": 400})


class ServidorWeb(ThreadingHTTPServer):
    """Escucha en IPv4 e IPv6 a la vez (si el sistema lo permite), para que 'localhost' responda sin demoras."""
    daemon_threads = True

    def __init__(self, puerto, manejador, contexto_tls=None):
        doble = socket.has_dualstack_ipv6()
        self.address_family = socket.AF_INET6 if doble else socket.AF_INET
        self.tls = contexto_tls
        super().__init__(("::" if doble else "0.0.0.0", puerto), manejador)

    def server_bind(self):
        if self.address_family == socket.AF_INET6:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()

    def finish_request(self, request, client_address):
        # el saludo TLS se hace en el hilo de cada conexión: un cliente lento no bloquea a los demás
        if self.tls is not None:
            request.settimeout(10)
            try:
                request = self.tls.wrap_socket(request, server_side=True)
            except (ssl.SSLError, OSError):
                return
            request.settimeout(None)
            try:
                super().finish_request(request, client_address)
            finally:
                request.close()
            return
        super().finish_request(request, client_address)


def contexto_tls(cert, clave):
    """Certificado propio (lo crea instalar.sh con openssl). Devuelve None si no existe."""
    if not (os.path.exists(cert) and os.path.exists(clave)):
        return None
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, clave)
    return ctx
