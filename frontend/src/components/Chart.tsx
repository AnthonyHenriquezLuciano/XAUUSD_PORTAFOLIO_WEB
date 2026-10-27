import React, { useEffect, useRef, useState } from "react";
import { createChart, CrosshairMode, IChartApi, IPriceLine, ISeriesApi, LineStyle, UTCTimestamp } from "lightweight-charts";
import { ChartOverlay } from "../chart/overlay";
import { captureViewport, restoreViewport } from "../chart/viewport";
import { historyChange, mergeCurrentTick, type ChartBar } from "../chart/historySync";
import {cacheGet,cachePut,cacheKey,mergePages,HISTORICAL_PAGE_SIZE,INITIAL_SIZE} from "../chart/historyCache";
import {readWorkspaces,writeWorkspace,removeWorkspace,readViewport,writeViewport,type VisualWorkspace} from "../chart/workspaces";
import { chartSessionWindows } from "../sessions/marketSessions";
import DrawingTools from "./DrawingTools";
import { Icon, Logo } from "../icons";
import { alpha, themeById } from "../chart/themes";
import { api } from "../api";
import { fmt, useApp } from "../store";
import { useUI } from "../uiState";

const TF_SEC: Record<string, number> = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };

type LineDef = {
  id: string; price: number; color: string; title: string; style?: LineStyle; width?: number;
  drag?: { kind: "pos-sl" | "pos-tp" | "ord-price" | "ord-sl" | "ord-tp" | "pv-entry" | "pv-sl" | "pv-tp"; ticket?: number };
};

