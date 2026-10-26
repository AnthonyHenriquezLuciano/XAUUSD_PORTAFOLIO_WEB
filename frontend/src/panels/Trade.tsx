import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Icon } from "../icons";
import { fmt, pct, useApp } from "../store";
import { useUI } from "../uiState";
import { Card, Field, Num, ProbBar, Seg, Tip } from "../ui";

const KIND_TXT = { market: "a mercado", limit: "límite", stop: "stop" };

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
  const why = !connected ? "" : s.broker === "cloud" && !(s.role === "owner" || s.role === "trader") ? "Acceso de solo lectura." : s.broker === "cloud" && !s.ea?.online ? "EA desconectado: abre MT5 con el EA para operar." : "";
  const dpWhy: string | null = s.broker === "cloud" ? s.market?.discipline?.why || null : null;

  const start = (side: number) => {
    if (!t) return;
    if (pv && pv.side === side) { ui.setPreview(null); return; }
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
  const set = (k: "entry" | "sl" | "tp") => (v: number) => ui.setPreview((p) => (p ? { ...p, [k]: v } : p));

  return (
    <div className="stack">
      <section className="ticket">
        <div className="sides">
          <button className={`bigbtn sell ${pv && pv.side > 0 ? "off" : ""} ${pv && pv.side < 0 ? "sel" : ""}`} disabled={!t} onClick={() => start(-1)}>
            <span>VENDER</span><span className="p">{t ? fmt(t.bid) : "–"}</span>
          </button>
          <button className={`bigbtn buy ${pv && pv.side < 0 ? "off" : ""} ${pv && pv.side > 0 ? "sel" : ""}`} disabled={!t} onClick={() => start(1)}>
            <span>COMPRAR</span><span className="p">{t ? fmt(t.ask) : "–"}</span>
          </button>
        </div>
        <Seg full value={kind} options={[["market", "Mercado"], ["limit", "Límite"], ["stop", "Stop"]]} onChange={(k) => { setKind(k); if (pv) ui.setPreview(null); }} />
        <div className="grid3">
          <Field label="SL" tip={`Distancia del stop en múltiplos del ATR diario (${fmt(atr)}).`}><Num value={slAtr} step={0.05} min={0.02} onChange={setSlAtr} suffix="ATR" /></Field>
          <Field label="TP" tip="Objetivo en múltiplos del riesgo. 0 = sin TP."><Num value={tpR} step={0.5} min={0} onChange={setTpR} suffix="R" /></Field>
          <div className="field">
            <span className="field-l"><button type="button" className="linkbtn" onClick={() => setSizing(sizing === "risk" ? "lots" : "risk")} title="Cambiar entre riesgo % y lotes fijos">{sizing === "risk" ? "Riesgo" : "Lotes"} <Icon name="chevron" size={12} /></button></span>
            {sizing === "risk" ? <Num value={riskPct} step={0.05} min={0.01} onChange={setRiskPct} suffix="%" /> : <Num value={lots} step={0.01} min={0.01} onChange={setLots} suffix="lot" />}
          </div>
        </div>

        {pv ? (
          <div className={`order ${pv.side > 0 ? "is-buy" : "is-sell"}`}>
            <div className="order-h">
              <b>{pv.side > 0 ? "Compra" : "Venta"} {KIND_TXT[pv.kind]}</b>
              <button className="iconbtn" onClick={() => ui.setPreview(null)} aria-label="Cancelar orden" title="Cancelar"><Icon name="close" size={16} /></button>
            </div>
            <div className="grid3">
              <Field label="Entrada"><Num value={pv.entry} disabled={pv.kind === "market"} onChange={set("entry")} /></Field>
              <Field label="Stop loss"><Num value={pv.sl} onChange={set("sl")} /></Field>
              <Field label="Take profit"><Num value={pv.tp} onChange={set("tp")} /></Field>
            </div>
            <div className="order-nums">
              <div><span>Lotes</span><b>{estLots ?? "–"}</b></div>
              <div><span>Riesgo</span><b className="sell">−{fmt((estLots ?? 0) * riskD * contract)}</b></div>
              <div><span>Beneficio</span><b className="buy">{pv.tp ? `+${fmt((estLots ?? 0) * Math.abs(pv.tp - pv.entry) * contract)}` : "—"}</b></div>
              <div><span>R:R</span><b>{rr ? `1:${rr.toFixed(1)}` : "—"}</b></div>
            </div>
            <div className="order-ai">
              <span className="field-l">Próximas 4 h<Tip text="Qué suele pasar con una entrada así según la volatilidad, la hora y las distancias de SL/TP (modelo calibrado fuera de muestra). No predice la dirección." size={13} /></span>
              <ProbBar probs={pred?.pred?.probs} />
              {pred?.pred ? <div className="order-ai-n"><span>Ganancia <b className={pred.pred.p_ganancia >= 0.5 ? "buy" : "sell"}>{pct(pred.pred.p_ganancia)}</b></span><span>R esperado <b className={pred.pred.exp_R >= 0 ? "buy" : "sell"}>{pred.pred.exp_R >= 0 ? "+" : ""}{pred.pred.exp_R.toFixed(2)}</b></span></div> : null}
            </div>
            {pred?.risk_note ? <div className="note warn">{pred.risk_note}</div> : null}
            {s.risk?.blocked ? <div className="note bad">Cuenta bloqueada: {s.risk.blocked}</div> : null}
            {why ? <div className="note warn">{why}</div> : null}
            {dpWhy ? <div className="note bad">Protector de disciplina: {dpWhy}</div> : null}
            <button className={`confirm ${pv.side > 0 ? "buy" : "sell"}`} disabled={busy || !canSend || !!dpWhy} onClick={send}>
              {busy ? (s.broker === "cloud" ? "Enviando al EA…" : "Enviando…") : `Confirmar ${pv.side > 0 ? "COMPRA" : "VENTA"}`}
            </button>
          </div>
        ) : <div className="ticket-hint">Elige compra o venta y ajusta SL y TP en el gráfico.</div>}
      </section>

      <Positions />
    </div>
  );
}

