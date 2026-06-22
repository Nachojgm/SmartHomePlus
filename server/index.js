import "dotenv/config";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import mqtt from "mqtt";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || "SmartHomePlus";
const DEFAULT_PRICE_CLP_KWH = 200;
const DT_HOURS = 1 / 60;
const MAX_HISTORY = 120;

const TOPICS = {
  smartMeter: `${TOPIC_PREFIX}/SmartMeter`,
  pvPower: `${TOPIC_PREFIX}/pv_power`,
  evPower: `${TOPIC_PREFIX}/ev_power`,
  batterySoc: `${TOPIC_PREFIX}/battery_soc`,
  horno: `${TOPIC_PREFIX}/devices/horno_electrico`,
  calefactor: `${TOPIC_PREFIX}/devices/calefactor`,
  televisor: `${TOPIC_PREFIX}/devices/televisor_dormitorio`,
  fogDashboard: `${TOPIC_PREFIX}/fog/dashboard`,
  cloudDashboard: `${TOPIC_PREFIX}/cloud/dashboard`,
  control: `${TOPIC_PREFIX}/control`
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

app.use(cors());
app.use(express.json());

let mqttClient = null;
let demoTimer = null;

const state = {
  simHora: "--:--",
  realTimestamp: null,
  smartMeter: 0,
  pvPower: 0,
  evPower: 0,
  batterySoc: 0,
  horno: 0,
  calefactor: 0,
  televisor: 0,
  hornoMode: "apagado",
  calefactorMode: "apagado",
  televisorMode: "apagado",
  energy: {
    totalHouse: 0,
    horno: 0,
    calefactor: 0,
    televisor: 0,
    ev: 0,
    pv: 0
  },
  lastEnergyHora: {
    totalHouse: null,
    horno: null,
    calefactor: null,
    televisor: null,
    ev: null,
    pv: null
  },
  history: [],
  lastChartHora: null,
  costs: {
    priceClpKwh: DEFAULT_PRICE_CLP_KWH
  },
  mqtt: {
    connected: false,
    demoMode: false,
    broker: process.env.MQTT_URL ? maskBroker(process.env.MQTT_URL) : null,
    lastError: null,
    lastMessageAt: null
  }
};

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value) {
  return Math.round(safeNumber(value) * 100) / 100;
}

function round3(value) {
  return Math.round(safeNumber(value) * 1000) / 1000;
}

function maskBroker(url) {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return "broker configurado";
  }
}

function getPower(payload) {
  if (payload?.power_w !== undefined) return safeNumber(payload.power_w);
  if (payload?.total_power_w !== undefined) return safeNumber(payload.total_power_w);
  if (payload?.pv_power !== undefined) return safeNumber(payload.pv_power);
  if (payload?.ev_power !== undefined) return safeNumber(payload.ev_power);
  return 0;
}

function accumulateOncePerSimMinute(bucket, hora, powerW) {
  if (!hora || hora === "--:--") return;
  if (state.lastEnergyHora[bucket] === hora) return;

  state.energy[bucket] += (safeNumber(powerW) * DT_HOURS) / 1000;
  state.lastEnergyHora[bucket] = hora;
}

function buildChartScale(history) {
  const step = 500;
  const values = history.flatMap((item) => [
    safeNumber(item.totalLoad),
    safeNumber(item.pvPower),
    safeNumber(item.gridPower)
  ]);

  const rawMax = Math.max(1, ...values);
  const rawMin = Math.min(0, ...values);
  const maxW = Math.max(step, Math.ceil(rawMax / step) * step);
  const minW = Math.floor(rawMin / step) * step;
  const ticks = [];

  for (let value = minW; value <= maxW; value += step) {
    ticks.push({
      value,
      label: `${value} W`
    });
  }

  return {
    minW,
    maxW,
    stepW: step,
    ticks
  };
}

