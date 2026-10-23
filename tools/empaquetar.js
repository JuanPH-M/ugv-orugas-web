/* Copia los archivos de raspberry/ dentro de js/codepi.js para que la página los muestre y descargue
   aunque se abra sin servidor (doble clic en index.html).   Uso: node tools/empaquetar.js */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const FILES = [
  ['ugv.py', 'Programa principal (Python 3)'],
  ['web/index.html', 'Página de control del celular'],
  ['finca.json', 'Mapa de la finca (puntos, caminos y lotes)'],
  ['config.json', 'Configuración'],
  ['instalar.sh', 'Instalador'],
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