function round(v: number) { return Math.round(v * 100) / 100; }

function PosRow({ p }: { p: any }) {
  const { toast } = useApp();
  const [edit, setEdit] = useState(false);
  const [sl, setSl] = useState<number>(p.sl);
  const [tp, setTp] = useState<number>(p.tp);
  useEffect(() => { setSl(p.sl); setTp(p.tp); }, [p.sl, p.tp]);
  const call = async (path: string, body: any, ok: string) => { try { await api(path, "POST", body); toast(ok, "ok"); } catch (e: any) { toast(e.message, "error"); } };
  return (
    <div className="pos">
      <div className="pos-main">
        <span className={`side-tag ${p.side > 0 ? "buy" : "sell"}`}>{p.side > 0 ? "Compra" : "Venta"}</span>
        <div className="pos-info">
          <div><b>{p.volume}</b> <span className="muted">@ {fmt(p.price_open)}</span></div>
          <div className="pos-sub">SL {p.sl ? fmt(p.sl) : "—"} · TP {p.tp ? fmt(p.tp) : "—"}{p.comment ? <span className="dim"> · {p.comment}</span> : null}</div>
        </div>
        <b className={`pos-pnl ${p.profit >= 0 ? "buy" : "sell"}`}>{p.profit >= 0 ? "+" : ""}{fmt(p.profit)}</b>
      </div>
      <div className="pos-act">
        <button className="btn xs" onClick={() => call("/api/position/breakeven", { ticket: p.ticket }, "SL a break-even")} title="Mover el SL a la entrada">BE</button>
        <button className="btn xs" onClick={() => call("/api/position/close", { ticket: p.ticket, volume: Math.max(0.01, Math.round(p.volume * 50) / 100) }, "Cerrada la mitad")} title="Cerrar la mitad">½</button>
        <button className={`btn xs ${edit ? "on" : ""}`} onClick={() => setEdit(!edit)} title="Editar SL y TP">SL/TP</button>
        <div className="spacer" />
        <button className="btn xs danger" onClick={() => call("/api/position/close", { ticket: p.ticket }, "Cerrada")} aria-label="Cerrar posición" title="Cerrar">✕</button>
      </div>
      {edit ? (
        <div className="pos-edit">
          <Field label="SL"><Num value={sl} onChange={setSl} /></Field>
          <Field label="TP"><Num value={tp} onChange={setTp} /></Field>
          <button className="btn sm primary" onClick={() => { call("/api/position/modify", { ticket: p.ticket, sl, tp }, "SL/TP actualizados"); setEdit(false); }}>Aplicar</button>
        </div>
      ) : null}
    </div>
  );
}

function Positions() {
  const { s, toast, ask } = useApp();
  const closeAll = async () => {
    if (!(await ask("¿Cerrar todas las posiciones de XAUUSD ahora?", "Cerrar todo", true))) return;
    try { await api("/api/close_all", "POST"); toast("Posiciones cerradas", "ok"); } catch (e: any) { toast(e.message, "error"); }
  };
  const virt = s.strategies.filter((x) => x.levels);
  return (
    <>
      <Card title={`Posiciones${s.positions.length ? ` (${s.positions.length})` : ""}`} tip="También puedes arrastrar las líneas de SL y TP en el gráfico."
        right={s.positions.length > 1 ? <button className="btn xs danger mobile-only" onClick={closeAll}>Cerrar todo</button> : null}>
        {s.positions.length === 0 ? <div className="empty-s">Sin posiciones abiertas.</div> : s.positions.map((p) => <PosRow key={p.ticket} p={p} />)}
      </Card>
      {s.orders.length ? (
        <Card title="Órdenes pendientes">
          {s.orders.map((o) => (
            <div key={o.ticket} className="line">
              <span>{o.kind.replace("_", " ")} <b>{o.volume}</b> @ {fmt(o.price)}</span>
              <span className="dim">SL {fmt(o.sl)} · TP {fmt(o.tp)}</span>
              <button className="btn xs danger" onClick={() => api("/api/order/cancel", "POST", { ticket: o.ticket }).then(() => toast("Orden cancelada", "ok")).catch((e) => toast(e.message, "error"))}>Cancelar</button>
            </div>
          ))}
        </Card>
      ) : null}
      {virt.length ? (
        <Card title="Órdenes del portafolio" tip="Órdenes virtuales: el EA solo envía la orden a MT5 cuando el precio llega al nivel.">
          {virt.map((x) => (
            <div key={x.name} className="line">
              <b>{x.name}</b>
              <span>{x.levels.buy ? <span className="buy">▲ {fmt(x.levels.buy)}</span> : null} {x.levels.sell ? <span className="sell">▼ {fmt(x.levels.sell)}</span> : null}</span>
            </div>
          ))}
        </Card>
      ) : null}
    </>
  );
}
