import React from "react";
import { fmt, useApp } from "../store";
import { useUI } from "../uiState";
import type { FlowPrefs } from "../uiState";
const SCOPES: [FlowPrefs["scope"], string][] = [
  ["tokyo", "Tokio"], ["london", "Londres"], ["newyork", "Nueva York"], ["day", "Día EA"]
];
const MODES: [FlowPrefs["mode"], string][] = [
  ["session", "Sesión"], ["recent", "6 horas"], ["fixed", "Dibujado"]
];
const VIEWS: [FlowPrefs["focus"], string][] = [
  ["all","Completo"], ["volume","Volumen"], ["inefficiency","FVG"], ["structure","Niveles"]
];

export default function FlowStudio() {
  const { s } = useApp();
  const ui = useUI();
  const d = s.flow;
  const p = d?.profile;
  const pressure = d?.pressure;
  const reachable = new Map((d?.reach||[]).map(x=>[x.key,x]));
  const f = ui.flow;
  const showVolume = f.focus === "all" || f.focus === "volume";
  const showGaps = f.focus === "all" || f.focus === "inefficiency";
  const showLevels = f.focus === "all" || f.focus === "structure";
  const canWork = s.broker === "cloud" && s.status === "conectado";
  const top = (d?.levels || []).filter(x=>["POC","VAH","VAL","VWAP","PDH","PDL","PWH","PWL"].includes(x.key));
  const gaps = (d?.gaps || []).slice().reverse().slice(0,9);
  const distance = (price: number) => d?.price == null ? "—" : (price - d.price >= 0 ? "+" : "") + fmt(price - d.price) + " $";
  const percent = (n:number|null|undefined,digits=1)=>n==null?"—":n.toFixed(digits)+"%";
  const stateName=pressure?.state==="buyer_proxy"?"Presión alcista estimada":
    pressure?.state==="seller_proxy"?"Presión bajista estimada":
    pressure?.state==="mixed"?"Flujo mixto / señales contradictorias":"Datos insuficientes";
  const pocShare=p?.bins.find(b=>p.poc>=b.low&&p.poc<=b.high)?.share||0;
  const valueShare=p?p.bins.filter(b=>b.price>=p.val-.02&&b.price<=p.vah+.02)
    .reduce((a,b)=>a+b.share,0)*100:null;
  const posInVa=d?.price!=null&&p?(d.price>p.vah?"Precio por encima del VAH":
    d.price<p.val?"Precio por debajo del VAL":"Precio dentro del área de valor"):"Sin contexto disponible";
  return <div className="flow-studio stack">
    <header className="flow-title">
      <div><span className="premium-eyebrow">DATOS DE MERCADO / MICROESTRUCTURA</span><h2>Order Flow</h2></div>
      <span className="flow-proxy-badge">TICK VOLUME</span>
    </header>
    <div className="flow-segment" role="group" aria-label="Modos de análisis">
      {MODES.map(([key,name])=><button key={key} className={f.mode===key?"on":""}
        onClick={()=>ui.setFlow({mode:key})} aria-pressed={f.mode===key} title={key==="fixed"?"Se dibuja con la herramienta VP de Dibujo":""}>{name}</button>)}
    </div>
    {f.mode === "session" && <div className="flow-segment compact" role="group" aria-label="Sesión">
      {SCOPES.map(([key,name])=><button key={key} className={f.scope===key?"on":""} onClick={()=>ui.setFlow({scope:key})} aria-pressed={f.scope===key}>{name}</button>)}
    </div>}
    <div className="flow-section">
      <span className="flow-section-caption">ENFOQUE · FILTRAR LO VISIBLE</span>
      <div className="flow-segment compact" role="group" aria-label="Modo Focus">
        {VIEWS.map(([key,name])=><button key={key} className={f.focus===key?"on":""} onClick={()=>ui.setFlow({focus:key})} aria-pressed={f.focus===key}>{name}</button>)}
      </div>
    </div>
    <div className="flow-toggles">
      <label><input type="checkbox" checked={ui.layers.volumen !== false} onChange={e=>ui.setLayer("volumen",e.target.checked)} />Histograma de ticks</label>
      <label><input type="checkbox" checked={ui.layers.flujo !== false} onChange={e=>ui.setLayer("flujo",e.target.checked)} />Perfil en gráfico</label>
      <label><input type="checkbox" checked={ui.layers.fvg !== false} onChange={e=>ui.setLayer("fvg",e.target.checked)} />FVG M5</label>
    </div>
    <div className="flow-section">
      <div className="flow-line"><b>Resolución del perfil</b><select aria-label="Número de niveles de volumen" value={f.bins} onChange={e=>ui.setFlow({bins:Number(e.target.value)})}>
        {[32,48,64,96,128].map(n=><option value={n} key={n}>{n} niveles</option>)}
      </select></div>
      <div className="flow-line"><span>Fuente</span><b>MT5 · M1 tick volume</b></div>
      <div className="flow-line"><span>Datos</span><b>{p ? p.bars+" velas ("+Math.round(p.coverage*100)+"%)" : "No disponible"}</b></div>
      <div className="flow-line"><span>Cálculo</span><b>OHLC uniforme (estimado)</b></div>
    </div>
    {d && pressure && <section className="flow-section flow-pressure-card">
      <span className="flow-section-caption">DOMINANCIA RELATIVA · ACTIVIDAD DE TICKS</span>
      <div className="flow-pressure-top">
        <div><strong className={pressure.state==="buyer_proxy"?"buy":pressure.state==="seller_proxy"?"sell":"gold"}>{stateName}</strong>
          <small>{pressure.score==null?"Sin puntuación":("Concordancia "+pressure.agreement+"/4 · Score "+(pressure.score>0?"+":"")+pressure.score+" / 100")}</small>
        </div>
        <span className="flow-rvol" title="Actividad de los últimos 15 minutos frente a la mediana de hasta 12 ventanas previas">
          {pressure.relativeVolume!=null?pressure.relativeVolume.toFixed(2)+"×":"—"} RVOL
        </span>
      </div>
      {pressure.buyingProxyPct!=null&&pressure.sellingProxyPct!=null&&<div className="flow-pressure-balance">
        <div className="flow-pressure-ends">
          <span className="buy">Alcista* {percent(pressure.buyingProxyPct)}</span>
          <span className="sell">Bajista* {percent(pressure.sellingProxyPct)}</span>
        </div>
        <div className="flow-pressure-meter" role="img" aria-label={"Presión estimada: "+pressure.buyingProxyPct+"% alcista y "+pressure.sellingProxyPct+"% bajista"}>
          <div style={{width:pressure.buyingProxyPct+"%"}}/>
        </div>
      </div>}
      <div className="flow-indicator-grid">
        <div><span>CMF (20) · M1</span><b className={pressure.cmf20!=null&&pressure.cmf20>0?"buy":"sell"}>{pressure.cmf20??"—"}</b><small>Flujo por posición del cierre</small></div>
        <div><span>MFI (14) · M1</span><b>{pressure.mfi14??"—"}</b><small>Índice de flujo monetario proxy</small></div>
        <div><span>OBV (30) · M1</span><b className={pressure.obvRecent!=null&&pressure.obvRecent>0?"buy":"sell"}>{pressure.obvRecent??"—"}</b><small>Saldo normalizado de ticks</small></div>
        <div><span>Actividad 15 min</span><b>{Math.round(pressure.recentTicks).toLocaleString("es-ES")}</b><small>{pressure.activity==="expansion"?"Expansión":pressure.activity==="contraction"?"Contracción":pressure.activity==="normal"?"Normal":"Sin comparación"}</small></div>
      </div>
      <p className="premium-note">*Son aproximaciones basadas en la ubicación del cierre de cada vela M1, NO compras ni ventas ejecutadas. No se dispone de delta agresor real, CVD de transacciones ni libro de órdenes.</p>
      {pressure.absorptionHint&&<p className="flow-info">Volumen expandido y desplazamiento limitado: posible actividad bidireccional. No demuestra absorción institucional.</p>}
    </section>}
    {!canWork && <div className="premium-warn">El análisis de flujo necesita una cuenta MT5 conectada con velas M1. No se generan valores ficticios.</div>}
    {f.mode==="fixed" && <div className="flow-info">
      <b>Perfil de rango fijo</b><p>Abre <strong>Dibujo → VP</strong>, marca el primer y último punto de tiempo sobre el gráfico y se calculará tu selección. Puedes mover los puntos o volver a elegir una zona.</p>
      {f.start && f.end ? <small>Intervalo: {new Date(f.start*1000).toISOString().slice(0,16)} — {new Date(f.end*1000).toISOString().slice(0,16)} · reloj servidor MT5</small> : <small>Aún no has seleccionado ningún rango.</small>}
    </div>}
    {!d?.ok && <div className="flow-info">{d?.evidence?.[0] || (canWork ? "Calculando perfil de sesión…" : "Sin datos de flujo.")}</div>}
    {d && p && showVolume && <section className="flow-section">
      <span className="flow-section-caption">PERFIL DE ACTIVIDAD · ÁREA DE VALOR 70%</span>
      <div className="flow-price-head"><span>POC</span><strong>{fmt(p.poc)}</strong><small>{distance(p.poc)}</small></div>
      <div className="flow-price-grid">
        <div><span>VAH</span><b>{fmt(p.vah)}</b></div>
        <div><span>VAL</span><b>{fmt(p.val)}</b></div>
        <div><span>VWAP*</span><b>{p.vwap!=null?fmt(p.vwap):"—"}</b></div>
      </div>
      <div className="flow-nodes">
        <div><span>VWAP ±1σ / ±2σ (proxy de dispersión M1)</span><b>{p.vwapBands?.length===4?p.vwapBands.map(x=>fmt(x)).join(" / "):"No disponible"}</b></div>
      </div>
      <div className="flow-profile-context">
        <div><span>Actividad en POC</span><b>{percent(pocShare*100)}</b></div>
        <div><span>Participación en área de valor</span><b>{percent(valueShare)}</b></div>
      </div>
      <p className="flow-position-label">{posInVa} · Este dato describe aceptación de actividad, no una predicción.</p>
      <div className="flow-line"><span>Precio vs POC</span><b className={d.direction==="above_poc"?"buy":d.direction==="below_poc"?"sell":"gold"}>{d.direction==="above_poc"?"Sobre POC":d.direction==="below_poc"?"Bajo POC":"En POC / sin datos"}</b></div>
      <div className="flow-nodes">
        <div><span>HVN · Aceptación relativa</span><b>{p.hvn.length?p.hvn.map(v=>fmt(v)).join(" · "):"No detectados"}</b></div>
        <div><span>LVN · Baja actividad relativa</span><b>{p.lvn.length?p.lvn.map(v=>fmt(v)).join(" · "):"No detectados"}</b></div>
      </div>
      <p className="premium-note">*VWAP proxy usa precio típico ponderado por ticks M1. POC y nodos son aproximaciones, no volumen negociado a cada precio.</p>
    </section>}
    {d && showLevels && <section className="flow-section">
      <span className="flow-section-caption">NIVELES RELEVANTES</span>
      <p className="premium-note">Frecuencia histórica de toque en 2 h, con perfil reconstruido en cada fecha. No es probabilidad futura calibrada; el tamaño de muestra importa.</p>
      {top.sort((a,b)=>Math.abs(a.price-(d.price || 0))-Math.abs(b.price-(d.price || 0))).map(x=>{
        const reach=reachable.get(x.key);
        return <div className="flow-level flow-level-prob" key={x.key}>
          <span className="flow-level-code">{x.key}</span>
          <div><b>{fmt(x.price)}</b><small>{x.label} · {distance(x.price)}</small>
            <small>{reach?.percent!=null?"Reserva "+reach.holdoutN+" eventos · IC 95% "+percent(reach.lower)+"–"+percent(reach.upper):
              reach?.reason||"Sin estudio comparable"}</small></div>
          <span className="flow-reach" title={reach?.reason||"No disponible"}>
            {reach?.percent!=null?percent(reach.percent,0):"N/D"}<small>2 h hist.</small>
          </span>
        </div>;
      })}
      {!top.length && <p className="premium-note">Sin niveles confiables para esta muestra.</p>}
    </section>}
    {d && showLevels && <section className="flow-section">
      <span className="flow-section-caption">BARRIDOS Y RECHAZOS DE PRECIO</span>
      {(d.sweeps||[]).slice(-5).reverse().map((x,i)=><div key={x.time+"-"+i} className="flow-gap">
        <span className={x.side==="high"?"sell":"buy"}>{x.side==="high"?"Barrido máximo":"Barrido mínimo"}</span>
        <b>{fmt(x.level)}</b><small>{fmt(x.rejection)} USD</small></div>)}
      {!d.sweeps?.length&&<p className="premium-note">Sin barridos confirmados por velas M5 cerradas.</p>}
      <p className="premium-note">Una mecha con recuperación del nivel es una estructura de precio, no evidencia de órdenes institucionales.</p>
    </section>}
    {d && showGaps && <section className="flow-section">
      <span className="flow-section-caption">INEFICIENCIAS · FVG EN M5</span>
      {gaps.map(x=><div className="flow-gap" key={x.id}>
        <span className={x.side===1?"buy":"sell"}>{x.side===1?"▲ Alcista":"▼ Bajista"}</span>
        <b>{fmt(x.lo)} – {fmt(x.hi)}</b><small>{x.state==="partial"?"Parcial":"Sin mitigar"}</small>
      </div>)}
      {!gaps.length && <p className="premium-note">No hay FVG M5 vigentes que superen el filtro de desplazamiento.</p>}
    </section>}
    {d && <div className="flow-info">
      <b>Lectura explicable</b>
      {d.evidence.map((x,i)=><p key={i}>• {x}</p>)}
      <p>Las frecuencias históricas son descriptivas y condicionadas a distancias comparables. Si no hay suficientes eventos independientes se muestra N/D. La probabilidad prospectiva calibrada sigue pendiente.</p>
    </div>}
    <p className="premium-note">Análisis visual únicamente. Sin órdenes ni cambios automáticos en las estrategias. Los perfiles no representan volumen real centralizado de futuros COMEX.</p>
  </div>;
}
