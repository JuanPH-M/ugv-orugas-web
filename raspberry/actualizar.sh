#!/bin/bash
# Actualiza el programa del robot desde GitHub (gratis) sin perder el PIN, la calibración, el mapa, las rutas ni los registros.
# Requiere internet en la Raspberry Pi: cable Ethernet, o conectarla un momento a la Wi-Fi de la casa o al celular.
# Uso:   sudo ./actualizar.sh            (la primera vez descarga el repositorio en /opt/ugv-repo)
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta con sudo:  sudo ./actualizar.sh"; exit 1; }
REPO_URL="${REPO_URL:-https://github.com/JuanPH-M/ugv-orugas-web.git}"
REPO=/opt/ugv-repo

command -v git >/dev/null || apt-get install -y -qq git
if [ -d "$REPO/.git" ]; then
  git -C "$REPO" fetch --depth 1 origin main
  git -C "$REPO" reset --hard origin/main         # copia de solo lectura: nadie la edita a mano
else
  git clone --depth 1 "$REPO_URL" "$REPO"
fi

cd "$REPO/raspberry"
echo "Probando el programa nuevo antes de instalarlo (sin hardware)…"
if ! python3 test_ugv.py >/tmp/ugv-pruebas.txt 2>&1; then
  tail -n 30 /tmp/ugv-pruebas.txt
  echo "Las pruebas fallaron: NO se instaló nada. El robot sigue con la versión anterior."
  exit 1
fi
./instalar.sh
systemctl restart ugv.service
echo "Actualizado a: $(git -C "$REPO" log -1 --format='%h %s')"
