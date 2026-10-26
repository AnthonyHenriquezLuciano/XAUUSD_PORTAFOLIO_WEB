import React, { useEffect, useState } from "react";
import { api } from "../api";
import { fmt, pct, tstr, useApp } from "../store";
import { Card, Empty, Field, Num, PageHead, ProbBar, ScoreBadge, Seg, Stat } from "../ui";

export function Evaluation({ ev }: { ev: any }) {
  if (!ev) return null;
  if (!ev.ok) return <div className="hint">{ev.msg || "Sin evaluación"}</div>;
  return (
    <div className="eval">
      <div className="eval-h">
        <ScoreBadge score={ev.score} />
        <div>
          <div className="eval-v">{ev.verdict} · {ev.timing}</div>
          <div className="muted">{ev.session} · régimen {ev.regime} ({ev.aligned}) · vol. {ev.vol}</div>
        </div>
      </div>
      {ev.notes?.length ? <ul className="tips">{ev.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}</ul> : null}
      <div className="stats3">
        <Stat label="Resultado" value={ev.result_R != null ? `${ev.result_R >= 0 ? "+" : ""}${ev.result_R} R` : "abierta"} tone={ev.result_R == null ? "" : ev.result_R >= 0 ? "buy" : "sell"} />
        <Stat label="Máx. a favor" value={`${ev.mfe_R} R`} />
        <Stat label="Máx. en contra" value={`${ev.mae_R} R`} />
        <Stat label="Contra antes de avanzar" value={`${ev.mae_before_mfe_R} R`} />
        <Stat label="Mejor entrada" value={fmt(ev.best_price)} sub={`${ev.wait_min} min después`} />
        <Stat label="Riesgo" value={ev.risk_pct != null ? `${ev.risk_pct} %` : "–"} sub={`SL ${ev.sl_atr} ATR`} />
      </div>
      {ev.model ? (
        <div>
          <div className="field-l">Lo que daba el modelo al entrar · R esperado {ev.model.exp_R >= 0 ? "+" : ""}{ev.model.exp_R.toFixed(2)}</div>
          <ProbBar probs={ev.model.probs} />
          {ev.alternatives?.length ? (
            <table className="t" style={{ marginTop: 8 }}>
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
  const net = closed.reduce((a, r) => a + (r.pnl ?? 0), 0);

  const reeval = async (r: any) => {
    try {
      const ev = await api("/api/trades/evaluate", "POST", { ticket: r.ticket });
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, evaluation: ev } : x)));
    } catch (e: any) { toast(e.message, "error"); }
  };

  return (
    <div className="stack">
      <PageHead title="Diario">
        <Seg value={src} options={[["todas", "Todas"], ["manual", "Manuales"], ["estrategia", "Portafolio"]]} onChange={setSrc} />
        <button className={`btn sm ${ext ? "on" : ""}`} onClick={() => setExt(!ext)}>Evaluar otra operación</button>
      </PageHead>
      {ext ? <ExternalEval /> : null}
      <div className="kpi-row">
        <Stat label="Cerradas" value={closed.length} />
        <Stat label="Acierto" value={closed.length ? pct(closed.filter((r) => (r.pnl ?? 0) > 0).length / closed.length) : "–"} />
        <Stat label="R medio" value={closed.length ? avg(closed.map((r) => r.R ?? 0)).toFixed(2) : "–"} />
        <Stat label="Resultado" value={`${net >= 0 ? "+" : ""}${fmt(net)}`} tone={net >= 0 ? "buy" : "sell"} />
        <Stat label="Manuales" value={manual.length} />
        <Stat label="Nota media" value={scores.length ? avg(scores).toFixed(0) : "–"} tip="Nota media (0–100) de tus operaciones manuales." />
      </div>
      <section className="card flush">
        {rows.length === 0 ? <Empty>Aún no hay operaciones. Cada operación se registra y se evalúa al cerrarse.</Empty> : (
          <div className="jt">
            <div className="jt-h"><span>Fecha</span><span>Operación</span><span>Estrategia</span><span>Entrada → salida</span><span className="n">R</span><span className="n">Resultado</span><span className="n">Nota</span></div>
            {rows.map((r) => (
              <React.Fragment key={r.id}>
                <button className={`jt-r ${open === r.id ? "on" : ""}`} onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                  <span className="muted">{tstr(r.t_open)}</span>
                  <span><span className={`side-tag ${r.side > 0 ? "buy" : "sell"}`}>{r.side > 0 ? "Compra" : "Venta"}</span> {r.lots}</span>
                  <span>{r.strategy}</span>
                  <span>{fmt(r.entry)}{r.t_close ? <> → {fmt(r.exit)} <span className="dim">{r.reason}</span></> : <span className="dim"> · abierta</span>}</span>
                  <span className={`n ${(r.R ?? 0) >= 0 ? "buy" : "sell"}`}>{r.R != null ? `${r.R >= 0 ? "+" : ""}${Number(r.R).toFixed(2)}` : "–"}</span>
                  <span className={`n ${(r.pnl ?? 0) >= 0 ? "buy" : "sell"}`}>{r.pnl != null ? `${r.pnl >= 0 ? "+" : ""}${fmt(r.pnl)}` : "–"}</span>
                  <span className="n">{r.evaluation?.score != null ? r.evaluation.score : "–"}</span>
                </button>
                {open === r.id ? (
                  <div className="jt-d">
                    <div>
                      {r.evaluation ? <Evaluation ev={r.evaluation} /> : <div className="empty-s">Se evaluará al cerrarse.</div>}
                    </div>
                    <div className="stack">
                      {r.prediction?.model ? <Stat label="Al entrar, el modelo daba" value={`${pct(r.prediction.model.p_ganancia)} de ganancia`} sub={`R esperado ${r.prediction.model.exp_R?.toFixed(2)}`} /> : null}
                      {r.prediction?.scenario ? <Stat label={`Historial de ${r.strategy} en ese escenario`} value={`${r.prediction.scenario.expR?.toFixed(2)} R/op`} sub={`TP ${pct(r.prediction.scenario.p?.TP)} · SL ${pct(r.prediction.scenario.p?.SL)}`} /> : null}
                      <NoteBox r={r} />
                      <div><button className="btn sm" onClick={() => reeval(r)}>Evaluar ahora</button></div>
                    </div>
                  </div>
                ) : null}
              </React.Fragment>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function NoteBox({ r }: { r: any }) {
  const [v, setV] = useState(r.note || "");
  const { toast } = useApp();
  return (
    <div className="field">
      <span className="field-l">Nota</span>
      <div className="row">
        <input className="grow" placeholder="Por qué entraste, qué viste…" value={v} onChange={(e) => setV(e.target.value)} />
        <button className="btn sm" onClick={() => api("/api/trades/note", "POST", { id: r.id, note: v }).then(() => toast("Nota guardada", "ok"))}>Guardar</button>
      </div>
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
    <Card title="Evaluar una operación" tip="Para operaciones hechas fuera de la app o que solo pensaste. Horas del servidor del bróker.">
      <div className="grid4">
        <Field label="Lado"><select value={f.side} onChange={(e) => setF({ ...f, side: Number(e.target.value) })}><option value={1}>Compra</option><option value={-1}>Venta</option></select></Field>
        <Field label="Entrada"><Num value={f.entry} onChange={(v) => setF({ ...f, entry: v })} /></Field>
        <Field label="SL"><Num value={f.sl} onChange={(v) => setF({ ...f, sl: v })} /></Field>
        <Field label="TP"><Num value={f.tp} onChange={(v) => setF({ ...f, tp: v })} /></Field>
        <Field label="Apertura"><input value={f.t_open} onChange={(e) => setF({ ...f, t_open: e.target.value })} /></Field>
        <Field label="Cierre"><input value={f.t_close} onChange={(e) => setF({ ...f, t_close: e.target.value })} /></Field>
        <Field label="Precio de cierre"><Num value={f.exit} onChange={(v) => setF({ ...f, exit: v })} /></Field>
        <div className="field"><span className="field-l">&nbsp;</span><button className="btn primary" onClick={run}>Evaluar</button></div>
      </div>
      {ev ? <div style={{ marginTop: 12 }}><Evaluation ev={ev} /></div> : null}
    </Card>
  );
}