export default function Chart() {
  const { s, toast, dispatch } = useApp();
  const ui = useUI();
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const fcRef = useRef<ISeriesApi<"Line">[]>([]);
  const overlayRef = useRef<ChartOverlay | null>(null);
  const timesRef = useRef<number[]>([]);
  const barsRef = useRef<ChartBar[]>([]);
  const [ready, setReady] = useState(false);
  const [barLoad, setBarLoad] = useState<{ phase: "loading" | "ready" | "empty" | "error"; count: number; message?: string }>({ phase: "loading", count: 0 });
  const [reload, setReload] = useState(0);
  // Exploratory mode never jumps back to the last candle until the user requests it.
  const followingRef = useRef(false);
  const [following, setFollowing] = useState(false);
  const [drawOpen, setDrawOpen] = useState<boolean>(() => { try { return localStorage.getItem("xauai.drawopen") === "1"; } catch { return false; } });
  const linesRef = useRef<Map<string, { line: IPriceLine; def: LineDef }>>(new Map());
  const lastRef = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null);
  const dragRef = useRef<{ id: string; def: LineDef } | null>(null);
  const [tf, setTf] = useState<string>(() => { try { return localStorage.getItem("xauai.tf") || "M5"; } catch { return "M5"; } });
  const [dragTip, setDragTip] = useState<{ y: number; text: string } | null>(null);
  const [overlays, setOverlays] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [hover, setHover] = useState<{ o: number; h: number; l: number; c: number; t: number } | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const th = themeById(ui.chart.theme);
  const connected = s.status === "conectado";
  const extraRef = useRef<number[]>([]);
  const loadedKeyRef = useRef("");
  const viewKeyRef=useRef("");
  const olderBusyRef=useRef(false);
  const olderExhaustedRef=useRef(false);
  const [olderBusy,setOlderBusy]=useState(false);
  const [olderEnd,setOlderEnd]=useState(false);
  const [savedWorkspaces,setSavedWorkspaces]=useState<VisualWorkspace[]>(readWorkspaces);
  const [workspaceOpen,setWorkspaceOpen]=useState(false);
  const [historySource,setHistorySource]=useState<"cache"|"live"|"paged">("live");
  const stateRef = useRef({ s, ui });
  stateRef.current = { s, ui };

  // ------------------------------------------------------------------ creación
  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      layout: { background: { color: "#0d1016" }, textColor: "#8a93a6", fontFamily: "Inter, system-ui, sans-serif" },
      grid: { vertLines: { color: "#161c27" }, horzLines: { color: "#161c27" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#262e3f", scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: "#262e3f", timeVisible: true, secondsVisible: false, rightOffset: 12,
        lockVisibleTimeRangeOnResize: true, shiftVisibleRangeOnNewBar: false, fixLeftEdge:false },
      kineticScroll: {mouse:true,touch:true},
      // Size is controlled explicitly by ResizeObserver so a previously collapsed
      // grid track cannot leave the chart with a permanent 0px canvas.
      autoSize: false,
      localization: { locale: "es-ES", priceFormatter: (p: number) => p.toFixed(2) },
    });
    const candle = chart.addCandlestickSeries({
      upColor: "#22b07d", downColor: "#e5534b", borderUpColor: "#22b07d", borderDownColor: "#e5534b",
      wickUpColor: "#22b07d", wickDownColor: "#e5534b", priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      // la escala incluye SL/TP de la orden en preparación y de las posiciones
      autoscaleInfoProvider: (orig: () => any) => {
        const r = orig();
        const ex = extraRef.current;
        if (!r || !ex.length) return r;
        return { ...r, priceRange: { minValue: Math.min(r.priceRange.minValue, ...ex), maxValue: Math.max(r.priceRange.maxValue, ...ex) } };
      },
    });
    chartRef.current = chart;
    candleRef.current = candle;
    const volume = chart.addHistogramSeries({
      priceScaleId:"tick-activity",priceLineVisible:false,lastValueVisible:false,
      priceFormat:{type:"volume"},color:"#6f9a87",
    });
    chart.priceScale("tick-activity").applyOptions({scaleMargins:{top:.79,bottom:0},visible:false});
    volumeRef.current = volume;
    const ov = new ChartOverlay();
    candle.attachPrimitive(ov);
    overlayRef.current = ov;
    // One React hover render at most per animation frame. The chart crosshair
    // itself stays native and responsive at the pointer's full refresh rate.
    let hoverFrame=0;
    let lastHoverTime:number|null=null;
    chart.subscribeCrosshairMove((p: any) => {
      const d = p?.seriesData?.get(candle);
      const t=d?.open!=null?Number(p.time):null;
      if(lastHoverTime===t)return;
      lastHoverTime=t;
      if(hoverFrame)cancelAnimationFrame(hoverFrame);
      hoverFrame=requestAnimationFrame(()=>{
        hoverFrame=0;
        setHover(t==null?null:{o:d.open,h:d.high,l:d.low,c:d.close,t});
      });
    });
    const mk = (color: string, style: LineStyle, width: 1 | 2) => chart.addLineSeries({ color, lineStyle: style, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    fcRef.current = [mk("rgba(224,176,79,.7)", LineStyle.Solid, 1), mk("rgba(243,205,122,.95)", LineStyle.Dashed, 2), mk("rgba(224,176,79,.7)", LineStyle.Solid, 1)];
    const host = el.current;
    let pendingFrame = 0;
    const fit = () => {
      if (!host) return;
      const w = Math.floor(host.clientWidth), h = Math.floor(host.clientHeight);
      if (w > 100 && h > 100) chart.resize(w, h);
    };
    const observer = new ResizeObserver(() => {
      if (pendingFrame) cancelAnimationFrame(pendingFrame);
      pendingFrame = requestAnimationFrame(fit);
    });
    if (host) observer.observe(host);
    pendingFrame = requestAnimationFrame(fit);
    // Lightweight Charts cannot infer whether a user intended to inspect a
    // previous candle. Pointer movement / wheel / touch switches to exploration.
    // A plain click does not pause live tracking.
    let down: {x:number;y:number;pointerId:number}|null=null;
    const persistView=()=>{
      const scale=chart.timeScale(),range=scale.getVisibleRange();
      if(viewKeyRef.current&&range&&typeof range.from==="number"&&typeof range.to==="number"){
        writeViewport(viewKeyRef.current,{from:Number(range.from),to:Number(range.to)});
      }
    };
    const explore=()=>{
      if(!followingRef.current)return;
      followingRef.current=false;setFollowing(false);
      chart.timeScale().applyOptions({shiftVisibleRangeOnNewBar:false});
    };
    const pointerDown=(e:PointerEvent)=>{down={x:e.clientX,y:e.clientY,pointerId:e.pointerId};};
    const pointerMove=(e:PointerEvent)=>{
      if(!down||e.pointerId!==down.pointerId)return;
      if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>5){explore();down=null;}
    };
    const pointerUp=()=>{if(down)persistView();down=null;};
    const wheel=()=>{explore();window.setTimeout(persistView,450);};
    host?.addEventListener("pointerdown",pointerDown,{passive:true});
    host?.addEventListener("pointermove",pointerMove,{passive:true});
    host?.addEventListener("pointerup",pointerUp,{passive:true});
    host?.addEventListener("pointercancel",pointerUp,{passive:true});
    host?.addEventListener("wheel",wheel,{passive:true});
    setReady(true);
    return () => {
      observer.disconnect();
      host?.removeEventListener("pointerdown",pointerDown);
      host?.removeEventListener("pointermove",pointerMove);
      host?.removeEventListener("pointerup",pointerUp);
      host?.removeEventListener("pointercancel",pointerUp);
      host?.removeEventListener("wheel",wheel);
      if (pendingFrame) cancelAnimationFrame(pendingFrame);
      if (hoverFrame) cancelAnimationFrame(hoverFrame);
      chart.remove(); chartRef.current = null; candleRef.current = null; volumeRef.current = null;
      linesRef.current.clear();
    };
  }, []);

  // Exploration is ALWAYS the default. Changing timeframe never grants
  // automatic scrolling back to the latest candles.
  useEffect(()=>{
    followingRef.current=false;setFollowing(false);
    chartRef.current?.timeScale().applyOptions({shiftVisibleRangeOnNewBar:false});
    olderExhaustedRef.current=false;setOlderEnd(false);
  },[tf,s.broker,s.accountInfo?.id]);

  // ------------------------------------------------------------------ datos
  useEffect(() => {
    try{localStorage.setItem("xauai.tf",tf);}catch{/*optional*/}
    if(!connected||!candleRef.current){
      loadedKeyRef.current="";setBarLoad({phase:"loading",count:0});return;
    }
    let cancelled=false;
    const datasetKey=[s.broker,s.accountInfo?.id||"sim",tf].join(":");
    const key=cacheKey(s.broker+":"+(s.accountInfo?.id||"sim"),tf);
    const firstLoad=loadedKeyRef.current!==datasetKey;
    viewKeyRef.current=key;
    const normalize=(input:any[]):ChartBar[]=>input.map(b=>({
      time:Number(b.time),open:Number(b.open),high:Number(b.high),
      low:Number(b.low),close:Number(b.close),volume:Number(b.volume||0),
    }));
    const ingest=(input:ChartBar[],cached:boolean)=>{
      if(cancelled||!candleRef.current||!chartRef.current||loadedKeyRef.current && loadedKeyRef.current!==datasetKey && !firstLoad)return;
      if(input.some((b,i)=>!Number.isFinite(b.time)||![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)
        ||b.low>b.high||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)
        ||i>0&&b.time<=input[i-1].time))throw new Error("Histórico OHLC inválido o desordenado.");
      const reset=loadedKeyRef.current!==datasetKey;
      const oldBars=reset?[]:barsRef.current;
      const bars=reset?input:mergePages(oldBars,input);
      if(!reset)mergeCurrentTick(bars,lastRef.current as ChartBar|null,stateRef.current.s.tick?.time,TF_SEC[tf]);
      const change=reset?{kind:"replace" as const,updates:bars}:historyChange(oldBars,bars);
      if(change.kind!=="unchanged"){
        const chart=chartRef.current;
        const previous=!reset&&change.kind==="replace"?captureViewport(chart,oldBars.length,followingRef.current):null;
        if(change.kind==="replace"){
          candleRef.current.setData(bars.map(b=>({...b,time:b.time as UTCTimestamp})));
          volumeRef.current?.setData(bars.map(b=>({time:b.time as UTCTimestamp,value:b.volume,
            color:b.close>=b.open?"rgba(65,174,136,.45)":"rgba(213,96,100,.45)"})));
        }else{
          for(const b of change.updates){
            candleRef.current.update({...b,time:b.time as UTCTimestamp});
            volumeRef.current?.update({time:b.time as UTCTimestamp,value:b.volume,
              color:b.close>=b.open?"rgba(65,174,136,.45)":"rgba(213,96,100,.45)"});
          }
        }
        barsRef.current=bars;
        timesRef.current=bars.map(b=>b.time);
        lastRef.current=bars.length?{...bars[bars.length-1]}:null;
        if(bars.length){
          if(reset){
            const saved=readViewport(key);
            if(saved){
              try{chart.timeScale().setVisibleRange({from:saved.from as UTCTimestamp,to:saved.to as UTCTimestamp});}
              catch{restoreViewport(chart,null,bars.length,true);}
            }else restoreViewport(chart,null,bars.length,true);
          }else if(change.kind==="replace")restoreViewport(chart,previous,bars.length,false);
          // Incremental candles NEVER change the manual viewport.
          else if(followingRef.current&&oldBars.length&&bars[bars.length-1].time>oldBars[oldBars.length-1].time)
            chart.timeScale().scrollToRealTime();
        }
      }
      loadedKeyRef.current=datasetKey;
      if(bars.length)cachePut(key,bars);
      setBarLoad(v=>v.phase===(bars.length?"ready":"empty")&&v.count===bars.length?v:
        {phase:bars.length?"ready":"empty",count:bars.length});
      if(cached)setHistorySource("cache");else setHistorySource("live");
    };
    if(firstLoad){
      olderExhaustedRef.current=false;setOlderEnd(false);
      const fromCache=cacheGet(key);
      if(fromCache?.length){try{ingest(fromCache,true);}catch{/*cache optional*/}}
      else setBarLoad({phase:"loading",count:0});
    }
    api(`/api/bars?tf=${tf}&limit=${INITIAL_SIZE}`).then(d=>{
      if(cancelled)return;
      if(!Array.isArray(d?.bars))throw new Error("La respuesta del histórico no contiene velas.");
      ingest(normalize(d.bars),false);
    }).catch((e:any)=>{
      if(cancelled)return;
      if(!barsRef.current.length||loadedKeyRef.current!==datasetKey)
        setBarLoad({phase:"error",count:0,message:e?.message||"Histórico no disponible."});
      toast(e?.message||"Error al sincronizar velas","error");
    });
    return ()=>{cancelled=true;};
  },[tf,connected,s.broker,s.accountInfo?.id,s.barsVersion,reload]);

  // ------------------------------------------------------------------ histórico progresivo
  useEffect(()=>{
    const chart=chartRef.current;
    if(!ready||!connected||!chart)return;
    const key=[s.broker,s.accountInfo?.id||"sim",tf].join(":");
    let cancelled=false,timeout=0;
    const loadOlder=async()=>{
      if(cancelled||olderBusyRef.current||olderExhaustedRef.current||!barsRef.current.length
        ||loadedKeyRef.current!==key)return;
      olderBusyRef.current=true;setOlderBusy(true);
      const before=barsRef.current[0].time;
      try{
        const d=await api(`/api/bars?tf=${tf}&before=${before}&limit=${HISTORICAL_PAGE_SIZE}`);
        if(cancelled||loadedKeyRef.current!==key)return;
        if(!Array.isArray(d?.bars))throw new Error("Página histórica inválida");
        const older:ChartBar[]=d.bars.map((b:any)=>({time:Number(b.time),open:Number(b.open),
          high:Number(b.high),low:Number(b.low),close:Number(b.close),volume:Number(b.volume||0)}))
          .filter((b:ChartBar)=>Number.isFinite(b.time)&&b.time<before&&Number.isFinite(b.close));
        if(!older.length){olderExhaustedRef.current=true;setOlderEnd(true);return;}
        const prev=captureViewport(chart,barsRef.current.length,false);
        const combined=mergePages(older,barsRef.current);
        if(combined.length===barsRef.current.length){olderExhaustedRef.current=true;setOlderEnd(true);return;}
        candleRef.current?.setData(combined.map(b=>({...b,time:b.time as UTCTimestamp})));
        volumeRef.current?.setData(combined.map(b=>({time:b.time as UTCTimestamp,value:b.volume,
          color:b.close>=b.open?"rgba(65,174,136,.45)":"rgba(213,96,100,.45)"})));
        barsRef.current=combined;timesRef.current=combined.map(b=>b.time);
        restoreViewport(chart,prev,combined.length,false);
        cachePut(cacheKey(s.broker+":"+(s.accountInfo?.id||"sim"),tf),combined);
        setHistorySource("paged");
        setBarLoad(v=>({...v,count:combined.length,phase:"ready"}));
      }catch(e:any){if(!cancelled)toast(e?.message||"Sin más datos históricos","error");}
      finally{olderBusyRef.current=false;if(!cancelled)setOlderBusy(false);}
    };
    const onVisible=(range:{from:number;to:number}|null)=>{
      if(!range||!barsRef.current.length||followingRef.current||olderBusyRef.current||olderExhaustedRef.current)return;
      if(range.from<100){
        if(timeout)window.clearTimeout(timeout);
        timeout=window.setTimeout(()=>{void loadOlder();},350);
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onVisible);
    return ()=>{
      cancelled=true;if(timeout)window.clearTimeout(timeout);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onVisible);
      olderBusyRef.current=false;
    };
  },[ready,connected,tf,s.broker,s.accountInfo?.id]);

  // ticks -> última vela
  useEffect(() => {
    const t = s.tick;
    const c = candleRef.current;
    const accountTfKey=[s.broker,s.accountInfo?.id||"sim",tf].join(":");
    if (!connected || loadedKeyRef.current!==accountTfKey || !t || !c || !lastRef.current) return;
    const sec = TF_SEC[tf];
    const bucket = t.time - (t.time % sec);
    const last = lastRef.current;
    if (bucket > last.time) {
      lastRef.current = { time: bucket, open: t.bid, high: t.bid, low: t.bid, close: t.bid };
      timesRef.current = [...timesRef.current, bucket];
      barsRef.current = [...barsRef.current, {...lastRef.current,volume:0}];
      setReload(value=>value+1);
    } else if (bucket === last.time) {
      last.high = Math.max(last.high, t.bid); last.low = Math.min(last.low, t.bid); last.close = t.bid;
      const tail=barsRef.current[barsRef.current.length-1];
      if(tail?.time===last.time)barsRef.current[barsRef.current.length-1]={...tail,
        high:Math.max(tail.high,last.high),low:Math.min(tail.low,last.low),close:last.close};
    } else return;
    c.update({ ...lastRef.current, time: lastRef.current.time as UTCTimestamp });
  }, [s.tick, tf]);

  // overlays (rangos, niveles de estrategias)
  useEffect(() => {
    if (!connected) return;
    const load = () => api("/api/overlays").then(setOverlays).catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [connected, s.strategies.map((x) => x.state).join()]);

  // Session Intelligence se calcula en M1 (no en la temporalidad visible) y
  // se comparte entre inspector y primitive. Si la cuenta cambia se descarta.
  useEffect(() => {
    let active = true;
    if (!connected || s.broker !== "cloud") { dispatch({type:"flow", flow:null}); return; }
    const fp = ui.flow;
    if (fp.mode === "fixed" && (!(fp.start && fp.end) || fp.end <= fp.start)) {
      dispatch({type:"flow",flow:null}); return;
    }
    const qs = new URLSearchParams({mode:fp.mode, scope:fp.scope,bins:String(fp.bins)});
    if (fp.mode === "fixed") {qs.set("start",String(fp.start));qs.set("end",String(fp.end));}
    const refresh = () => api("/api/flow?"+qs.toString())
      .then(d=>{if(active)dispatch({type:"flow",flow:d});})
      .catch(()=>{if(active)dispatch({type:"flow",flow:null});});
    void refresh();
    const timer=window.setInterval(refresh,30000);
    return () => { active=false; window.clearInterval(timer); };
  }, [connected,s.broker,s.accountInfo?.id,s.barsVersion,ui.flow.mode,ui.flow.scope,
      ui.flow.start,ui.flow.end,ui.flow.bins]);

  // operaciones del diario (trazos entrada → salida en la capa de dibujo)
  useEffect(() => {
    if (!connected) { setTrades([]); return; }
    api("/api/trades?n=300").then((d) => setTrades(d.trades || [])).catch(() => {});
  }, [connected, s.tradeClosed, s.positions.length, s.accountInfo?.id]);

  // cono de predicción
  useEffect(() => {
    const fc = s.signals?.forecast;
    const [lo, md, hi] = fcRef.current;
    if (!lo) return;
    // Auxiliary forecast lines can also alter Lightweight Charts' time scale.
    // Restore the user's manual historical view after reloading those series.
    const chart=chartRef.current;
    const snapshot=chart&&!followingRef.current
      ?captureViewport(chart,barsRef.current.length,false):null;
    const keepView=()=>{if(chart&&snapshot)restoreViewport(chart,snapshot,barsRef.current.length,false);};
    if (!ui.showForecast || !fc?.points?.length) {
      lo.setData([]);md.setData([]);hi.setData([]);keepView();return;
    }
    const last = lastRef.current?.time ?? fc.points[0].t;
    const pts = fc.points.map((p: any, i: number) => ({ ...p, t: i === 0 ? last : last + p.h * 3600 }));
    lo.setData(pts.map((p: any) => ({ time: p.t as UTCTimestamp, value: p.p10 })));
    md.setData(pts.map((p: any) => ({ time: p.t as UTCTimestamp, value: p.p50 })));
    hi.setData(pts.map((p: any) => ({ time: p.t as UTCTimestamp, value: p.p90 })));
    keepView();
  }, [ui.showForecast, s.signals?.forecast, tf]);

  // ------------------------------------------------------------------ líneas de precio
  const contract = s.settings?.contract_size || 100;
  const defs: LineDef[] = [];
  for (const p of s.positions) {
    const sideTxt = p.side > 0 ? "Compra" : "Venta";
    defs.push({ id: `pe${p.ticket}`, price: p.price_open, color: p.side > 0 ? th.buy : th.sell, title: `${sideTxt} ${p.volume} · ${p.profit >= 0 ? "+" : ""}${fmt(p.profit)}`, width: 1 });
    if (p.sl) defs.push({ id: `ps${p.ticket}`, price: p.sl, color: th.sl, title: `SL ${fmt((p.sl - p.price_open) * p.side * contract * p.volume)}`, width: 2, drag: { kind: "pos-sl", ticket: p.ticket } });
    if (p.tp) defs.push({ id: `pt${p.ticket}`, price: p.tp, color: th.tp, title: `TP +${fmt((p.tp - p.price_open) * p.side * contract * p.volume)}`, width: 2, drag: { kind: "pos-tp", ticket: p.ticket } });
  }
  for (const o of s.orders) {
    const okind: Record<string, string> = { buy_limit: "Compra límite", sell_limit: "Venta límite", buy_stop: "Compra stop", sell_stop: "Venta stop" };
    defs.push({ id: `oe${o.ticket}`, price: o.price, color: o.kind.startsWith("buy") ? th.buy : th.sell, title: `${okind[o.kind] || o.kind} ${o.volume}`, width: 2, style: LineStyle.Dashed, drag: { kind: "ord-price", ticket: o.ticket } });
    if (o.sl) defs.push({ id: `os${o.ticket}`, price: o.sl, color: th.sl, title: "SL pend.", style: LineStyle.Dashed, drag: { kind: "ord-sl", ticket: o.ticket } });
    if (o.tp) defs.push({ id: `ot${o.ticket}`, price: o.tp, color: th.tp, title: "TP pend.", style: LineStyle.Dashed, drag: { kind: "ord-tp", ticket: o.ticket } });
  }
  const pv = ui.preview;
  if (pv) {
    const risk = Math.abs(pv.entry - pv.sl);
    const rr = risk > 0 && pv.tp ? Math.abs(pv.tp - pv.entry) / risk : 0;
    if (pv.kind !== "market") defs.push({ id: "pv-e", price: pv.entry, color: th.forecast, title: `Entrada ${pv.kind === "limit" ? "límite" : "stop"}`, width: 2, drag: { kind: "pv-entry" } });
    defs.push({ id: "pv-s", price: pv.sl, color: th.sl, title: `SL (${fmt(risk)} $/oz)`, width: 2, style: LineStyle.Dashed, drag: { kind: "pv-sl" } });
    if (pv.tp) defs.push({ id: "pv-t", price: pv.tp, color: th.tp, title: `TP (${rr.toFixed(1)} R)`, width: 2, style: LineStyle.Dashed, drag: { kind: "pv-tp" } });
  }
  extraRef.current = defs.filter((d) => d.drag).map((d) => d.price);
  const sig = JSON.stringify(defs.map((d) => [d.id, d.price.toFixed(2), d.title, d.color]));

  // ------------------------------------------------------------------ tema del gráfico
  useEffect(() => {
    const chart = chartRef.current, c = candleRef.current;
    if (!chart || !c) return;
    const hollow = ui.chart.candles === "huecas";
    chart.applyOptions({
      layout: { background: { color: th.bg }, textColor: th.text },
      grid: { vertLines: { color: th.grid, visible: ui.chart.grid }, horzLines: { color: th.grid, visible: ui.chart.grid } },
      crosshair: { vertLine: { color: th.crosshair, labelBackgroundColor: th.border }, horzLine: { color: th.crosshair, labelBackgroundColor: th.border } },
      rightPriceScale: { borderColor: th.border }, timeScale: { borderColor: th.border },
    });
    c.applyOptions({ upColor: hollow ? th.bg : th.up, downColor: th.down, borderUpColor: th.up, borderDownColor: th.down, wickUpColor: th.wickUp, wickDownColor: th.wickDown });
    volumeRef.current?.applyOptions({visible:ui.layers.volumen!==false});
    const [lo, md, hi] = fcRef.current;
    lo?.applyOptions({ color: alpha(th.forecast, 0.7) }); hi?.applyOptions({ color: alpha(th.forecast, 0.7) }); md?.applyOptions({ color: th.forecast });
  }, [th.id, ui.chart.candles, ui.chart.grid, ui.layers.volumen]);

  // ------------------------------------------------------------------ capa de dibujo (rangos, niveles, estrategias, operaciones)
  useEffect(() => {
    const ov = overlayRef.current;
    if (!ov) return;
    const fc = ui.showForecast && s.signals?.forecast?.points?.length ? s.signals.forecast : null;
    const last = lastRef.current?.time ?? s.tick?.time ?? 0;
    const chartTimes = timesRef.current;
    const brokerOffset = s.broker === "cloud" && s.news_offset != null ? Number(s.news_offset) : null;
    const realSessions = ui.layers.sesionesReales !== false && brokerOffset != null &&
      Number.isFinite(brokerOffset) && Math.abs(brokerOffset) <= 15 * 3600 && chartTimes.length
      ? chartSessionWindows(
          Math.max(chartTimes[0], chartTimes[chartTimes.length - 1] - 20 * 86400),
          chartTimes[chartTimes.length - 1] + 86400,
          brokerOffset
        )
      : [];
    const focused = ui.tab === "flujo" && ui.flow.focus !== "all";
    const structure = !focused || ui.flow.focus === "structure";
    ov.setData({
      tf: TF_SEC[tf], times: () => timesRef.current, nowT: last, atr: s.signals?.atr, theme: th,
      flow: s.flow, flowFocus: ui.tab === "flujo" ? ui.flow.focus : "all",
      flowLayers: {profile:ui.layers.flujo !== false, fvg:ui.layers.fvg !== false,heatmap:ui.layers.heatmap!==false},
      layers: { rangos: !!ui.layers.rangos && structure, sesionesReales: ui.layers.sesionesReales !== false && !focused,
        niveles: !!ui.layers.niveles && structure, estrategias: !!ui.layers.estrategias && !focused,
        operaciones: !!ui.layers.operaciones && !focused, rr: ui.chart.rr && !focused },
      realSessions,
      zones: overlays?.zones || [], levels: s.signals?.levels || [], strategies: s.strategies || [],
      trades: trades.filter((t) => t.status !== "abierta"), positions: s.positions,
      preview: ui.preview ? { side: ui.preview.side, entry: ui.preview.entry, sl: ui.preview.sl, tp: ui.preview.tp } : null,
      forecast: fc ? { points: fc.points.map((p: any, i: number) => ({ ...p, t: i === 0 ? last : last + p.h * 3600 })) } : null,
      news: ui.layers.noticias === false ? [] : (s.news || []).filter((n: any) => n.country === "USD" && (n.impact === "High" || (n.impact === "Medium" && s.settings?.extra?.news_impact === "medium")))
        .map((n: any) => ({ t: n.ts + (s.news_offset ?? 7200), title: n.title, impact: n.impact })),
      newsWindow: s.settings?.extra?.news_enabled ? { before: Number(s.settings.extra.news_before || 0), after: Number(s.settings.extra.news_after || 0) } : null,
    });
  }, [th.id, tf, overlays, s.signals, s.strategies, trades, s.positions, ui.preview, ui.layers, ui.chart.rr, ui.showForecast, s.barsVersion, s.news, s.news_offset, s.flow, ui.flow.focus, ui.tab, s.settings?.extra, lastRef.current?.time, s.tick?.time ? Math.floor(s.tick.time / 30) : 0]);

  useEffect(() => {
    const c = candleRef.current;
    if (!c) return;
    const map = linesRef.current;
    const seen = new Set<string>();
    for (const d of defs) {
      seen.add(d.id);
      const cur = map.get(d.id);
      if (dragRef.current?.id === d.id) continue;            // no tocar la línea que se está arrastrando
      const opts = { price: d.price, color: d.color, title: d.title, lineWidth: (d.width || 1) as 1 | 2, lineStyle: d.style ?? LineStyle.Solid, axisLabelVisible: true };
      if (cur) { cur.line.applyOptions(opts); cur.def = d; }
      else map.set(d.id, { line: c.createPriceLine(opts), def: d });
    }
    for (const [id, v] of map) if (!seen.has(id) && dragRef.current?.id !== id) { c.removePriceLine(v.line); map.delete(id); }
  }, [sig]);

  // ------------------------------------------------------------------ arrastrar SL / TP / entrada
  useEffect(() => {
    const box = el.current;
    if (!box) return;
    let tol = 7;
    const near = (y: number) => {
      const c = candleRef.current;
      if (!c) return null;
      let best: { id: string; def: LineDef; d: number } | null = null;
      for (const [id, v] of linesRef.current) {
        if (!v.def.drag) continue;
        const ly = c.priceToCoordinate(v.def.price);
        if (ly === null) continue;
        const d = Math.abs(ly - y);
        if (d <= tol && (!best || d < best.d)) best = { id, def: v.def, d };
      }
      return best;
    };
    let pending: number | null = null;
    const tipFor = (def: LineDef, price: number, y: number) => {
      const { s: st, ui: u } = stateRef.current;
      const k = def.drag!.kind;
      let txt = `${fmt(price)}`;
      if (k.startsWith("pos")) {
        const p = st.positions.find((x) => x.ticket === def.drag!.ticket);
        if (p) {
          const pnl = (price - p.price_open) * p.side * contract * p.volume;
          const rsk = p.sl ? Math.abs(p.price_open - p.sl) : 0;
          txt += `  ·  ${pnl >= 0 ? "+" : ""}${fmt(pnl)} $` + (rsk && k === "pos-tp" ? `  ·  ${(Math.abs(price - p.price_open) / rsk).toFixed(2)} R` : "");
        }
      } else if (k.startsWith("pv") && u.preview) {
        const pvv = { ...u.preview, ...(k === "pv-sl" ? { sl: price } : k === "pv-tp" ? { tp: price } : { entry: price }) };
        const risk = Math.abs(pvv.entry - pvv.sl);
        txt += `  ·  riesgo ${fmt(risk)} $/oz` + (pvv.tp && risk ? `  ·  ${(Math.abs(pvv.tp - pvv.entry) / risk).toFixed(2)} R` : "");
      }
      setDragTip({ y, text: txt });
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const r = box.getBoundingClientRect();
      const hit = near(e.clientY - r.top);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { id: hit.id, def: hit.def };
      try { box.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
      chartRef.current?.applyOptions({ handleScroll: false, handleScale: false });
    };
    const move = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      const y = e.clientY - r.top;
      const dr = dragRef.current;
      if (!dr) {
        box.style.cursor = near(y) ? "ns-resize" : "";
        return;
      }
      const price = candleRef.current?.coordinateToPrice(y);
      if (price === null || price === undefined) return;
      const v = linesRef.current.get(dr.id);
      if (v) { v.line.applyOptions({ price }); v.def = { ...v.def, price }; }
      if (pending) cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => tipFor(dr.def, price, y));
    };
    const up = async () => {
      const dr = dragRef.current;
      if (!dr) return;
      dragRef.current = null;
      setDragTip(null);
      chartRef.current?.applyOptions({ handleScroll: true, handleScale: true });
      const v = linesRef.current.get(dr.id);
      const price = Math.round((v?.def.price ?? dr.def.price) * 100) / 100;
      const { s: st, ui: u } = stateRef.current;
      const k = dr.def.drag!.kind;
      try {
        if (k === "pos-sl" || k === "pos-tp") {
          const p = st.positions.find((x) => x.ticket === dr.def.drag!.ticket);
          if (!p) return;
          await api("/api/position/modify", "POST", { ticket: p.ticket, sl: k === "pos-sl" ? price : p.sl, tp: k === "pos-tp" ? price : p.tp });
          toast(`${k === "pos-sl" ? "SL" : "TP"} movido a ${fmt(price)}`, "ok");
        } else if (k.startsWith("ord")) {
          const o = st.orders.find((x) => x.ticket === dr.def.drag!.ticket);
          if (!o) return;
          await api("/api/order/modify", "POST", { ticket: o.ticket, price: k === "ord-price" ? price : o.price, sl: k === "ord-sl" ? price : o.sl, tp: k === "ord-tp" ? price : o.tp });
          toast("Orden pendiente modificada", "ok");
        } else if (u.preview) {
          u.setPreview((pp) => pp ? { ...pp, ...(k === "pv-sl" ? { sl: price } : k === "pv-tp" ? { tp: price } : { entry: price }) } : pp);
        }
      } catch (err: any) {
        toast(err.message, "error");
      }
    };
    const downT = (e: PointerEvent) => { tol = e.pointerType === "touch" ? 16 : 7; down(e); };
    box.addEventListener("pointerdown", downT, true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => { box.removeEventListener("pointerdown", downT, true); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
  }, [contract]);

  // ------------------------------------------------------------------ interfaz
  const fc = s.signals?.forecast;
  const p4 = fc?.points?.find((p: any) => p.h === 4);
  return (
    <div className="chartwrap" role="region" aria-label="Gráfico interactivo de XAUUSD">
      <div className="terminal-strip">
        <div className="terminal-identity">
          <span className="terminal-symbol">XAUUSD</span>
          <span className="terminal-divider" />
          <span className="terminal-market-label">Oro / dólar estadounidense</span>
          <span className="terminal-tf">{tf}</span>
          {barLoad.phase === "ready" && <span className="terminal-bar-count" title="Velas de esta temporalidad">{barLoad.count.toLocaleString("es-ES")} velas</span>}
        </div>
        <div className="terminal-utility">
          <span className={`terminal-connect ${connected ? "online" : ""}`}>
            <span className="terminal-connect-dot" />{s.sim ? "Simulación" : !connected ? "Sin cuenta" : s.ea?.online ? "MT5 sincronizado" : "Datos disponibles · EA sin conexión"}
          </span>
          <button className="terminal-link" onClick={()=>ui.setTab("seguridad")} title="Ver salud de las órdenes y del puente MT5">
            <Icon name="shield-check" size={14}/> Riesgo
          </button>
        </div>
      </div>
      <div className="toolbar">
        <div className="seg">
          {Object.keys(TF_SEC).map((k) => <button key={k} className={tf === k ? "on" : ""} onClick={() => setTf(k)}>{k}</button>)}
        </div>
        <div className="layers-wrap">
          <button className={`btn sm ${layersOpen ? "on" : ""}`} onClick={() => setLayersOpen(!layersOpen)} aria-expanded={layersOpen}>Capas <Icon name="chevron" size={13} /></button>
          {layersOpen ? (
            <div className="layers-menu" onMouseLeave={() => setLayersOpen(false)}>
              {([["heatmap","Mapa de confluencias (NO order book)","#dfb976"],["volumen", "Actividad de ticks (histograma por vela)", "#72af94"], ["rangos", "Rangos del EA (ALB/TOK/AORB)", th.zone.asia], ["sesionesReales", "Sesiones reales (Tokio/Londres/NY)", "#d8ad61"], ["flujo", "Perfil de volumen y POC", "#e5bf7c"], ["fvg", "Ineficiencias FVG", "#16b07a"], ["niveles", "Niveles clave", th.level.pd], ["estrategias", "Órdenes de las estrategias", th.buy], ["operaciones", "Operaciones (entrada → salida)", th.win], ["noticias", "Noticias USD", th.sl]] as [string, string, string][]).map(([k, l, c]) => (
                <label key={k} className="layer-item"><input type="checkbox" checked={ui.layers[k] !== false} onChange={(e) => ui.setLayer(k, e.target.checked)} /><i style={{ background: c }} />{l}</label>
              ))}
              <label className="layer-item"><input type="checkbox" checked={ui.chart.rr} onChange={(e) => ui.setChart({ rr: e.target.checked })} /><i style={{ background: th.tp }} />Zonas de riesgo / beneficio</label>
            </div>
          ) : null}
        </div>
        <button className="btn sm" title="Perfil de volumen, POC, VWAP y FVG" onClick={() => ui.setTab("flujo")}>Order Flow</button>
        <button className="btn sm" title="Horarios de Tokio, Londres y Nueva York" onClick={() => ui.setTab("sesiones")}>Sesiones</button>
        <button className={`btn sm ${drawOpen ? "on" : ""}`} title="Herramientas de dibujo" aria-pressed={drawOpen}
          onClick={() => { const v = !drawOpen; setDrawOpen(v); try { localStorage.setItem("xauai.drawopen", v ? "1" : "0"); } catch { /* sin almacenamiento */ } }}><Icon name="edit" size={14} />Dibujo</button>
        <div className="spacer" />
        <span className={`chart-navigation-state ${following?"live":"exploring"}`}
          role="status" aria-live="polite" title={following?"El gráfico sigue las nuevas velas":"Exploración manual: las actualizaciones no cambian tu posición"}>
          <span className="chart-navigation-dot" />{following?"En vivo":"Explorando"}
        </span>
        <button className={`btn sm ${following?"":"on"}`} aria-label="Volver al precio actual y reanudar seguimiento"
          title="Volver a la última vela y reanudar el seguimiento automático" onClick={()=>{
            followingRef.current=true;setFollowing(true);
            chartRef.current?.timeScale().applyOptions({shiftVisibleRangeOnNewBar:true});
            chartRef.current?.timeScale().scrollToRealTime();
          }}>
          <Icon name="clock" size={13}/> Actual
        </button>
        <button className={`btn sm ${ui.showForecast ? "on" : ""}`} onClick={() => ui.setShowForecast(!ui.showForecast)} disabled={!fc} aria-pressed={ui.showForecast} title="Rango histórico estimado; no indica dirección futura">Rango estimado</button>
        {s.sim ? <SimControls /> : null}
      </div>
      <div className="chart">
        <div ref={el} style={{ position: "absolute", inset: 0 }} />
        <DrawingTools ready={ready && connected} open={drawOpen && connected} box={el} chartRef={chartRef} candleRef={candleRef} timesRef={timesRef} barsRef={barsRef}
          onProfileRange={(range) => {if(range) ui.setFlow({mode:"fixed",start:range.start,end:range.end});}}
          tf={TF_SEC[tf]} theme={th} drawKey={!connected ? null : s.broker === "cloud" && s.accountInfo?.id ? { cloud: true, account: s.accountInfo.id } : s.broker === "sim" || s.sim ? { cloud: false, account: "sim" } : null} />
        <div className={`chart-legend ${drawOpen && connected ? "shift" : ""}`}>
          {s.tick || hover ? (
            <div className="ohlc mono" style={{ color: th.text }}>
              <span style={{ color: th.light ? "#1f2633" : "#e6e9ef", fontWeight: 700 }}>{s.settings?.symbol || "XAUUSD"}</span>
              <span>· {tf}</span>
              {hover ? (() => {
                const ch = hover.c - hover.o, col = ch >= 0 ? th.up : th.down;
                return <>
                  <span>O <b style={{ color: col }}>{fmt(hover.o)}</b></span><span>H <b style={{ color: col }}>{fmt(hover.h)}</b></span>
                  <span>L <b style={{ color: col }}>{fmt(hover.l)}</b></span><span>C <b style={{ color: col }}>{fmt(hover.c)}</b></span>
                  <span style={{ color: col }}>{ch >= 0 ? "+" : ""}{fmt(ch)} ({((ch / hover.o) * 100).toFixed(2)} %)</span>
                </>;
              })() : s.tick ? <>
                <span>Bid <b style={{ color: th.down }}>{fmt(s.tick.bid)}</b></span><span>Ask <b style={{ color: th.up }}>{fmt(s.tick.ask)}</b></span>
                <span>Spread {fmt(s.tick.ask - s.tick.bid)}</span>
              </> : null}
            </div>
          ) : null}
          {connected && s.market && s.market.open === false && !s.sim && s.ea?.online ? (
            <div className="box small"><b style={{ color: "var(--warn)" }}>Mercado cerrado</b>{s.market.last_tick ? ` · último precio ${new Date(s.market.last_tick * 1000).toISOString().slice(11, 16)} (servidor)` : ""}</div>
          ) : null}
          {ui.showForecast && p4 ? (
            <div className="box small">
              <b className="gold">Rango 80 % a 4 h</b> {fmt(p4.p10)} – {fmt(p4.p90)}
            </div>
          ) : null}
          {ui.preview ? <div className="box small gold">Arrastra las líneas SL / TP{ui.preview.kind !== "market" ? " / entrada" : ""} en el gráfico</div> : null}
        </div>
        {dragTip ? <div className="dragtip" style={{ top: dragTip.y }}>{dragTip.text}</div> : null}
        {connected && barLoad.phase !== "ready" && <div className="chart-data-state" role="status" aria-live="polite">
          {barLoad.phase === "loading" ? <>
            <span className="chart-data-spinner" aria-hidden="true"/>
            <strong>Preparando gráfico {tf}</strong>
            <span>Sincronizando histórico de velas de MT5…</span>
          </> : <>
            <Icon name="alert-triangle" size={25}/>
            <strong>{barLoad.phase === "empty" ? "Sin velas históricas para esta cuenta" : "No se pudo visualizar el histórico"}</strong>
            <span>{barLoad.phase === "empty"
              ? "La cotización puede estar activa aunque todavía no se hayan sincronizado las velas M1."
              : barLoad.message || "Revisa la conexión y la integridad de los datos del bróker."}</span>
            <button className="btn sm" onClick={()=>setReload(x=>x+1)}>Reintentar carga</button>
          </>}
        </div>}
        {!connected ? <ConnectOverlay /> : null}
      </div>
    </div>
  );
}

function SimControls() {
  const { s } = useApp();
  const set = (b: any) => api("/api/sim", "POST", b).catch(() => {});
  return (
    <div className="row small">
      <button className="btn sm" onClick={() => set({ paused: !s.sim?.paused })}>{s.sim?.paused ? "▶ Reanudar" : "❚❚ Pausa"}</button>
      <select value={s.sim?.speed} onChange={(e) => set({ speed: Number(e.target.value) })}>
        {[1, 10, 60, 300, 1200].map((v) => <option key={v} value={v}>{v === 1 ? "Tiempo real" : `x${v}`}</option>)}
      </select>
    </div>
  );
}

function ConnectOverlay() {
  const ui = useUI();
  const { s } = useApp();
  return (
    <div className="overlay-empty">
      <div className="col" style={{ alignItems: "center", textAlign: "center", maxWidth: 420 }}>
        <Logo size={44} />
        <div className="muted">{s.status === "conectando" ? "Cargando la cuenta…" : "Elige una cuenta o prueba el simulador."}</div>
        <button className="btn primary" onClick={() => ui.setAccountOpen(true)} disabled={s.status === "conectando"}>{s.status === "conectando" ? "Cargando…" : "Elegir cuenta"}</button>
      </div>
    </div>
  );
}