function computePublicState() {
  const smartMeter = safeNumber(state.smartMeter);
  const pvPower = safeNumber(state.pvPower);
  const evPower = safeNumber(state.evPower);
  const batterySoc = safeNumber(state.batterySoc);
  const horno = safeNumber(state.horno);
  const calefactor = safeNumber(state.calefactor);
  const televisor = safeNumber(state.televisor);
  const monitoredDevicesLoad = horno + calefactor + televisor;
  const totalLoad = smartMeter;
  const gridPower = totalLoad - pvPower;
  const gridImport = Math.max(gridPower, 0);
  const gridExport = Math.max(-gridPower, 0);
  const priceClpKwh = safeNumber(state.costs.priceClpKwh, DEFAULT_PRICE_CLP_KWH);

  const alerts = [];
  const recommendations = [];

  if (totalLoad > 5000) {
    alerts.push("Consumo total elevado");
    recommendations.push("Reducir o desplazar cargas de alta potencia.");
  }

  if (calefactor > 1200) {
    alerts.push("Calefactor en modo de alto consumo");
    recommendations.push("Evaluar reducir potencia del calefactor.");
  }

  if (horno > 1500) {
    alerts.push("Horno electrico en alta demanda");
    recommendations.push("Evitar uso simultaneo de otras cargas intensivas.");
  }

  if (batterySoc < 20) {
    alerts.push("Bateria con bajo estado de carga");
    recommendations.push("Priorizar carga de bateria cuando exista generacion FV.");
  }

  if (pvPower > totalLoad && batterySoc < 90) {
    recommendations.push("Existe excedente FV: conviene cargar bateria.");
  }

  if (gridExport > 0) {
    recommendations.push("Existe excedente energetico disponible.");
  }

  if (evPower > 0 && gridImport > 2500) {
    alerts.push("Carga EV aumenta la demanda desde la red");
    recommendations.push("Reducir o postergar carga del vehiculo electrico.");
  }

  if (evPower > 0 && pvPower > 1000 && gridImport < 500) {
    recommendations.push("Condicion favorable para carga EV con apoyo solar.");
  }

  let systemStatus = "Normal";
  if (alerts.length > 0) systemStatus = "Alerta";
  if (gridExport > 0 && alerts.length === 0) systemStatus = "Excedente FV";

  return {
    simHora: state.simHora,
    realTimestamp: state.realTimestamp,
    smartMeter,
    pvPower,
    evPower,
    batterySoc: round2(batterySoc),
    horno,
    calefactor,
    televisor,
    hornoMode: state.hornoMode || "apagado",
    calefactorMode: state.calefactorMode || "apagado",
    televisorMode: state.televisorMode || "apagado",
    monitoredDevicesLoad,
    totalLoad,
    gridPower,
    gridImport,
    gridExport,
    energy: {
      total_house_kwh: round3(state.energy.totalHouse),
      horno_kwh: round3(state.energy.horno),
      calefactor_kwh: round3(state.energy.calefactor),
      televisor_kwh: round3(state.energy.televisor),
      ev_kwh: round3(state.energy.ev),
      pv_kwh: round3(state.energy.pv)
    },
    costs: {
      price_clp_kwh: priceClpKwh,
      total_house_clp: Math.round(state.energy.totalHouse * priceClpKwh)
    },
    chart: {
      history: state.history,
      scale: buildChartScale(state.history)
    },
    systemStatus,
    alerts,
    recommendations,
    mqtt: state.mqtt
  };
}

function emitState() {
  io.emit("state", computePublicState());
}

function pushHistoryPoint(hora, values = {}) {
  if (!hora || hora === "--:--" || state.lastChartHora === hora) return;

  const publicState = computePublicState();
  state.history.push({
    hora,
    totalLoad: safeNumber(values.totalLoad ?? publicState.totalLoad),
    pvPower: safeNumber(values.pvPower ?? publicState.pvPower),
    gridPower: safeNumber(values.gridPower ?? publicState.gridPower),
    horno: safeNumber(values.horno ?? publicState.horno),
    calefactor: safeNumber(values.calefactor ?? publicState.calefactor),
    televisor: safeNumber(values.televisor ?? publicState.televisor),
    evPower: safeNumber(values.evPower ?? publicState.evPower)
  });
  state.lastChartHora = hora;
}

