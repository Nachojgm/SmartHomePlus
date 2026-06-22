import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BatteryCharging,
  Flame,
  Gauge,
  Home,
  Monitor,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Sun,
  ThermometerSun,
  WalletCards,
  Wifi,
  WifiOff,
  Zap
} from "lucide-react";

const emptyState = {
  simHora: "--:--",
  totalLoad: 0,
  pvPower: 0,
  gridPower: 0,
  gridImport: 0,
  gridExport: 0,
  evPower: 0,
  batterySoc: 0,
  horno: 0,
  calefactor: 0,
  televisor: 0,
  hornoMode: "apagado",
  calefactorMode: "apagado",
  televisorMode: "apagado",
  monitoredDevicesLoad: 0,
  energy: {
    total_house_kwh: 0,
    horno_kwh: 0,
    calefactor_kwh: 0,
    televisor_kwh: 0,
    ev_kwh: 0,
    pv_kwh: 0
  },
  costs: {
    price_clp_kwh: 200,
    total_house_clp: 0
  },
  chart: {
    history: [],
    scale: {
      minW: 0,
      maxW: 3000,
      stepW: 500,
      ticks: []
    }
  },
  alerts: [],
  recommendations: [],
  systemStatus: "Sin datos",
  mqtt: {
    connected: false,
    demoMode: false,
    broker: null,
    lastError: null,
    lastMessageAt: null
  }
};

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString("es-CL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatClp(value) {
  return `$${Math.round(Number(value || 0)).toLocaleString("es-CL")} CLP`;
}

function readInitialTariff() {
  const saved = Number(localStorage.getItem("smartHomeTariffClpKwh"));
  return Number.isFinite(saved) && saved >= 0 ? saved : 200;
}

