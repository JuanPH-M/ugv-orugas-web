"""Pruebas de extremo a extremo del programa de la Raspberry Pi, con los pines simulados.

Arrancan el servidor real en un puerto libre y lo usan como lo haría el celular:
    python -m unittest raspberry/test_ugv.py
"""
import json
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


if __name__ == "__main__":
    unittest.main()
