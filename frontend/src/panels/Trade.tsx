import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { fmt, pct, useApp } from "../store";
import { useUI } from "../uiState";
import { Card, Field, Num, ProbBar, Seg } from "../ui";

export default function Trade() {
  const { s, toast } = useApp();
  const ui = useUI();
  const pv = ui.preview;
  const atr = s.signals?.atr || 60;
  const [slAtr, setSlAtr] = useState(0.25);
  const [tpR, setTpR] = useState(2);
  const [sizing, setSizing] = useState<"risk" | "lots">("risk");
  const [riskPct, setRiskPct] = useState<number>(s.settings?.risk?.risk_pct ?? 0.3);
  const [lots, setLots] = useState(0.1);
  const [kind, setKind] = useState<"market" | "limit" | "stop">("market");
  const [pred, setPred] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const t = s.tick;
  const connected = s.status === "conectado";
  const canSend = connected && (s.broker === "sim" || ((s.role === "owner" || s.role === "trader") && !!s.ea?.online));
  const why = !connected ? "" : s.broker === "cloud" && !(s.role === "owner" || s.role === "trader") ? "Tu acceso a esta cuenta es de solo lectura." : s.broker === "cloud" && !s.ea?.online ? "El EA no está conectado: abre MT5 con el EA puente para poder operar." : "";

  const dpWhy: string | null = s.broker === "cloud" ? s.market?.discipline?.why || null : null;

  const start = (side: number) => {
    if (!t) return;
    const entry = side > 0 ? t.ask : t.bid;
    const e = kind === "market" ? entry : kind === "limit" ? entry - side * atr * 0.1 : entry + side * atr * 0.1;
    const d = slAtr * atr;
    ui.setPreview({ side, kind, entry: round(e), sl: round(e - side * d), tp: tpR > 0 ? round(e + side * d * tpR) : 0 });
  };

  // a mercado, la entrada sigue al precio
  useEffect(() => {
    if (!pv || pv.kind !== "market" || !t) return;
    const e = pv.side > 0 ? t.ask : t.bid;
    if (Math.abs(e - pv.entry) >= 0.01) ui.setPreview((p) => (p ? { ...p, entry: round(e) } : p));
  }, [t?.bid, t?.ask]);

  // probabilidades del modelo al mover SL/TP
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!pv || !connected) { setPred(null); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api("/api/predict", "POST", { side: pv.side, entry: pv.entry, sl: pv.sl, tp: pv.tp, risk_pct: sizing === "risk" ? riskPct : undefined }).then(setPred).catch(() => {});
    }, 250);
  }, [pv?.sl, pv?.tp, Math.round((pv?.entry ?? 0) * 2), pv?.side, riskPct, sizing]);

  const send = async () => {
    if (!pv) return;
    setBusy(true);
    try {
      const body: any = { side: pv.side, kind: pv.kind, sl: pv.sl, tp: pv.tp, price: pv.kind === "market" ? undefined : pv.entry };
      if (sizing === "lots") body.lots = lots; else body.risk_pct = riskPct;
      const r = await api("/api/order", "POST", body);
      toast(`${pv.side > 0 ? "Compra" : "Venta"} ${r.lots ?? ""} lotes ${s.broker === "cloud" ? "ejecutada en MT5" : "enviada"}${r.price ? ` @ ${fmt(r.price)}` : ""}`, "ok");
      ui.setPreview(null);
    } catch (e: any) {
      toast(e.message, "error");
    } finally { setBusy(false); }
  };

  const riskD = pv ? Math.abs(pv.entry - pv.sl) : 0;
  const rr = pv && pv.tp && riskD ? Math.abs(pv.tp - pv.entry) / riskD : 0;
  const scaleRisk = s.broker === "sim" && sizing === "risk" && s.settings?.risk?.risk_pct ? riskPct / s.settings.risk.risk_pct : 1;
  const estLots = sizing === "lots" ? lots : pred ? Math.floor((pred.lots * scaleRisk) * 100) / 100 : null;
  const contract = s.settings?.contract_size || 100;

  return (
    <div className="col">
      <div className="row">
        <button className={`bigbtn sell ${pv && pv.side < 0 ? "" : pv ? "off" : ""}`} disabled={!t} onClick={() => start(-1)}>
          <span>VENDER</span><span className="p">{t ? fmt(t.bid) : "–"}</span>
        </button>
        <button className={`bigbtn buy ${pv && pv.side > 0 ? "" : pv ? "off" : ""}`} disabled={!t} onClick={() => start(1)}>
          <span>COMPRAR</span><span className="p">{t ? fmt(t.ask) : "–"}</span>
        </button>
      </div>
      <div className="row between">
        <Seg value={kind} options={[["market", "Mercado"], ["limit", "Límite"], ["stop", "Stop"]]} onChange={(k) => { setKind(k); if (pv) ui.setPreview(null); }} />
        <span className="small muted">ATR diario {fmt(atr)}</span>
      </div>
      <div className="grid2">
        <Field label="SL inicial (× ATR)"><Num value={slAtr} step={0.05} min={0.02} onChange={setSlAtr} /></Field>
        <Field label="TP inicial (× riesgo, 0 = sin TP)"><Num value={tpR} step={0.5} min={0} onChange={setTpR} /></Field>
      </div>
      <div className="row between">
        <Seg value={sizing} options={[["risk", "Por riesgo %"], ["lots", "Lotes fijos"]]} onChange={setSizing} />
        {sizing === "risk" ? <div style={{ width: 110 }}><Num value={riskPct} step={0.05} min={0.01} onChange={setRiskPct} /></div> : <div style={{ width: 110 }}><Num value={lots} step={0.01} min={0.01} onChange={setLots} /></div>}
      </div>

      {pv ? (
        <Card title={`Orden ${pv.side > 0 ? "de compra" : "de venta"} ${pv.kind === "market" ? "a mercado" : pv.kind === "limit" ? "límite" : "stop"}`} right={<button className="btn sm ghost" onClick={() => ui.setPreview(null)}>Cancelar</button>}>
          <div className="grid3">
            <Field label="Entrada"><Num value={pv.entry} disabled={pv.kind === "market"} onChange={(v) => ui.setPreview((p) => p ? { ...p, entry: v } : p)} /></Field>
            <Field label="Stop loss"><Num value={pv.sl} onChange={(v) => ui.setPreview((p) => p ? { ...p, sl: v } : p)} /></Field>
            <Field label="Take profit"><Num value={pv.tp} onChange={(v) => ui.setPreview((p) => p ? { ...p, tp: v } : p)} /></Field>
          </div>
          <div className="grid3 mono small" style={{ marginTop: 8 }}>
            <div><div className="muted">Lotes</div>{estLots ?? "–"}</div>
            <div><div className="muted">Riesgo</div><span className="sell">-{fmt((estLots ?? 0) * riskD * contract)}</span></div>
            <div><div className="muted">Beneficio</div><span className="buy">{pv.tp ? `+${fmt((estLots ?? 0) * Math.abs(pv.tp - pv.entry) * contract)}` : "sin TP"}</span></div>
          </div>
          <div className="small muted" style={{ margin: "6px 0" }}>Relación {rr ? `1 : ${rr.toFixed(2)}` : "–"} · SL {fmt(riskD)} $/oz ({(riskD / atr).toFixed(2)} ATR)</div>
          <div style={{ marginTop: 6 }}>
            <div className="small" style={{ marginBottom: 4 }}><b>IA: qué suele pasar con una entrada así (próximas 4 h)</b></div>
            <ProbBar probs={pred?.pred?.probs} />
            {pred?.pred ? (
              <div className="row small" style={{ marginTop: 6, gap: 14 }}>
                <span>Termina en ganancia: <b className={pred.pred.p_ganancia >= 0.5 ? "buy" : "sell"}>{pct(pred.pred.p_ganancia)}</b></span>
                <span>R esperado: <b className={pred.pred.exp_R >= 0 ? "buy" : "sell"}>{pred.pred.exp_R >= 0 ? "+" : ""}{pred.pred.exp_R.toFixed(2)}</b></span>
              </div>
            ) : null}
            <div className="hint" style={{ marginTop: 4 }}>Probabilidades según volatilidad, hora y distancias de SL/TP (calibradas fuera de muestra). No predicen la dirección.</div>
          </div>
          {pred?.risk_note ? <div className="warnbox" style={{ marginTop: 8 }}>{pred.risk_note}</div> : null}
          {s.risk?.blocked ? <div className="errbox" style={{ marginTop: 8 }}>Cuenta bloqueada: {s.risk.blocked}</div> : null}
          {why ? <div className="warnbox small" style={{ marginTop: 8 }}>{why}</div> : null}
          {dpWhy ? <div className="errbox small" style={{ marginTop: 8 }}>Protector de disciplina: {dpWhy}. El EA no abrirá esta operación{s.market.discipline.until ? ` hasta las ${new Date((s.market.discipline.until - (s.news_offset ?? 7200)) * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : ""}.</div> : null}
          <button className={`btn primary`} style={{ width: "100%", marginTop: 10, background: pv.side > 0 ? "#22b07d" : "#e5534b", borderColor: "transparent", color: "#fff" }} disabled={busy || !canSend || !!dpWhy} onClick={send}>
            {busy ? (s.broker === "cloud" ? "Enviando al EA…" : "Enviando…") : `Confirmar ${pv.side > 0 ? "COMPRA" : "VENTA"}`}
          </button>
        </Card>
      ) : (
        <div className="hint">Pulsa COMPRAR o VENDER para preparar la orden: aparecerán las líneas de entrada, SL y TP en el gráfico para que las arrastres. Después confirmas.</div>
      )}

      <OpenPositionsMini />
    </div>
  );
}

function round(v: number) { return Math.round(v * 100) / 100; }

function OpenPositionsMini() {
  const { s, toast } = useApp();
  if (!s.positions.length) return null;
  const close = async (ticket: number, volume?: number) => {
    try { await api("/api/position/close", "POST", { ticket, volume }); toast("Cerrada", "ok"); } catch (e: any) { toast(e.message, "error"); }
  };
  const be = async (ticket: number) => {
    try { await api("/api/position/breakeven", "POST", { ticket }); toast("SL a break-even", "ok"); } catch (e: any) { toast(e.message, "error"); }
  };
  return (
    <Card title="Posiciones abiertas">
      {s.positions.map((p) => (
        <div key={p.ticket} className="row between" style={{ padding: "5px 0", borderBottom: "1px solid #1e2534" }}>
          <div>
            <div><b className={p.side > 0 ? "buy" : "sell"}>{p.side > 0 ? "Compra" : "Venta"}</b> {p.volume} <span className="muted small">{p.comment}</span></div>
            <div className="small muted mono">@{fmt(p.price_open)} · SL {fmt(p.sl)} · TP {fmt(p.tp)}</div>
          </div>
          <div className="row">
            <b className={`mono ${p.profit >= 0 ? "buy" : "sell"}`}>{p.profit >= 0 ? "+" : ""}{fmt(p.profit)}</b>
            <button className="btn sm" onClick={() => be(p.ticket)} title="Mover SL a la entrada">BE</button>
            <button className="btn sm" onClick={() => close(p.ticket, Math.max(0.01, Math.round(p.volume * 50) / 100))} title="Cerrar la mitad">½</button>
            <button className="btn sm danger" onClick={() => close(p.ticket)}>✕</button>
          </div>
        </div>
      ))}
    </Card>
  );
}
