# Smart Home+ Web Dashboard

Dashboard publico para el proyecto Smart Home+. La aplicacion tiene:

- Backend Node.js/Express listo para Railway.
- Conexion MQTT a HiveMQ Cloud desde el backend.
- Reenvio de datos en vivo al navegador mediante Socket.IO.
- Frontend React/Vite con pantalla de bienvenida y dashboard interactivo.
- Calculo de consumo, energia acumulada, gasto estimado, balance de red y recomendaciones Fog.

## Topics MQTT usados

El backend se suscribe a estos topics:

```text
SmartHomePlus/SmartMeter
SmartHomePlus/pv_power
SmartHomePlus/ev_power
SmartHomePlus/battery_soc
SmartHomePlus/devices/horno_electrico
SmartHomePlus/devices/calefactor
SmartHomePlus/devices/televisor_dormitorio
```

Si cambias el prefijo `SmartHomePlus`, ajusta `MQTT_TOPIC_PREFIX`.

## Variables de entorno

Copia `.env.example` como `.env` para desarrollo local, o crea estas variables en Railway:

```env
PORT=3000
MQTT_URL=mqtts://TU_CLUSTER_HIVEMQ:8883
MQTT_USERNAME=TU_USUARIO_HIVEMQ
MQTT_PASSWORD=TU_PASSWORD_HIVEMQ
MQTT_CLIENT_ID=smarthomeplus-web
MQTT_TOPIC_PREFIX=SmartHomePlus
MQTT_REJECT_UNAUTHORIZED=true
DEMO_MODE=false
```

Si `MQTT_URL` no esta configurado, la app entra automaticamente en modo demo para que la dashboard no quede vacia.

## Desarrollo local

Instala dependencias:

```bash
npm install
```

Levanta el backend:

```bash
npm run dev:server
```

En otra terminal levanta el frontend:

```bash
npm run dev
```

Abre:

```text
http://localhost:5173
```

## Produccion / Railway

En Railway crea un nuevo servicio desde GitHub apuntando a esta carpeta:

```text
SmartHome+/Proyecto/web
```

Railway deberia usar:

```bash
npm run build
npm start
```

El backend sirve el frontend compilado desde `dist/client`.

## Endpoints utiles

```text
GET /api/health
GET /api/state
POST /api/tariff
```

`/api/health` muestra conexion MQTT y los topics configurados. `/api/state` devuelve el mismo estado que recibe la dashboard.

## Formato esperado

Ejemplos de payloads:

```json
{
  "hora": "12:15",
  "total_power_w": 1800,
  "power_w": 1800
}
```

```json
{
  "hora": "12:15",
  "pv_power": 2200,
  "power_w": 2200
}
```

```json
{
  "hora": "12:15",
  "device_name": "Horno electrico",
  "power_w": 2100,
  "mode": "cocinando",
  "state": "on"
}
```

Cada mensaje representa 1 minuto simulado, igual que en el ESP32 y Node-RED.