function processDashboardPayload(payload) {
  const hora = payload?.simHora || payload?.hora || state.simHora || "--:--";
  if (hora !== "--:--") state.simHora = hora;

  state.realTimestamp = payload?.realTimestamp || new Date().toLocaleString("es-CL");
  state.mqtt.lastMessageAt = new Date().toISOString();

  state.smartMeter = safeNumber(payload?.totalLoad ?? payload?.smartMeter ?? state.smartMeter);
  state.pvPower = safeNumber(payload?.pvPower ?? state.pvPower);
  state.evPower = safeNumber(payload?.evPower ?? state.evPower);
  state.batterySoc = safeNumber(payload?.batterySoc ?? state.batterySoc);

  state.horno = safeNumber(payload?.horno ?? state.horno);
  state.calefactor = safeNumber(payload?.calefactor ?? state.calefactor);
  state.televisor = safeNumber(payload?.televisor ?? state.televisor);

  state.hornoMode = payload?.hornoMode || state.hornoMode || "apagado";
  state.calefactorMode = payload?.calefactorMode || state.calefactorMode || "apagado";
  state.televisorMode = payload?.televisorMode || state.televisorMode || "apagado";

  if (payload?.energy) {
    state.energy.totalHouse = safeNumber(payload.energy.total_house_kwh, state.energy.totalHouse);
    state.energy.horno = safeNumber(payload.energy.horno_kwh, state.energy.horno);
    state.energy.calefactor = safeNumber(payload.energy.calefactor_kwh, state.energy.calefactor);
    state.energy.televisor = safeNumber(payload.energy.televisor_kwh, state.energy.televisor);
    state.energy.ev = safeNumber(payload.energy.ev_kwh, state.energy.ev);
    state.energy.pv = safeNumber(payload.energy.pv_kwh, state.energy.pv);
  }

  if (payload?.costs?.price_clp_kwh !== undefined) {
    state.costs.priceClpKwh = safeNumber(payload.costs.price_clp_kwh, state.costs.priceClpKwh);
  }

  pushHistoryPoint(hora, {
    totalLoad: payload?.totalLoad ?? payload?.smartMeter,
    pvPower: payload?.pvPower,
    gridPower: payload?.gridPower,
    horno: payload?.horno,
    calefactor: payload?.calefactor,
    televisor: payload?.televisor,
    evPower: payload?.evPower
  });

  if (state.history.length > MAX_HISTORY) {
    state.history = state.history.slice(state.history.length - MAX_HISTORY);
  }

  emitState();
}

function processTelemetry(topic, payload) {
  if (topic === TOPICS.cloudDashboard || topic === TOPICS.fogDashboard) {
    processDashboardPayload(payload);
    return;
  }

  const hora = payload?.hora || state.simHora || "--:--";
  if (hora !== "--:--") state.simHora = hora;

  state.realTimestamp = new Date().toLocaleString("es-CL");
  state.mqtt.lastMessageAt = new Date().toISOString();

  switch (topic) {
    case TOPICS.smartMeter:
      state.smartMeter = getPower(payload);
      accumulateOncePerSimMinute("totalHouse", hora, state.smartMeter);
      break;
    case TOPICS.pvPower:
      state.pvPower = getPower(payload);
      accumulateOncePerSimMinute("pv", hora, state.pvPower);
      break;
    case TOPICS.evPower:
      state.evPower = getPower(payload);
      accumulateOncePerSimMinute("ev", hora, state.evPower);
      break;
    case TOPICS.batterySoc:
      state.batterySoc = safeNumber(
        payload?.battery_soc ?? payload?.soc_percent ?? state.batterySoc
      );
      break;
    case TOPICS.horno:
      state.horno = getPower(payload);
      state.hornoMode = payload?.mode || "apagado";
      accumulateOncePerSimMinute("horno", hora, state.horno);
      break;
    case TOPICS.calefactor:
      state.calefactor = getPower(payload);
      state.calefactorMode = payload?.mode || "apagado";
      accumulateOncePerSimMinute("calefactor", hora, state.calefactor);
      break;
    case TOPICS.televisor:
      state.televisor = getPower(payload);
      state.televisorMode = payload?.mode || "apagado";
      accumulateOncePerSimMinute("televisor", hora, state.televisor);
      break;
    default:
      return;
  }

  if (topic === TOPICS.smartMeter) {
    pushHistoryPoint(hora);
  }

  if (state.history.length > MAX_HISTORY) {
    state.history = state.history.slice(state.history.length - MAX_HISTORY);
  }

  emitState();
}

