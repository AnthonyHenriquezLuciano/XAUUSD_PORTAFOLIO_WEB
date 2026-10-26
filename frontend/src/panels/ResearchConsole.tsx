import React, { useEffect, useState } from "react";
import { api } from "../api";
import { fmt, useApp } from "../store";
import type { DataQuality, LevelKey, TargetStudy } from "../research/engine";
const TARGETS:LevelKey[]=["POC","VAH","VAL","VWAP"];
const toPct=(p:number|null)=>p==null?"—":(p*100).toFixed(1)+"%";
const formatTime=(ts:number|null)=>ts==null?"—":new Date(ts*1000).toISOString().slice(0,16)+" (reloj MT5)";
export default function ResearchConsole(){
  const {s}=useApp();
  const [target,setTarget]=useState<LevelKey>("POC");
  const [horizon,setHorizon]=useState(120);
  const [stop,setStop]=useState(1.5);
  const [quality,setQuality]=useState<DataQuality|null>(null);
  const [study,setStudy]=useState<TargetStudy|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [refresh,setRefresh]=useState(0);
  const cloud=s.broker==="cloud"&&s.status==="conectado";
  useEffect(()=>{
    if(!cloud){setQuality(null);setStudy(null);return;}
    let cancelled=false;
    setBusy(true);setError("");
    const args=new URLSearchParams({level:target,horizon:String(horizon),stop:String(stop)});
    Promise.all([api("/api/data_quality"),api("/api/target_study?"+args.toString())])
      .then(([q,a])=>{if(!cancelled){setQuality(q);setStudy(a);}})
      .catch(e=>{if(!cancelled){setError(e?.message || "No se pudo completar el estudio");setQuality(null);setStudy(null);}})
      .finally(()=>{if(!cancelled)setBusy(false);});
    return ()=>{cancelled=true;};
  },[cloud,s.accountInfo?.id,s.barsVersion,target,horizon,stop,refresh]);
  const q=quality,r=study;
  const dataOk=!!q&&q.bars>1400&&!q.invalidOhlc&&q.volumePct>=85;
  return <div className="premium-center science-page">
    <div className="premium-hero">
      <div><div className="premium-eyebrow">ANÁLISIS CUANTITATIVO / CALIDAD DE DATOS</div><h1>Investigación de mercado</h1>
        <p>Investigación reproducible de niveles de XAUUSD, sin convertir correlaciones en promesas de predicción.</p></div>
      <button className="btn sm" disabled={!cloud||busy} onClick={()=>setRefresh(v=>v+1)}>
        {busy?"Analizando…":"Recalcular evidencia"}
      </button>
    </div>
    {!cloud&&<div className="premium-warn">Conecta una cuenta MT5 con histórico M1 para ejecutar las evaluaciones. La demo no contiene ticks de volumen reales del bróker y no se fabrican resultados.</div>}
    {error&&<div className="premium-warn">{error}</div>}
    <div className="science-metrics">
      <div><span>Velas M1</span><b>{q?.bars.toLocaleString("es-DO")??"—"}</b></div>
      <div><span>Cobertura tick volume</span><b>{q?q.volumePct.toFixed(1)+"%":"—"}</b></div>
      <div><span>Huecos cortos</span><b>{q?.shortGaps??"—"}</b></div>
      <div><span>Calidad OHLC</span><b className={q?.invalidOhlc?"sell":"buy"}>{!q?"—":q.invalidOhlc===0?"Validada":"Alertas: "+q.invalidOhlc}</b></div>
    </div>
    <section className="science-section">
      <h2>Calidad del histórico</h2>
      <div className="science-data-grid">
        <div><span>Primera vela</span><b>{formatTime(q?.first??null)}</b></div>
        <div><span>Última vela</span><b>{formatTime(q?.last??null)}</b></div>
        <div><span>Duplicadas</span><b>{q?.duplicates??"—"}</b></div>
        <div><span>Minutos ausentes en huecos cortos</span><b>{q?.missingMinutes??"—"}</b></div>
        <div><span>Huecos largos (cierres incluidos)</span><b>{q?.largeGaps??"—"}</b></div>
        <div><span>Spread M1 medio, USD/oz</span><b>{q?.meanSpread??"—"}</b></div>
      </div>
      {q?.note&&<p className="premium-note">{q.note}</p>}
      {q&&!dataOk&&<div className="premium-warn">El histórico no alcanza la puerta mínima de calidad para comparar objetivos. No se emiten probabilidades utilizables.</div>}
    </section>
    <section className="science-section">
      <div className="science-section-title"><div><h2>Frecuencia histórica de llegada a niveles</h2>
        <p>Prueba cronológica de barreras con datos históricos. No ejecuta operaciones.</p></div></div>
      <div className="science-controls">
        <label>Nivel a evaluar
          <select value={target} onChange={e=>setTarget(e.target.value as LevelKey)}>
            {TARGETS.map(v=><option value={v} key={v}>{v}{v==="VWAP"?" (proxy)":""}</option>)}
          </select>
        </label>
        <label>Horizonte
          <select value={horizon} onChange={e=>setHorizon(Number(e.target.value))}>
            {[60,120,240,480].map(v=><option key={v} value={v}>{v/60} {v===60?"hora":"horas"}</option>)}
          </select>
        </label>
        <label>Stop / distancia al objetivo
          <select value={stop} onChange={e=>setStop(Number(e.target.value))}>
            {[1,1.5,2,3].map(v=><option key={v} value={v}>{v.toFixed(1)}×</option>)}
          </select>
        </label>
      </div>
      <div className="science-metrics">
        <div><span>Oportunidades evaluadas</span><b>{r?.events??"—"}</b></div>
        <div><span>Entrenamiento / reserva</span><b>{r? r.training+" / "+r.validation:"—"}</b></div>
        <div><span>Frecuencia histórica estimada</span><b className={r?.sufficient?"gold":""}>{r?.sufficient?toPct(r.forecast):"Abstención"}</b></div>
        <div><span>Tramo reservado (30%)</span><b>{r?toPct(r.holdoutRate):"—"}</b></div>
      </div>
      {r?.sufficient&&r.forecast!=null&&<div className="science-prob">
        <div className="science-prob-h"><span>Frecuencia de llegada estimada desde entrenamiento</span><strong>{toPct(r.forecast)}</strong></div>
        <div className="science-prob-track"><div style={{width:(100*r.forecast)+"%"}}/></div>
        <p>Validación cronológica: {toPct(r.holdoutRate)} · intervalo de Wilson 95% {r.confidence?toPct(r.confidence[0])+" – "+toPct(r.confidence[1]):"—"}.</p>
      </div>}
      {r&&!r.sufficient&&<div className="premium-warn">{r.narrative}</div>}
      {r&&<div className="science-data-grid">
        <div><span>Último nivel {target}</span><b>{r.latestLevel==null?"—":fmt(r.latestLevel)}</b></div>
        <div><span>Distancia respecto al cierre</span><b>{r.currentDistance==null?"—":fmt(r.currentDistance)+" USD"}</b></div>
        <div><span>Frecuencia en entrenamiento</span><b>{toPct(r.trainRate)}</b></div>
        <div><span>Tiempo mediano hasta objetivo</span><b>{r.medianHitMinutes==null?"—":r.medianHitMinutes+" min"}</b></div>
        <div><span>Brier del estimador</span><b>{r.brierModel??"—"}</b></div>
        <div><span>Brier referencia 50%</span><b>{r.brierHalf??"—"}</b></div>
        <div><span>Velas con empate SL/TP</span><b>{r.tieLosses}</b></div>
        <div><span>Ventanas incompletas excluidas</span><b>{r.skippedMissing}</b></div>
      </div>}
      {r&&<div className="science-explain"><strong>Interpretación</strong><p>{r.narrative}</p>
        <p>{r.brierModel!=null&&r.brierHalf!=null&&r.brierModel<r.brierHalf?
          "El Brier supera al baseline fijo de 50% en esta muestra; esto NO prueba ventaja frente a un baseline real entrenado ni rentabilidad después de costes.":
          "No se ha demostrado superioridad estadística frente a una referencia simple en este análisis."}</p>
      </div>}
    </section>
    <section className="science-section">
      <h2>Metodología y limitaciones</h2>
      <p className="premium-note">Las muestras son exploratorias y los eventos se espacian para evitar horizontes superpuestos. La evaluación actual divide entrenamiento y reserva de forma cronológica, pero no sustituye Walk-Forward múltiple, validación por bróker ni una muestra futura independiente. Los resultados están condicionados al histórico de la cuenta conectada y al supuesto de ejecuciones al cierre M1.</p>
      {r?.methods&&<div className="science-methods">{r.methods.map((m,i)=><p key={i}>• {m}</p>)}</div>}
    </section>
  </div>;
}
