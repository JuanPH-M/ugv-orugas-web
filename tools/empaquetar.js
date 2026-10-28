/* Copia los archivos de raspberry/ dentro de js/codepi.js para que la página los muestre y descargue
   aunque se abra sin servidor (doble clic en index.html).   Uso: node tools/empaquetar.js */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const FILES = [
  ['ugv.py', 'Arranque del programa (Python 3)'],
  ['robot/__init__.py', 'Paquete robot: versión y lista de módulos'],
  ['robot/app.py', 'Arma todo y arranca los servidores'],
  ['robot/config.py', 'Configuración por defecto'],
  ['robot/motores.py', 'Pines del L298N, PWM y rampa de aceleración'],
  ['robot/navegacion.py', 'Rutas en metros, grados y coordenadas; posición por estima'],
  ['robot/mapa.py', 'Mapa: puntos, caminos y zonas prohibidas'],
  ['robot/misiones.py', 'Modos manual, autónomo y temporal; vigilancia'],
  ['robot/rutas.py', 'Rutas guardadas con versión'],
  ['robot/celular.py', 'Celular a bordo (opcional)'],
  ['robot/seguridad.py', 'PIN, sesiones y validaciones'],
  ['robot/servidor.py', 'API HTTP y WebSocket'],
  ['robot/websocket.py', 'WebSocket mínimo (RFC 6455)'],
  ['robot/registro.py', 'Registro CSV y alertas'],
  ['web/index.html', 'Panel del operador'],
  ['web/abordo.html', 'Página del celular a bordo'],
  ['finca.json', 'Mapa de la finca (puntos, caminos y lotes)'],
  ['config.json', 'Configuración'],
  ['instalar.sh', 'Instalador'],
  ['actualizar.sh', 'Actualizar desde GitHub'],
  ['ugv.service', 'Servicio de arranque'],
  ['README.md', 'Instrucciones'],
  ['test_ugv.py', 'Pruebas']
];

function generar() {
  const lista = FILES.map(([f, desc]) => ({ name: f, desc, text: fs.readFileSync(path.join(root, 'raspberry', f), 'utf8').replace(/\r\n/g, '\n') }));
  return '/* Generado por tools/empaquetar.js a partir de la carpeta raspberry/. No editar a mano: edita raspberry/ y vuelve a ejecutar\n' +
    '   node tools/empaquetar.js */\nUGV.PI_FILES = ' + JSON.stringify(lista, null, 1) + ';\n';
}
module.exports = { generar, FILES };

if (require.main === module) {
  fs.writeFileSync(path.join(root, 'js', 'codepi.js'), generar());
  console.log('js/codepi.js actualizado con', FILES.length, 'archivos de raspberry/');
}