function parseMqttPayload(buffer) {
  const text = buffer.toString();
  try {
    return JSON.parse(text);
  } catch {
    return {
      raw: text,
      power_w: safeNumber(text)
    };
  }
}

function startMqtt() {
  const forcedDemo = String(process.env.DEMO_MODE || "false").toLowerCase() === "true";
  const hasBroker = Boolean(process.env.MQTT_URL);

  if (forcedDemo || !hasBroker) {
    startDemoMode(!hasBroker ? "MQTT_URL no configurado" : "DEMO_MODE=true");
    return;
  }

  mqttClient = mqtt.connect(process.env.MQTT_URL, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    clientId: `${process.env.MQTT_CLIENT_ID || "smarthomeplus-web"}-${Math.random()
      .toString(16)
      .slice(2, 8)}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
    rejectUnauthorized: String(process.env.MQTT_REJECT_UNAUTHORIZED || "true") !== "false"
  });

  mqttClient.on("connect", () => {
    state.mqtt.connected = true;
    state.mqtt.demoMode = false;
    state.mqtt.lastError = null;
    mqttClient.subscribe(Object.values(TOPICS).filter((topic) => topic !== TOPICS.control), {
      qos: 0
    });
    emitState();
    console.log(`[mqtt] conectado a ${state.mqtt.broker}`);
  });

  mqttClient.on("message", (topic, buffer) => {
    processTelemetry(topic, parseMqttPayload(buffer));
  });

  mqttClient.on("reconnect", () => {
    state.mqtt.connected = false;
    emitState();
  });

  mqttClient.on("close", () => {
    state.mqtt.connected = false;
    emitState();
  });

  mqttClient.on("error", (error) => {
    state.mqtt.connected = false;
    state.mqtt.lastError = error.message;
    emitState();
    console.error(`[mqtt] ${error.message}`);
  });
}

function startDemoMode(reason) {
  state.mqtt.demoMode = true;
  state.mqtt.connected = true;
  state.mqtt.broker = "modo demo";
  state.mqtt.lastError = reason;
  console.log(`[demo] ${reason}. Generando telemetria local.`);

  let demoMinute = 6 * 60;
  demoTimer = setInterval(() => {
    demoMinute = (demoMinute + 1) % 1440;
    const hora = formatMinute(demoMinute);
    const profile = buildDemoProfile(demoMinute);

    processTelemetry(TOPICS.pvPower, { hora, pv_power: profile.pvPower, power_w: profile.pvPower });
    processTelemetry(TOPICS.evPower, { hora, ev_power: profile.evPower, power_w: profile.evPower });
    processTelemetry(TOPICS.batterySoc, {
      hora,
      battery_soc: profile.batterySoc,
      soc_percent: profile.batterySoc
    });
    processTelemetry(TOPICS.horno, {
      hora,
      device_name: "Horno electrico",
      power_w: profile.horno,
      mode: profile.horno > 0 ? "cocinando" : "apagado"
    });
    processTelemetry(TOPICS.calefactor, {
      hora,
      device_name: "Calefactor",
      power_w: profile.calefactor,
      mode: profile.calefactor > 1000 ? "alto" : profile.calefactor > 0 ? "bajo" : "apagado"
    });
    processTelemetry(TOPICS.televisor, {
      hora,
      device_name: "Televisor dormitorio",
      power_w: profile.televisor,
      mode: profile.televisor > 0 ? "encendido" : "apagado"
    });
    processTelemetry(TOPICS.smartMeter, {
      hora,
      total_power_w: profile.totalLoad,
      power_w: profile.totalLoad
    });
  }, 1000);
}

function formatMinute(minute) {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function inRange(minute, start, end) {
  return minute >= start && minute < end;
}

function buildDemoProfile(minute) {
  const daylight = Math.max(0, Math.sin(((minute - 6 * 60) / (12 * 60)) * Math.PI));
  const pvPower = Math.round(daylight * 3600 + (daylight > 0 ? Math.sin(minute / 9) * 90 : 0));
  const horno = inRange(minute, 12 * 60 + 15, 12 * 60 + 45) || inRange(minute, 19 * 60 + 20, 19 * 60 + 50)
    ? 2100 + Math.round(Math.sin(minute / 3) * 120)
    : 0;
  const calefactor = inRange(minute, 6 * 60 + 30, 8 * 60 + 15) || inRange(minute, 20 * 60, 23 * 60)
    ? 900 + Math.round(Math.sin(minute / 7) * 450)
    : 0;
  const televisor = inRange(minute, 21 * 60, 23 * 60 + 30) ? 95 : 0;
  const evPower = inRange(minute, 1 * 60, 4 * 60 + 30) ? 2400 : 0;
  const base = 420 + Math.round(Math.sin(minute / 17) * 70) + Math.round(Math.sin(minute / 43) * 60);
  const totalLoad = Math.max(120, base + horno + calefactor + televisor + evPower);
  const batterySoc = Math.max(
    8,
    Math.min(98, 45 + Math.sin(((minute - 9 * 60) / 1440) * Math.PI * 2) * 25 + daylight * 25 - (evPower > 0 ? 16 : 0))
  );

  return {
    totalLoad,
    pvPower: Math.max(0, pvPower),
    evPower,
    batterySoc: round2(batterySoc),
    horno,
    calefactor: Math.max(0, calefactor),
    televisor
  };
}

io.on("connection", (socket) => {
  socket.emit("state", computePublicState());

  socket.on("tariff:update", (value) => {
    const nextPrice = safeNumber(value, state.costs.priceClpKwh);
    if (nextPrice >= 0) {
      state.costs.priceClpKwh = nextPrice;
      emitState();
    }
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mqtt: state.mqtt,
    topics: TOPICS
  });
});

app.get("/api/state", (_req, res) => {
  res.json(computePublicState());
});

app.post("/api/tariff", (req, res) => {
  const nextPrice = safeNumber(req.body?.price_clp_kwh, state.costs.priceClpKwh);
  if (nextPrice < 0) {
    res.status(400).json({ error: "La tarifa no puede ser negativa." });
    return;
  }

  state.costs.priceClpKwh = nextPrice;
  emitState();
  res.json(computePublicState().costs);
});

const clientDist = path.resolve(__dirname, "..", "dist", "client");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.type("html").send(`
      <main style="font-family: Arial, sans-serif; padding: 32px;">
        <h1>Smart Home+</h1>
        <p>Backend activo. Ejecuta <code>npm run build</code> para servir el frontend desde este proceso.</p>
      </main>
    `);
  });
}

server.listen(PORT, () => {
  console.log(`[server] Smart Home+ web escuchando en puerto ${PORT}`);
  startMqtt();
});

process.on("SIGTERM", () => {
  if (demoTimer) clearInterval(demoTimer);
  if (mqttClient) mqttClient.end(true);
  server.close(() => process.exit(0));
});
