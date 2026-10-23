"""Pruebas de extremo a extremo del programa de la Raspberry Pi, con los pines simulados.

Arrancan el servidor real en un puerto libre y lo usan como lo haría el celular:
    python -m unittest raspberry/test_ugv.py
"""
import json
import math
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ugv  # noqa: E402


class PruebasUGV(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.srv, cls.ctl = ugv.crear(simular=True, puerto=0, carpeta=cls.tmp)
        cls.ctl.cfg["timeout_ms"] = 300
        cls.base = f"http://127.0.0.1:{cls.srv.server_address[1]}"
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.ctl.cerrar()
        cls.srv.server_close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        self.post("/api/parar", {"cliente": "a"})
        self.ctl.duenio = None
        self.ctl.modo = ugv.ESPERA
        # robot en su puesto y calibración rápida para que las pruebas duren poco
        self.ctl.pos, self.ctl.rumbo, self.ctl.tour_i = "PUESTO", 90.0, 0
        self.ctl.cfg.update(cm_s=4000.0, grados_s=1800.0, espera_s=0.05)

    def esperar(self, cond, seg=5, latir=True):
        """Consulta el estado (y envía latidos como la página) hasta que se cumpla la condición."""
        fin, vistos = time.time() + seg, []
        while time.time() < fin:
            if latir:
                self.post("/api/latido", {"cliente": "a"})
            e = self.estado()
            vistos.append(e)
            if cond(e):
                return e, vistos
            time.sleep(0.02)
        self.fail("no se cumplió la condición; último estado: " + json.dumps(vistos[-1]["auto"]))

    def pedir(self, ruta, cuerpo=None, metodo=None):
        datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
        req = urllib.request.Request(self.base + ruta, data=datos, method=metodo or ("POST" if datos else "GET"),
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=3) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def post(self, ruta, cuerpo):
        codigo, datos = self.pedir(ruta, cuerpo)
        return codigo, json.loads(datos)

    def estado(self):
        return json.loads(self.pedir("/api/estado")[1])

    def test_pagina_de_control(self):
        codigo, html = self.pedir("/")
        self.assertEqual(codigo, 200)
        self.assertIn("UGV de orugas", html.decode("utf-8"))

    def test_avanzar_fija_pines_del_l298n(self):
        codigo, e = self.post("/api/mover", {"cliente": "a", "izq": 60, "der": 60})
        self.assertEqual(codigo, 200)
        self.assertEqual(e["modo"], ugv.REMOTO)
        p = e["pines"]
        self.assertEqual((p["IN1"], p["IN2"], p["IN3"], p["IN4"]), (True, False, True, False))
        self.assertAlmostEqual(p["ENA"], 0.6)
        self.assertAlmostEqual(p["ENB"], 0.6)

    def test_giro_en_el_sitio_invierte_una_oruga(self):
        _, e = self.post("/api/mover", {"cliente": "a", "izq": -50, "der": 50})
        p = e["pines"]
        self.assertEqual((p["IN1"], p["IN2"]), (False, True))   # motor A hacia atrás
        self.assertEqual((p["IN3"], p["IN4"]), (True, False))   # motor B hacia adelante
        self.assertAlmostEqual(p["ENA"], 0.5)

    def test_parada_si_dejan_de_llegar_ordenes(self):
        self.post("/api/mover", {"cliente": "a", "izq": 80, "der": 80})
        time.sleep(0.15)
        self.assertEqual(self.estado()["izq"], 80)
        time.sleep(0.45)
        e = self.estado()
        self.assertEqual(e["modo"], ugv.SEGURIDAD)
        self.assertEqual((e["izq"], e["der"], e["pines"]["ENA"], e["pines"]["ENB"]), (0, 0, 0, 0))

    def test_otro_celular_no_puede_manejar_pero_si_detener(self):
        self.post("/api/mover", {"cliente": "a", "izq": 40, "der": 40})
        codigo, e = self.post("/api/mover", {"cliente": "b", "izq": 90, "der": 90})
        self.assertEqual(codigo, 409)
        codigo, e = self.post("/api/parar", {"cliente": "b"})
        self.assertEqual((codigo, e["izq"], e["der"]), (200, 0, 0))

    def test_recorrido_por_tramos_con_latido(self):
        tramos = [{"tipo": "avanzar", "velocidad": 50, "duracion": 0.4}, {"tipo": "derecha", "velocidad": 40, "duracion": 0.4}]
        codigo, e = self.post("/api/ejecutar", {"cliente": "a", "nombre": "prueba", "tramos": tramos})
        self.assertEqual((codigo, e["modo"]), (200, ugv.RECORRIDO))
        vistos, fin = set(), time.time() + 2
        while time.time() < fin:
            self.post("/api/latido", {"cliente": "a"})
            e = self.estado()
            if e["recorrido"]:
                vistos.add((e["recorrido"]["tipo"], e["izq"], e["der"]))
            elif e["modo"] == ugv.ESPERA:
                break
            time.sleep(0.05)
        self.assertIn(("avanzar", 50, 50), vistos)
        self.assertIn(("derecha", 40, -40), vistos)
        self.assertEqual((e["modo"], e["izq"], e["der"]), (ugv.ESPERA, 0, 0))

    def test_recorrido_se_detiene_sin_latido(self):
        self.post("/api/ejecutar", {"cliente": "a", "nombre": "largo", "tramos": [{"tipo": "avanzar", "velocidad": 70, "duracion": 5}]})
        time.sleep(0.6)
        e = self.estado()
        self.assertEqual((e["modo"], e["izq"]), (ugv.SEGURIDAD, 0))

    def test_parar_interrumpe_el_recorrido(self):
        self.post("/api/ejecutar", {"cliente": "a", "nombre": "largo", "tramos": [{"tipo": "avanzar", "velocidad": 70, "duracion": 5}]})
        time.sleep(0.1)
        _, e = self.post("/api/parar", {"cliente": "a"})
        self.assertEqual((e["modo"], e["izq"], e["recorrido"]), (ugv.ESPERA, 0, None))

    def test_valida_los_tramos(self):
        malos = [[], [{"tipo": "saltar", "velocidad": 10, "duracion": 1}], [{"tipo": "avanzar", "velocidad": 120, "duracion": 1}],
                 [{"tipo": "avanzar", "velocidad": 50, "duracion": 0}], [{"tipo": "avanzar", "velocidad": 50}]]
        for t in malos:
            codigo, e = self.post("/api/ejecutar", {"cliente": "a", "nombre": "x", "tramos": t})
            self.assertEqual(codigo, 400, t)
            self.assertIn("error", e)

    def test_guardar_listar_y_borrar_recorridos(self):
        tramos = [{"tipo": "avanzar", "velocidad": 60, "duracion": 2.5}, {"tipo": "pausa", "velocidad": 0, "duracion": 1}]
        self.assertEqual(self.post("/api/recorridos", {"nombre": "Ruta tierra", "tramos": tramos})[0], 200)
        todos = json.loads(self.pedir("/api/recorridos")[1])
        self.assertEqual(todos["Ruta tierra"], tramos)
        self.assertIn("A-B-C", todos)
        self.assertEqual(self.pedir("/api/recorridos/Ruta%20tierra", metodo="DELETE")[0], 200)
        self.assertNotIn("Ruta tierra", json.loads(self.pedir("/api/recorridos")[1]))
        self.assertEqual(self.post("/api/ejecutar", {"cliente": "a", "nombre": "no-existe"})[0], 404)

    def test_registro_csv_con_datos_de_la_prueba(self):
        self.post("/api/prueba", {"cliente": "a", "codigo": "P2", "superficie": "tierra", "carga_kg": "1"})
        self.post("/api/mover", {"cliente": "a", "izq": 30, "der": 30})
        self.post("/api/parar", {"cliente": "a"})
        codigo, csv = self.pedir("/registro.csv")
        lineas = csv.decode("utf-8").splitlines()
        self.assertEqual(lineas[0], "fecha_hora,modo,evento,izq,der,prueba,superficie,carga_kg")
        self.assertTrue(any(",P2,tierra,1" in l and ",30,30," in l for l in lineas))

    def test_factor_de_ajuste_de_un_motor(self):
        self.ctl.cfg["factor_der"] = 0.9
        try:
            _, e = self.post("/api/mover", {"cliente": "a", "izq": 100, "der": 100})
            self.assertEqual((e["izq"], e["der"]), (100, 90))
        finally:
            self.ctl.cfg["factor_der"] = 1.0

    # ---------------------------------------------------------------- modo automático por la finca
    def test_el_mapa_no_deja_caminos_sobre_los_cultivos(self):
        m = ugv.Mapa(os.path.join(os.path.dirname(ugv.__file__), "finca.json"))
        for a, b in m.datos["caminos"]:
            for lote in m.lotes:
                self.assertGreaterEqual(ugv.distancia_segmento_lote(m._xy(a), m._xy(b), lote), m.margen, (a, b, lote["nombre"]))
        malo = dict(m.datos, caminos=m.datos["caminos"] + [["J1", "C"]])   # cruzaría el cafetal y la platanera
        ruta = os.path.join(self.tmp, "malo.json")
        with open(ruta, "w", encoding="utf-8") as f:
            json.dump(malo, f)
        with self.assertRaises(ValueError):
            ugv.Mapa(ruta)

    def test_ruta_mas_corta_solo_por_caminos(self):
        m = self.ctl.mapa
        self.assertEqual(m.ruta("PUESTO", "C"), ["PUESTO", "J1", "J2", "J3", "C"])
        self.assertEqual(m.ruta("A", "ALMACEN"), ["A", "B", "C", "J3", "ALMACEN"])

    def test_automatico_pide_calibracion(self):
        self.ctl.cfg.update(cm_s=None)
        codigo, e = self.post("/api/ir", {"cliente": "a", "destino": "C"})
        self.assertEqual(codigo, 400)
        self.assertIn("calibra", e["error"])

    def test_ir_directo_a_un_punto(self):
        codigo, e = self.post("/api/ir", {"cliente": "a", "destino": "C"})
        self.assertEqual((codigo, e["modo"]), (200, ugv.AUTO))
        self.assertEqual(e["auto"]["plan"]["ruta"], ["PUESTO", "J1", "J2", "J3", "C"])
        e, vistos = self.esperar(lambda e: e["modo"] == ugv.ESPERA)
        self.assertEqual((e["auto"]["posicion"], e["auto"]["rumbo"], e["izq"], e["der"]), ("C", 90.0, 0, 0))
        self.assertTrue(any(v["izq"] > 0 > v["der"] for v in vistos), "giró a la derecha en el cruce J3")

    def test_recorrido_completo_espera_un_segundo_en_cada_punto(self):
        self.ctl.cfg.update(espera_s=0.15)
        self.post("/api/recorrido", {"cliente": "a", "desde_cero": True})
        e, vistos = self.esperar(lambda e: e["modo"] == ugv.ESPERA, seg=10)
        quietos = [v["auto"]["posicion"] for v in vistos if v["auto"]["posicion"] in ("A", "B", "C", "D", "ALMACEN") and v["izq"] == v["der"] == 0]
        for p in ["A", "B", "C", "D", "ALMACEN"]:
            self.assertIn(p, quietos, "se detuvo en " + p)
        self.assertEqual((e["auto"]["posicion"], e["auto"]["tour_i"]), ("PUESTO", 0))

    def test_espera_la_orden_del_usuario_y_permite_elegir_el_proximo_punto(self):
        self.post("/api/recorrido", {"cliente": "a", "desde_cero": True, "esperar_orden": True})
        e, _ = self.esperar(lambda e: e["modo"] == ugv.ESPERANDO)
        self.assertEqual((e["auto"]["posicion"], e["auto"]["siguiente"]), ("A", "B"))
        time.sleep(0.4)                                        # esperando no exige latidos ni mueve motores
        self.assertEqual((self.estado()["modo"], self.estado()["izq"]), (ugv.ESPERANDO, 0))
        self.assertEqual(self.post("/api/siguiente", {"cliente": "a"})[0], 200)
        e, _ = self.esperar(lambda e: e["modo"] == ugv.ESPERANDO and e["auto"]["posicion"] == "B")
        codigo, e = self.post("/api/ir", {"cliente": "a", "destino": "ALMACEN", "esperar_orden": True})   # cambia el próximo punto
        self.assertEqual((codigo, e["auto"]["plan"]["ruta"]), (200, ["B", "C", "J3", "ALMACEN"]))
        e, _ = self.esperar(lambda e: e["modo"] == ugv.ESPERANDO and e["auto"]["posicion"] == "ALMACEN")
        self.post("/api/siguiente", {"cliente": "a"})
        e, _ = self.esperar(lambda e: e["modo"] == ugv.ESPERA)
        self.assertEqual(e["auto"]["posicion"], "ALMACEN")

    def test_detenerlo_en_el_camino_pierde_la_posicion(self):
        self.ctl.cfg.update(cm_s=50.0)
        self.post("/api/ir", {"cliente": "a", "destino": "A"})
        time.sleep(0.2)
        _, e = self.post("/api/parar", {"cliente": "a"})
        self.assertIsNone(e["auto"]["posicion"])
        self.assertEqual(self.post("/api/ir", {"cliente": "a", "destino": "B"})[0], 400)
        codigo, e = self.post("/api/posicion", {"cliente": "a", "punto": "PUESTO"})
        self.assertEqual((codigo, e["auto"]["posicion"], e["auto"]["rumbo"]), (200, "PUESTO", 90.0))

    def test_calibracion_guarda_cm_por_segundo_y_grados_por_segundo(self):
        codigo, e = self.post("/api/calibracion", {"cliente": "a", "medido_cm": 220, "medido_grados": 600, "vel_auto": 60})
        self.assertEqual((codigo, e["auto"]["cm_s"], e["auto"]["grados_s"]), (200, 22.0, 60.0))
        with open(os.path.join(self.tmp, "config.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["cm_s"], 22.0)
        codigo, e = self.post("/api/calibrar", {"cliente": "a", "prueba": "avance"})
        self.assertEqual((codigo, e["modo"]), (200, ugv.RECORRIDO))
        e, _ = self.esperar(lambda e: e["izq"] == e["der"] == 60)
        self.post("/api/parar", {"cliente": "a"})

    def test_calibracion_corrige_el_desvio_entre_motores(self):
        self.ctl.cfg.update(factor_izq=1.0, factor_der=1.0)
        try:
            # 220 cm en 10 s, 600° en 10 s y 12 cm de desvío a la izquierda: la oruga derecha va más rápido
            _, e = self.post("/api/calibracion", {"cliente": "a", "medido_cm": 220, "medido_grados": 600, "medido_desvio_cm": 12})
            ancho = 2 * 22.0 / math.radians(60.0)
            esperado = round(1 / (1 + 0.5 * 2 * 12 / 220 ** 2 * ancho), 4)
            self.assertEqual((e["auto"]["factor_izq"], e["auto"]["factor_der"]), (1.0, esperado))
            self.assertLess(esperado, 1)
            _, e = self.post("/api/calibracion", {"cliente": "a", "medido_cm": 220, "medido_desvio_cm": -12})   # ahora se va a la derecha
            self.assertEqual(e["auto"]["factor_der"], 1.0)
        finally:
            self.ctl.cfg.update(factor_izq=1.0, factor_der=1.0)

    def test_mapa_para_la_pagina(self):
        m = json.loads(self.pedir("/api/mapa")[1])
        self.assertEqual(m["inicio"], "PUESTO")
        self.assertEqual(len(m["lotes"]), 4)


if __name__ == "__main__":
    unittest.main()
