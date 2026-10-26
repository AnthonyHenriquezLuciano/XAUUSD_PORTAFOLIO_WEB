import React, { useState } from "react";
import { api } from "../api";
import { fmt, tstr, useApp } from "../store";
import { Card, Num } from "../ui";

function PosRow({ p }: { p: any }) {
  const { toast } = useApp();
  const [sl, setSl] = useState<number>(p.sl);
  const [tp, setTp] = useState<number>(p.tp);
  const call = async (path: string, body: any, ok: string) => { try { await api(path, "POST", body); toast(ok, "ok"); } catch (e: any) { toast(e.message, "error"); } };
  return (
    <div className="card" style={{ marginTop: 0 }}>
      <div className="row between">
        <div><b className={p.side > 0 ? "buy" : "sell"}>{p.side > 0 ? "Compra" : "Venta"}</b> {p.volume} lotes <span className="small muted">#{p.ticket} · {p.comment}</span></div>
        <b className={`mono ${p.profit >= 0 ? "buy" : "sell"}`}>{p.profit >= 0 ? "+" : ""}{fmt(p.profit)}</b>
      </div>
      <div className="small muted mono">Entrada {fmt(p.price_open)} · {tstr(p.time)}</div>
      <div className="grid2" style={{ marginTop: 6 }}>
        <div className="row"><span className="small sell">SL</span><Num value={sl} onChange={setSl} /></div>
        <div className="row"><span className="small buy">TP</span><Num value={tp} onChange={setTp} /></div>
      </div>
      <div className="row wrap" style={{ marginTop: 6 }}>
        <button className="btn sm" onClick={() => call("/api/position/modify", { ticket: p.ticket, sl, tp }, "SL/TP actualizados")}>Aplicar SL/TP</button>
        <button className="btn sm" onClick={() => call("/api/position/breakeven", { ticket: p.ticket }, "SL a break-even")}>Break-even</button>
        <button className="btn sm" onClick={() => call("/api/position/close", { ticket: p.ticket, volume: Math.max(0.01, Math.round(p.volume * 50) / 100) }, "Cerrada la mitad")}>Cerrar ½</button>
        <button className="btn sm danger" onClick={() => call("/api/position/close", { ticket: p.ticket }, "Cerrada")}>Cerrar</button>
      </div>
    </div>
  );
}

export default function Positions() {
  const { s, toast } = useApp();
  return (
    <div className="col">
      <div className="hint">También puedes arrastrar las líneas de SL y TP directamente en el gráfico.</div>
      {s.positions.length === 0 ? <div className="muted">Sin posiciones abiertas.</div> : s.positions.map((p) => <PosRow key={`${p.ticket}-${p.sl}-${p.tp}`} p={p} />)}
      <Card title="Órdenes pendientes">
        {s.orders.length === 0 ? <div className="muted small">Ninguna.</div> : s.orders.map((o) => (
          <div key={o.ticket} className="row between small" style={{ padding: "4px 0" }}>
            <span>{o.kind.replace("_", " ")} {o.volume} @ <span className="mono">{fmt(o.price)}</span> SL {fmt(o.sl)} TP {fmt(o.tp)}</span>
            <button className="btn sm danger" onClick={() => api("/api/order/cancel", "POST", { ticket: o.ticket }).then(() => toast("Cancelada", "ok")).catch((e) => toast(e.message, "error"))}>Cancelar</button>
          </div>
        ))}
      </Card>
      <Card title="Órdenes virtuales del portafolio">
        {s.strategies.filter((x) => x.levels).length === 0 ? <div className="muted small">Ninguna activa ahora.</div> : s.strategies.filter((x) => x.levels).map((x) => (
          <div key={x.name} className="small"><b>{x.name}</b>: {x.levels.buy ? `compra ≥ ${fmt(x.levels.buy)}` : ""} {x.levels.sell ? `· venta ≤ ${fmt(x.levels.sell)}` : ""}</div>
        ))}
        <div className="hint">El portafolio usa órdenes virtuales (como el EA): solo se envía la orden a MT5 cuando el precio llega al nivel.</div>
      </Card>
    </div>
  );
}
