#!/bin/bash
# Instala el control del UGV de orugas en una Raspberry Pi 3 Model B con Raspberry Pi OS (Bookworm).
# Uso, dentro de la carpeta raspberry/:   sudo ./instalar.sh
# Opcional:   sudo SSID=MiUGV CLAVE=otraClave123 ./instalar.sh
# Se puede repetir sin perder nada: config.json (PIN y calibración), finca.json, rutas.json y registros se conservan.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta con sudo:  sudo ./instalar.sh"; exit 1; }
cd "$(dirname "$0")"

DEST=/opt/ugv
SSID="${SSID:-UGV-Orugas}"
CLAVE="${CLAVE:-orugas2026}"          # mínimo 8 caracteres (WPA2)
CFG=/boot/firmware/config.txt
[ -f "$CFG" ] || CFG=/boot/config.txt  # versiones anteriores a Bookworm

echo "1/6  Paquetes (todos gratuitos y de Raspberry Pi OS)"
apt-get update -qq
apt-get install -y -qq python3 python3-gpiozero python3-lgpio openssl

echo "2/6  PWM por hardware en GPIO 12 (ENA) y GPIO 13 (ENB)"
# GPIO 12 = PWM0 y GPIO 13 = PWM1 en su función ALT0 (func=4). El audio analógico usa los mismos canales PWM.
if ! grep -q '^dtoverlay=pwm-2chan' "$CFG"; then
  echo 'dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4' >> "$CFG"
fi
sed -i 's/^dtparam=audio=on/dtparam=audio=off/' "$CFG"
grep -q '^dtparam=audio=off' "$CFG" || echo 'dtparam=audio=off' >> "$CFG"

echo "3/6  Programa en $DEST"
mkdir -p "$DEST"
systemctl stop ugv.service 2>/dev/null || true     # al detenerse, el programa pone los motores en cero
rm -rf "$DEST/robot" "$DEST/web"                    # código viejo fuera; los datos se conservan
cp ugv.py "$DEST/"
cp -r robot web "$DEST/"
find "$DEST/robot" -name '__pycache__' -prune -exec rm -rf {} +
[ -f "$DEST/finca.json" ] || cp finca.json "$DEST/"   # el mapa de tu finca no se sobrescribe
[ -f "$DEST/config.json" ] || cp config.json "$DEST/"

echo "4/6  PIN de acceso y certificado para la página del celular a bordo"
# Si config.json no tiene PIN, se crea uno de 6 cifras al azar. Las claves nuevas se agregan con su valor por defecto.
PIN=$(python3 - "$DEST/config.json" <<'PY'
import json, secrets, sys
ruta = sys.argv[1]
with open(ruta, encoding="utf-8") as f:
    cfg = json.load(f)
if not cfg.get("pin"):
    cfg["pin"] = f"{secrets.randbelow(10**6):06d}"
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write("\n")
print(cfg["pin"])
PY
)
chmod 600 "$DEST/config.json"
if [ ! -f "$DEST/cert.pem" ]; then
  # certificado propio y gratuito: el celular mostrará un aviso la primera vez («Avanzado» → «Continuar»)
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=UGV-Orugas" \
    -addext "subjectAltName=IP:10.42.0.1,DNS:ugv.local" \
    -keyout "$DEST/clave.pem" -out "$DEST/cert.pem" 2>/dev/null
  chmod 600 "$DEST/clave.pem"
fi

echo "5/6  Servicio que arranca al encender"
cp ugv.service /etc/systemd/system/ugv.service
systemctl daemon-reload
systemctl enable ugv.service

echo "6/6  Red Wi-Fi propia del vehículo: $SSID"
raspi-config nonint do_wifi_country CO || true
if ! nmcli -t -f NAME connection show | grep -qx ugv-ap; then
  nmcli connection add type wifi ifname wlan0 con-name ugv-ap autoconnect yes ssid "$SSID" \
    connection.autoconnect-priority 100 \
    802-11-wireless.mode ap 802-11-wireless.band bg \
    ipv4.method shared ipv4.addresses 10.42.0.1/24 \
    wifi-sec.key-mgmt wpa-psk wifi-sec.proto rsn wifi-sec.pairwise ccmp wifi-sec.group ccmp wifi-sec.psk "$CLAVE"
fi

cat <<FIN

Listo. Reinicia la Raspberry Pi:   sudo reboot
Después:
  1. Conecta el celular a la red Wi-Fi «$SSID» (clave: $CLAVE).
  2. Abre en el navegador:  http://10.42.0.1      PIN del robot: $PIN
  3. (Opcional) Celular a bordo, sujeto al robot:  https://10.42.0.1/abordo
Ver el programa en marcha:   journalctl -u ugv -f
Cambiar el PIN:              edita "pin" en $DEST/config.json y reinicia:  sudo systemctl restart ugv
Registros de las pruebas:    $DEST/registros/
FIN