function App() {
  const [view, setView] = useState("welcome");
  const [state, setState] = useState(emptyState);
  const [socketStatus, setSocketStatus] = useState("connecting");
  const socketRef = useRef(null);
  const [tariff, setTariff] = useState(readInitialTariff);
  const [tariffInput, setTariffInput] = useState(() => String(readInitialTariff()));

  useEffect(() => {
    const socket = io({
      transports: ["websocket", "polling"]
    });
    socketRef.current = socket;

    socket.on("connect", () => setSocketStatus("connected"));
    socket.on("disconnect", () => setSocketStatus("disconnected"));
    socket.on("connect_error", () => setSocketStatus("error"));
    socket.on("state", (nextState) => {
      setState((previous) => ({
        ...previous,
        ...nextState,
        energy: {
          ...previous.energy,
          ...(nextState.energy || {})
        },
        costs: {
          ...previous.costs,
          ...(nextState.costs || {})
        },
        chart: {
          ...previous.chart,
          ...(nextState.chart || {})
        },
        mqtt: {
          ...previous.mqtt,
          ...(nextState.mqtt || {})
        }
      }));

      const payloadTariff = Number(nextState?.costs?.price_clp_kwh);
      const savedTariff = Number(localStorage.getItem("smartHomeTariffClpKwh"));
      if (!Number.isFinite(savedTariff) && Number.isFinite(payloadTariff)) {
        setTariff(payloadTariff);
        setTariffInput(String(payloadTariff));
      }
    });

    return () => {
      socketRef.current = null;
      socket.close();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("smartHomeTariffClpKwh", String(tariff));
  }, [tariff]);

  const cost = useMemo(() => {
    return Number(state.energy?.total_house_kwh || 0) * Number(tariff || 0);
  }, [state.energy?.total_house_kwh, tariff]);

  const updateTariff = (value) => {
    const text = String(value).replace(/\D/g, "");
    setTariffInput(text);

    if (text === "") return;

    const next = Number(text);
    if (!Number.isFinite(next) || next < 0) return;

    setTariff(next);
    socketRef.current?.emit("tariff:update", next);
  };

  const normalizeTariffInput = () => {
    if (tariffInput.trim() === "") {
      setTariffInput(String(tariff));
      return;
    }

    setTariffInput(String(Number(tariffInput)));
  };

  if (view === "welcome") {
    return <Welcome state={state} onEnter={() => setView("dashboard")} socketStatus={socketStatus} />;
  }

  return (
    <main className="app-shell">
      <DashboardHeader
        state={state}
        socketStatus={socketStatus}
        onHome={() => setView("welcome")}
      />

      <section className="dashboard-grid">
        <div className="dashboard-main">
          <MetricGrid state={state} />
          <EnergyChart history={state.chart?.history || []} />
          <ConsumptionPanel state={state} />
        </div>

        <aside className="dashboard-side">
          <CostPanel
            tariff={tariff}
            tariffInput={tariffInput}
            setTariff={updateTariff}
            onTariffBlur={normalizeTariffInput}
            energyKwh={state.energy?.total_house_kwh || 0}
            cost={cost}
          />
          <BalancePanel state={state} />
          <FogPanel alerts={state.alerts || []} recommendations={state.recommendations || []} />
        </aside>
      </section>
    </main>
  );
}

function Welcome({ state, onEnter, socketStatus }) {
  const isConnected = socketStatus === "connected";

  return (
    <main className="welcome-page">
      <section className="welcome-content">
        <div className="brand-row">
          <span className="brand-mark">
            <Home size={22} />
          </span>
          <span>Smart Home+</span>
        </div>

        <h1>Monitoreo energetico IoT-Fog-Cloud</h1>
        <p>
          Dashboard publico para observar consumo, generacion fotovoltaica, bateria,
          red electrica y cargas principales de la vivienda emulada.
        </p>

        <div className="welcome-actions">
          <button className="primary-button" type="button" onClick={onEnter}>
            Ver estado de la casa
            <ArrowRight size={18} />
          </button>
          <ConnectionBadge connected={isConnected} demo={state.mqtt?.demoMode} />
        </div>

        <div className="welcome-stats">
          <span>
            <b>{state.simHora || "--:--"}</b>
            Hora simulada
          </span>
          <span>
            <b>{formatNumber(state.totalLoad)} W</b>
            Consumo actual
          </span>
          <span>
            <b>{formatNumber(state.pvPower)} W</b>
            Generacion FV
          </span>
        </div>
      </section>

      <EnergyHouseScene state={state} />
    </main>
  );
}

function EnergyHouseScene({ state }) {
  const loadPct = Math.min(100, (Number(state.totalLoad || 0) / 5500) * 100);
  const solarPct = Math.min(100, (Number(state.pvPower || 0) / 3600) * 100);
  const batteryPct = Math.min(100, Number(state.batterySoc || 0));

  return (
    <section className="house-scene" aria-label="Resumen visual de energia">
      <div className="sun-disc">
        <Sun size={36} />
      </div>
      <div className="house-roof" />
      <div className="house-body">
        <div className="house-window active" />
        <div className="house-door" />
        <div className="house-window" />
      </div>
      <div className="energy-flow solar-flow" style={{ width: `${Math.max(18, solarPct)}%` }} />
      <div className="energy-flow load-flow" style={{ width: `${Math.max(18, loadPct)}%` }} />

      <div className="scene-meters">
        <SceneMeter label="FV" value={`${formatNumber(state.pvPower)} W`} icon={<Sun size={18} />} />
        <SceneMeter label="Casa" value={`${formatNumber(state.totalLoad)} W`} icon={<Zap size={18} />} />
        <SceneMeter label="Bateria" value={`${formatNumber(batteryPct)} %`} icon={<BatteryCharging size={18} />} />
      </div>
    </section>
  );
}

function SceneMeter({ label, value, icon }) {
  return (
    <div className="scene-meter">
      {icon}
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function DashboardHeader({ state, socketStatus, onHome }) {
  const statusClass = String(state.systemStatus || "").toLowerCase().replace(/\s+/g, "-");

  return (
    <header className="dashboard-header">
      <button className="ghost-button" type="button" onClick={onHome}>
        <Home size={18} />
        Inicio
      </button>

      <div>
        <h1>Smart Home+</h1>
        <p>Dashboard cloud conectado a HiveMQ</p>
      </div>

      <div className="header-live">
        <div className={`status-pill ${statusClass}`}>{state.systemStatus || "Sin datos"}</div>
        <div className="clock-box">
          <span>Hora simulada</span>
          <b>{state.simHora || "--:--"}</b>
        </div>
        <ConnectionBadge
          connected={socketStatus === "connected" && state.mqtt?.connected}
          demo={state.mqtt?.demoMode}
        />
      </div>
    </header>
  );
}

function ConnectionBadge({ connected, demo }) {
  return (
    <span className={`connection-badge ${connected ? "connected" : "offline"}`}>
      {connected ? <Wifi size={16} /> : <WifiOff size={16} />}
      {demo ? "Modo demo" : connected ? "En vivo" : "Reconectando"}
    </span>
  );
}

function MetricGrid({ state }) {
  return (
    <section className="metric-grid">
      <MetricCard
        icon={<Activity />}
        label="Consumo total"
        value={`${formatNumber(state.totalLoad)} W`}
        hint="SmartMeter de la vivienda"
        tone="dark"
      />
      <MetricCard
        icon={<Sun />}
        label="Generacion FV"
        value={`${formatNumber(state.pvPower)} W`}
        hint="Panel fotovoltaico emulado"
        tone="solar"
      />
      <MetricCard
        icon={<BatteryCharging />}
        label="Bateria"
        value={`${formatNumber(state.batterySoc)} %`}
        hint="Estado de carga BESS"
        tone="battery"
      />
      <MetricCard
        icon={<Gauge />}
        label="Red electrica"
        value={`${formatNumber(state.gridPower)} W`}
        hint={Number(state.gridPower || 0) >= 0 ? "Importando desde red" : "Exportando a red"}
        tone="grid"
      />
    </section>
  );
}

function MetricCard({ icon, label, value, hint, tone }) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-top">
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function EnergyChart({ history }) {
  const [visible, setVisible] = useState({
    totalLoad: true,
    pvPower: true,
    gridPower: true
  });
  const [hoverIndex, setHoverIndex] = useState(null);

  const chart = useMemo(() => buildChart(history, visible), [history, visible]);
  const hovered = hoverIndex !== null ? history[hoverIndex] : null;

  const toggle = (key) => {
    setVisible((current) => ({
      ...current,
      [key]: !current[key]
    }));
  };

  const handleMove = (event) => {
    if (!history.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.max(0, Math.min(history.length - 1, Math.round(ratio * (history.length - 1))));
    setHoverIndex(index);
  };

  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div>
          <h2>Grafico energetico</h2>
          <p>Historial de las ultimas mediciones recibidas.</p>
        </div>
        <div className="chart-toggles">
          <Toggle active={visible.totalLoad} onClick={() => toggle("totalLoad")} color="blue">
            Consumo
          </Toggle>
          <Toggle active={visible.pvPower} onClick={() => toggle("pvPower")} color="amber">
            FV
          </Toggle>
          <Toggle active={visible.gridPower} onClick={() => toggle("gridPower")} color="violet">
            Red
          </Toggle>
        </div>
      </div>

      <div className="chart-frame" onMouseMove={handleMove} onMouseLeave={() => setHoverIndex(null)}>
        <svg viewBox="0 0 760 300" preserveAspectRatio="none">
          {chart.ticks.map((tick) => (
            <g key={tick.value}>
              <line x1="72" x2="738" y1={tick.y} y2={tick.y} className="chart-grid" />
              <text x="58" y={tick.y + 5} textAnchor="end" className="axis-label">
                {tick.value} W
              </text>
            </g>
          ))}
          <line x1="72" x2="738" y1={chart.zeroY} y2={chart.zeroY} className="zero-line" />
          <line x1="72" x2="738" y1="256" y2="256" className="axis-line" />
          <line x1="72" x2="72" y1="24" y2="256" className="axis-line" />

          {visible.totalLoad && <polyline points={chart.lines.totalLoad} className="series total" />}
          {visible.pvPower && <polyline points={chart.lines.pvPower} className="series solar" />}
          {visible.gridPower && <polyline points={chart.lines.gridPower} className="series grid" />}

          {hovered && (
            <g>
              <line x1={chart.hoverX(hoverIndex)} x2={chart.hoverX(hoverIndex)} y1="24" y2="256" className="hover-line" />
              <circle cx={chart.hoverX(hoverIndex)} cy={chart.valueY(hovered.totalLoad)} r="5" className="dot-blue" />
              <circle cx={chart.hoverX(hoverIndex)} cy={chart.valueY(hovered.pvPower)} r="5" className="dot-amber" />
              <circle cx={chart.hoverX(hoverIndex)} cy={chart.valueY(hovered.gridPower)} r="5" className="dot-violet" />
            </g>
          )}
        </svg>

        {hovered && (
          <div className="chart-tooltip">
            <b>{hovered.hora}</b>
            <span>Consumo: {formatNumber(hovered.totalLoad)} W</span>
            <span>FV: {formatNumber(hovered.pvPower)} W</span>
            <span>Red: {formatNumber(hovered.gridPower)} W</span>
          </div>
        )}
      </div>

      <div className="chart-footer">
        <span>{history[0]?.hora || "--:--"}</span>
        <span>{history[history.length - 1]?.hora || "--:--"}</span>
      </div>
    </section>
  );
}

function Toggle({ active, onClick, color, children }) {
  return (
    <button className={`toggle ${color} ${active ? "active" : ""}`} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function buildChart(history, visible) {
  const left = 72;
  const right = 738;
  const top = 24;
  const bottom = 256;
  const visibleKeys = Object.entries(visible)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
  const values = history.flatMap((item) => visibleKeys.map((key) => Number(item[key] || 0)));
  const rawMax = Math.max(1, ...values);
  const rawMin = Math.min(0, ...values);
  const maxW = Math.max(500, Math.ceil(rawMax / 500) * 500);
  const minW = Math.floor(rawMin / 500) * 500;
  const range = maxW - minW || 500;

  const valueY = (value) => bottom - ((Number(value || 0) - minW) / range) * (bottom - top);
  const indexX = (index) => left + (history.length <= 1 ? 0 : (index * (right - left)) / (history.length - 1));
  const line = (key) => history.map((item, index) => `${indexX(index)},${valueY(item[key])}`).join(" ");
  const ticks = [];

  for (let value = minW; value <= maxW; value += 500) {
    ticks.push({
      value,
      y: valueY(value)
    });
  }

  return {
    ticks,
    zeroY: valueY(0),
    valueY,
    hoverX: indexX,
    lines: {
      totalLoad: line("totalLoad"),
      pvPower: line("pvPower"),
      gridPower: line("gridPower")
    }
  };
}

function ConsumptionPanel({ state }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Consumo por equipo</h2>
          <p>Cargas principales reportadas como topics independientes.</p>
        </div>
        <span className="mini-badge">{formatNumber(state.monitoredDevicesLoad)} W monitoreados</span>
      </div>

      <div className="device-grid">
        <DeviceCard
          icon={<Flame />}
          name="Horno electrico"
          power={state.horno}
          mode={state.hornoMode}
          energy={state.energy?.horno_kwh}
        />
        <DeviceCard
          icon={<ThermometerSun />}
          name="Calefactor"
          power={state.calefactor}
          mode={state.calefactorMode}
          energy={state.energy?.calefactor_kwh}
        />
        <DeviceCard
          icon={<Monitor />}
          name="Televisor dormitorio"
          power={state.televisor}
          mode={state.televisorMode}
          energy={state.energy?.televisor_kwh}
        />
      </div>
    </section>
  );
}

function DeviceCard({ icon, name, power, mode, energy }) {
  const active = Number(power || 0) > 0;

  return (
    <article className={`device-card ${active ? "active" : ""}`}>
      <div className="device-icon">{icon}</div>
      <div>
        <h3>{name}</h3>
        <strong>{formatNumber(power)} W</strong>
        <span>Modo: {mode || "apagado"}</span>
        <small>{formatNumber(energy, 3)} kWh acumulados</small>
      </div>
    </article>
  );
}

function CostPanel({ tariffInput, setTariff, onTariffBlur, energyKwh, cost }) {
  return (
    <section className="panel cost-panel">
      <div className="panel-heading">
        <div>
          <h2>Gasto total</h2>
          <p>Calculado desde el topic SmartMeter.</p>
        </div>
        <WalletCards size={24} />
      </div>

      <label className="tariff-control">
        Tarifa CLP/kWh
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={tariffInput}
          onChange={(event) => setTariff(event.target.value)}
          onBlur={onTariffBlur}
        />
      </label>

      <div className="cost-summary">
        <span>
          Energia casa
          <b>{formatNumber(energyKwh, 3)} kWh</b>
        </span>
        <span className="cost-highlight">
          Gasto estimado
          <b>{formatClp(cost)}</b>
        </span>
      </div>
    </section>
  );
}

function BalancePanel({ state }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Balance</h2>
          <p>Energia importada, exportada y movilidad electrica.</p>
        </div>
        <RefreshCw size={22} />
      </div>
      <div className="balance-grid">
        <BalanceItem icon={<PlugZap />} label="Importacion red" value={`${formatNumber(state.gridImport)} W`} />
        <BalanceItem icon={<Zap />} label="Exportacion red" value={`${formatNumber(state.gridExport)} W`} />
        <BalanceItem icon={<PlugZap />} label="Carga EV" value={`${formatNumber(state.evPower)} W`} />
        <BalanceItem icon={<BatteryCharging />} label="Energia FV" value={`${formatNumber(state.energy?.pv_kwh, 3)} kWh`} />
      </div>
    </section>
  );
}

function BalanceItem({ icon, label, value }) {
  return (
    <div className="balance-item">
      {icon}
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function FogPanel({ alerts, recommendations }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Decisiones Fog</h2>
          <p>Alertas y recomendaciones derivadas del estado energetico.</p>
        </div>
        {alerts.length ? <AlertTriangle size={24} /> : <ShieldCheck size={24} />}
      </div>

      <div className="fog-list">
        {alerts.length ? (
          alerts.map((alert) => (
            <div className="alert-row" key={alert}>
              <AlertTriangle size={17} />
              {alert}
            </div>
          ))
        ) : (
          <div className="ok-row">
            <ShieldCheck size={17} />
            Sistema operando normalmente
          </div>
        )}
      </div>

      <h3>Recomendaciones</h3>
      {recommendations.length ? (
        <ul className="recommendations">
          {recommendations.map((recommendation) => (
            <li key={recommendation}>{recommendation}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">No hay recomendaciones activas.</p>
      )}
    </section>
  );
}

export default App;
