#!/bin/bash
# Instala el control del UGV de orugas en una Raspberry Pi 3 Model B con Raspberry Pi OS (Bookworm).
# Uso, dentro de la carpeta raspberry/:   sudo ./instalar.sh
# Opcional:   sudo SSID=MiUGV CLAVE=otraClave123 ./instalar.sh
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta con sudo:  sudo ./instalar.sh"; exit 1; }
cd "$(dirname "$0")"

DEST=/opt/ugv
SSID="${SSID:-UGV-Orugas}"
CLAVE="${CLAVE:-orugas2026}"          # mínimo 8 caracteres (WPA2)
CFG=/boot/firmware/config.txt
[ -f "$CFG" ] || CFG=/boot/config.txt  # versiones anteriores a Bookworm

echo "1/5  Paquetes (gpiozero ya viene en Raspberry Pi OS)"
apt-get update -qq
apt-get install -y -qq python3 python3-gpiozero python3-lgpio

echo "2/5  PWM por hardware en GPIO 12 (ENA) y GPIO 13 (ENB)"
# GPIO 12 = PWM0 y GPIO 13 = PWM1 en su función ALT0 (func=4). El audio analógico usa los mismos canales PWM.
if ! grep -q '^dtoverlay=pwm-2chan' "$CFG"; then
  echo 'dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4' >> "$CFG"
fi
sed -i 's/^dtparam=audio=on/dtparam=audio=off/' "$CFG"
grep -q '^dtparam=audio=off' "$CFG" || echo 'dtparam=audio=off' >> "$CFG"

echo "3/5  Programa en $DEST"
mkdir -p "$DEST"
cp ugv.py "$DEST/"
cp -r web "$DEST/"
[ -f "$DEST/config.json" ] || cp config.json "$DEST/"

echo "4/5  Servicio que arranca al encender"
cp ugv.service /etc/systemd/system/ugv.service
systemctl daemon-reload
systemctl enable ugv.service

echo "5/5  Red Wi-Fi propia del vehículo: $SSID"
raspi-config nonint do_wifi_country CO || true
nmcli connection delete ugv-ap >/dev/null 2>&1 || true
nmcli connection add type wifi ifname wlan0 con-name ugv-ap autoconnect yes ssid "$SSID" \
  connection.autoconnect-priority 100 \
  802-11-wireless.mode ap 802-11-wireless.band bg \
  ipv4.method shared ipv4.addresses 10.42.0.1/24 \
  wifi-sec.key-mgmt wpa-psk wifi-sec.proto rsn wifi-sec.pairwise ccmp wifi-sec.group ccmp wifi-sec.psk "$CLAVE"

cat <<FIN

Listo. Reinicia la Raspberry Pi:   sudo reboot
Después:
  1. Conecta el celular a la red Wi-Fi «$SSID» (clave: $CLAVE).
  2. Abre en el navegador:  http://10.42.0.1
Ver el programa en marcha:   journalctl -u ugv -f
Registros de las pruebas:    $DEST/registros/
FIN
