import React, { useEffect, useState } from "react";
import { api } from "../api";
import { fmt, pct, tstr, useApp } from "../store";
import { Card, Field, Num, ProbBar, ScoreBadge, Seg } from "../ui";

export function Evaluation({ ev }: { ev: any }) {
  if (!ev) return null;
  if (!ev.ok) return <div className="hint">{ev.msg || "Sin evaluación"}</div>;
  return (
    <div className="col">
      <div className="row">
        <ScoreBadge score={ev.score} />
        <div>
          <div style={{ fontWeight: 600 }}>{ev.verdict} · {ev.timing}</div>
          <div className="small muted">{ev.session} · régimen {ev.regime} ({ev.aligned}) · vol. {ev.vol}</div>
        </div>
      </div>
      {ev.notes?.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{ev.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul> : null}
      <div className="grid3 small mono">
        <div><div className="muted">Resultado</div>{ev.result_R != null ? `${ev.result_R >= 0 ? "+" : ""}${ev.result_R} R` : "abierta"}</div>
        <div><div className="muted">Máx. a favor</div>{ev.mfe_R} R</div>
        <div><div className="muted">Máx. en contra</div>{ev.mae_R} R</div>
        <div><div className="muted">En contra antes de avanzar</div>{ev.mae_before_mfe_R} R</div>
        <div><div className="muted">Mejor entrada posible</div>{fmt(ev.best_price)} ({ev.wait_min} min)</div>
        <div><div className="muted">Riesgo</div>{ev.risk_pct != null ? `${ev.risk_pct} %` : "–"} · SL {ev.sl_atr} ATR</div>
      </div>
      {ev.model ? (
        <div>
          <div className="small" style={{ marginBottom: 4 }}>Lo que daba el modelo al entrar (R esperado {ev.model.exp_R >= 0 ? "+" : ""}{ev.model.exp_R.toFixed(2)})</div>
          <ProbBar probs={ev.model.probs} />
          {ev.alternatives?.length ? (
            <table className="t" style={{ marginTop: 6 }}>
              <thead><tr><th>Si esperabas</th><th className="n">Precio</th><th className="n">Ganancia</th><th className="n">R esp.</th></tr></thead>
              <tbody>
                <tr><td>Entrar cuando entraste</td><td className="n">–</td><td className="n">{pct(ev.model.p_ganancia)}</td><td className="n">{ev.model.exp_R.toFixed(2)}</td></tr>
                {ev.alternatives.map((a: any) => <tr key={a.wait_min}><td>{a.wait_min} min</td><td className="n">{fmt(a.price)}</td><td className="n">{pct(a.p_ganancia)}</td><td className={`n ${a.exp_R > ev.model.exp_R ? "buy" : ""}`}>{a.exp_R.toFixed(2)}</td></tr>)}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function Journal() {
  const { s, toast } = useApp();
  const [src, setSrc] = useState<"todas" | "manual" | "estrategia">("todas");
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [ext, setExt] = useState(false);
  const load = () => api(`/api/trades${src === "todas" ? "" : `?source=${src}`}`).then((d) => setRows(d.trades)).catch(() => {});
  useEffect(() => { load(); }, [src, s.tradeClosed, s.positions.length, s.account?.login]);

  const closed = rows.filter((r) => r.status === "cerrada");
  const manual = closed.filter((r) => r.source === "manual");
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const scores = manual.map((r) => r.evaluation?.score).filter((x) => typeof x === "number");

  const reeval = async (r: any) => {
    try {
      const ev = await api("/api/trades/evaluate", "POST", { ticket: r.ticket });
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, evaluation: ev } : x)));
    } catch (e: any) { toast(e.message, "error"); }
  };

  return (
    <div className="col">
      <div className="row between">
        <Seg value={src} options={[["todas", "Todas"], ["manual", "Manuales"], ["estrategia", "Portafolio"]]} onChange={setSrc} />
        <button className="btn sm" onClick={() => setExt(!ext)}>{ext ? "Cerrar" : "Evaluar otra operación"}</button>
      </div>
      {ext ? <ExternalEval /> : null}
      <div className="grid3 small mono card">
        <div><div className="muted">Cerradas</div>{closed.length}</div>
        <div><div className="muted">Acierto</div>{closed.length ? pct(closed.filter((r) => (r.pnl ?? 0) > 0).length / closed.length) : "–"}</div>
        <div><div className="muted">R medio</div>{closed.length ? avg(closed.map((r) => r.R ?? 0)).toFixed(2) : "–"}</div>
        <div><div className="muted">Resultado</div>{fmt(closed.reduce((a, r) => a + (r.pnl ?? 0), 0))}</div>
        <div><div className="muted">Manuales</div>{manual.length}</div>
        <div><div className="muted">Nota media manual</div>{scores.length ? avg(scores).toFixed(0) : "–"}</div>
      </div>
      {rows.length === 0 ? <div className="hint">Aún no hay operaciones. Cada operación (manual o del portafolio) se registra y se evalúa al cerrarse.</div> : null}
      {rows.map((r) => (
        <div key={r.id} className="card" style={{ marginTop: 0 }}>
          <div className="row between" style={{ cursor: "pointer" }} onClick={() => setOpen(open === r.id ? null : r.id)}>
            <div>
              <div><b className={r.side > 0 ? "buy" : "sell"}>{r.side > 0 ? "Compra" : "Venta"}</b> {r.lots} · <span className="chip">{r.strategy}</span> <span className="small muted">#{r.ticket}</span></div>
              <div className="small muted mono">{tstr(r.t_open)} @ {fmt(r.entry)}{r.t_close ? ` → ${fmt(r.exit)} (${r.reason})` : " · abierta"}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              {r.pnl != null ? <div className={`mono ${r.pnl >= 0 ? "buy" : "sell"}`}>{r.pnl >= 0 ? "+" : ""}{fmt(r.pnl)}</div> : null}
              <div className="small muted">{r.R != null ? `${r.R >= 0 ? "+" : ""}${Number(r.R).toFixed(2)} R` : ""}{r.evaluation?.score != null ? ` · ${r.evaluation.score}/100` : ""}</div>
            </div>
          </div>
          {open === r.id ? (
            <div style={{ marginTop: 10 }} className="col">
              {r.prediction?.model ? <div className="small muted">Al entrar, el modelo daba {pct(r.prediction.model.p_ganancia)} de terminar en ganancia (R esperado {r.prediction.model.exp_R?.toFixed(2)}).</div> : null}
              {r.prediction?.scenario ? <div className="small muted">Historial de {r.strategy} en ese escenario: {r.prediction.scenario.expR?.toFixed(2)} R/op, TP {pct(r.prediction.scenario.p?.TP)}, SL {pct(r.prediction.scenario.p?.SL)}.</div> : null}
              {r.evaluation ? <Evaluation ev={r.evaluation} /> : <div className="hint">Se evaluará al cerrarse.</div>}
              <div className="row"><button className="btn sm" onClick={() => reeval(r)}>Evaluar ahora</button></div>
              <NoteBox r={r} />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function NoteBox({ r }: { r: any }) {
  const [v, setV] = useState(r.note || "");
  const { toast } = useApp();
  return (
    <div className="row">
      <input className="grow" placeholder="Nota (por qué entraste, qué viste…)" value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn sm" onClick={() => api("/api/trades/note", "POST", { id: r.id, note: v }).then(() => toast("Nota guardada", "ok"))}>Guardar</button>
    </div>
  );
}

function ExternalEval() {
  const { s, toast } = useApp();
  const now = s.tick?.time ?? Math.floor(Date.now() / 1000);
  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ");
  const [f, setF] = useState({ side: 1, entry: s.tick?.bid ?? 0, sl: 0, tp: 0, t_open: iso(now - 7200), t_close: iso(now - 3600), exit: 0 });
  const [ev, setEv] = useState<any>(null);
  const run = async () => {
    try { setEv(await api("/api/trades/evaluate", "POST", { ...f, exit: f.exit || undefined })); } catch (e: any) { toast(e.message, "error"); }
  };
  return (
    <Card title="Evaluar una operación (hecha fuera de la app o pensada)">
      <div className="grid3">
        <Field label="Lado"><select value={f.side} onChange={(e) => setF({ ...f, side: Number(e.target.value) })}><option value={1}>Compra</option><option value={-1}>Venta</option></select></Field>
        <Field label="Entrada"><Num value={f.entry} onChange={(v) => setF({ ...f, entry: v })} /></Field>
        <Field label="SL"><Num value={f.sl} onChange={(v) => setF({ ...f, sl: v })} /></Field>
        <Field label="TP"><Num value={f.tp} onChange={(v) => setF({ ...f, tp: v })} /></Field>
        <Field label="Apertura (hora servidor)"><input value={f.t_open} onChange={(e) => setF({ ...f, t_open: e.target.value })} /></Field>
        <Field label="Cierre"><input value={f.t_close} onChange={(e) => setF({ ...f, t_close: e.target.value })} /></Field>
        <Field label="Precio de cierre (opcional)"><Num value={f.exit} onChange={(v) => setF({ ...f, exit: v })} /></Field>
      </div>
      <button className="btn primary" style={{ marginTop: 8 }} onClick={run}>Evaluar</button>
      {ev ? <div style={{ marginTop: 10 }}><Evaluation ev={ev} /></div> : null}
    </Card>
  );
}
