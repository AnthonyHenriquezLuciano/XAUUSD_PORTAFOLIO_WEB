import React, { useEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { COLORS, Drawing, DrawingsPrimitive, Handle, idxToT, Kind, Pt, Tool, tToIdx, TWO_POINTS, xToIdx } from "../chart/drawings";
import { deleteDrawings, DrawKey, loadDrawings, newId, saveDrawing } from "../chart/drawStore";
import type { ChartTheme } from "../chart/themes";
import { useApp } from "../store";

type Bar = { time: number; open: number; high: number; low: number; close: number };
type Props = {
  ready: boolean; open: boolean;
  box: React.RefObject<HTMLDivElement>;
  chartRef: React.MutableRefObject<IChartApi | null>;
  candleRef: React.MutableRefObject<ISeriesApi<"Candlestick"> | null>;
  timesRef: React.MutableRefObject<number[]>;
  barsRef: React.MutableRefObject<Bar[]>;
  tf: number; theme: ChartTheme; drawKey: DrawKey | null;
  onProfileRange?: (range: {start:number; end:number} | null) => void;
};

const I = (d: string) => <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const TOOLS: [Tool, string, React.ReactNode][] = [
  ["cursor", "Seleccionar y mover (Esc)", I("M5 3l10 6.5-4.5 1 2.5 5-2 1-2.5-5L5 15z")],
  ["hline", "Línea horizontal", I("M2 10h16M15 10a1 1 0 1 0 0 .01")],
  ["hray", "Rayo horizontal", I("M5 10h13M5 10a1.5 1.5 0 1 0 0 .01")],
  ["trend", "Línea de tendencia", I("M4 16L16 4M4 16a1.5 1.5 0 1 0 0 .01M16 4a1.5 1.5 0 1 0 0 .01")],
  ["ray", "Rayo (se prolonga)", I("M4 15L18 3M4 15a1.5 1.5 0 1 0 0 .01M10 10a1.5 1.5 0 1 0 0 .01")],
  ["vline", "Línea vertical", I("M10 2v16")],
  ["rect", "Rectángulo / zona", I("M3 6h14v8H3z")],
  ["profile", "VP · Perfil de volumen (2 puntos)", I("M3 4v12M3 5h12M3 8h8M3 11h14M3 14h6")],
  ["fib", "Retroceso de Fibonacci", I("M2 4h16M2 8h16M2 11h16M2 14h16M2 17h16")],
  ["text", "Texto", I("M5 5h10M10 5v11")],
  ["measure", "Medir (precio, % y tiempo)", I("M3 17L17 3M3 12v5h5M17 8V3h-5")],
];
const NAMES: Record<string, string> = { hline: "Línea horizontal", hray: "Rayo horizontal", trend: "Tendencia", ray: "Rayo", vline: "Línea vertical", rect: "Rectángulo", profile: "VP · Perfil de volumen", fib: "Fibonacci", text: "Texto" };
const LSP = "xauai.drawprefs";

export default function DrawingTools({ ready, open, box, chartRef, candleRef, timesRef, barsRef, tf, theme, drawKey, onProfileRange }: Props) {
  const { toast, ask } = useApp();
  const prefs = (() => { try { return JSON.parse(localStorage.getItem(LSP) || "{}"); } catch { return {}; } })();
  const [tool, setTool] = useState<Tool>("cursor");
  const [magnet, setMagnet] = useState<boolean>(prefs.magnet ?? true);
  const [hidden, setHidden] = useState<boolean>(!!prefs.hidden);
  const [color, setColor] = useState<string>(prefs.color || COLORS[0]);
  const [list, setList] = useState<Drawing[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [textEdit, setTextEdit] = useState<{ id: string; x: number; y: number; value: string } | null>(null);
  const prim = useRef<DrawingsPrimitive | null>(null);
  const live = useRef({ list, selected, tool, magnet, hidden, color, tf, theme, drawKey });
  live.current = { list, selected, tool, magnet, hidden, color, tf, theme, drawKey };
  const draft = useRef<Drawing | null>(null);
  const measure = useRef<{ a: Pt; b: Pt } | null>(null);
  const rangeCallback = useRef(onProfileRange);
  rangeCallback.current = onProfileRange;

  useEffect(() => { try { localStorage.setItem(LSP, JSON.stringify({ magnet, hidden, color })); } catch { /* sin almacenamiento */ } }, [magnet, hidden, color]);

  // capa de dibujo sobre las velas
  useEffect(() => {
    const c = candleRef.current;
    if (!ready || !c) return;
    const p = new DrawingsPrimitive();
    c.attachPrimitive(p);
    prim.current = p;
    return () => { try { c.detachPrimitive(p); } catch { /* gráfico ya destruido */ } prim.current = null; };
  }, [ready]);

  const push = () => {
    const L = live.current;
    const dr = draft.current;
    const ms = measure.current ?? (L.tool === "measure" && dr && dr.b ? { a: dr.a, b: dr.b } : null);
    prim.current?.set({ drawings: L.list, draft: L.tool === "measure" ? null : dr, measure: ms, selected: L.selected, hidden: L.hidden, theme: L.theme, tf: L.tf, times: () => timesRef.current });
  };
  useEffect(push, [list, selected, hidden, theme, tf, ready]);

  // cargar los dibujos de la cuenta
  useEffect(() => {
    setList([]); setSelected(null);
    if (!drawKey) return;
    let cancel = false;
    loadDrawings(drawKey).then((d) => { if (!cancel) setList(d); }).catch((e) => { if (!/does not exist|schema cache/i.test(e.message)) toast(`No se pudieron cargar los dibujos: ${e.message}`, "error"); });
    return () => { cancel = true; };
  }, [drawKey?.cloud, drawKey?.account]);

  useEffect(() => {
    // Selecting any saved profile loads its time bounds. A freshly drawn or edited profile
    // also becomes active. No M1 data is stored inside the drawing, only time anchors.
    const picked = list.find(x => x.id === selected && x.kind === "profile" && x.b) ||
      [...list].reverse().find(x => x.kind === "profile" && x.b);
    rangeCallback.current?.(picked?.b ? { start: Math.min(picked.a.t,picked.b.t),
      end: Math.max(picked.a.t,picked.b.t) + tf } : null);
  }, [list, selected, hidden, tf, drawKey?.account]);

  const persist = (d: Drawing, next: Drawing[]) => {
    const k = live.current.drawKey;
    if (k) saveDrawing(k, d, next).catch((e) => toast(`No se pudo guardar el dibujo: ${e.message}`, "error"));
  };
  const commit = (d: Drawing) => {
    const next = [...live.current.list.filter((x) => x.id !== d.id), d];
    live.current.list = next;
    setList(next);
    persist(d, next);
  };
  const remove = (ids: string[]) => {
    const next = live.current.list.filter((x) => !ids.includes(x.id));
    live.current.list = next;
    setList(next);
    setSelected(null);
    const k = live.current.drawKey;
    if (k) deleteDrawings(k, ids, next).catch((e) => toast(`No se pudo borrar: ${e.message}`, "error"));
  };

  // ---------------------------------------------------------------- ratón y dedo
  useEffect(() => {
    const el = box.current;
    if (!ready || !el) return;
    let mode: "none" | "draft" | "drag" = "none";
    let waiting = false;                       // dos puntos: esperando el segundo clic
    let downXY = { x: 0, y: 0 };
    let drag: { id: string; handle: Handle; orig: Drawing; idx0: number; p0: number } | null = null;
    let tol = 6;

    const local = (e: PointerEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const lock = (on: boolean) => chartRef.current?.applyOptions({ handleScroll: !on, handleScale: !on });
    const toPt = (x: number, y: number, snap = true): (Pt & { idx: number }) | null => {
      const ts = chartRef.current?.timeScale(), c = candleRef.current, T = timesRef.current;
      if (!ts || !c || !T.length) return null;
      let idx = xToIdx(ts, x);
      let p: number | null = c.coordinateToPrice(y) as number | null;
      if (idx == null || p == null) return null;
      if (snap) idx = Math.round(idx);
      if (live.current.magnet && snap) {
        const b = barsRef.current[idx];
        if (b) {
          let best = Infinity;
          for (const v of [b.open, b.high, b.low, b.close]) {
            const yy = c.priceToCoordinate(v);
            if (yy != null && Math.abs(yy - y) < best && Math.abs(yy - y) <= 14) { best = Math.abs(yy - y); p = v; }
          }
        }
      }
      return { t: Math.round(idxToT(T, live.current.tf, idx)), p: Math.round(Number(p) * 100) / 100, idx };
    };
    const make = (kind: Kind, a: Pt, b?: Pt): Drawing => ({ id: newId(), kind, a, b, color: live.current.color, width: kind === "fib" || kind === "rect" ? 1 : 2, ...(kind === "text" ? { text: "" } : {}) });
    const finishDraft = (b: Pt) => {
      const d = draft.current;
      draft.current = null;
      waiting = false;
      if (!d) return;
      if (live.current.tool === "measure") { measure.current = { a: d.a, b }; }
      else { const done = { ...d, b }; commit(done); setSelected(done.id); }
      setTool("cursor");
      lock(false);
      push();
    };

    const down = (e: PointerEvent) => {
      if (e.defaultPrevented) return;                         // ya lo tomó el arrastre de SL/TP
      if (e.button !== 0 && e.pointerType === "mouse") return;
      if ((e.target as HTMLElement)?.closest?.(".draw-ui")) return;
      tol = e.pointerType === "touch" ? 14 : 6;
      const { x, y } = local(e);
      const L = live.current;
      if (L.tool !== "cursor") {
        const pt = toPt(x, y);
        if (!pt) return;
        e.preventDefault(); e.stopPropagation();
        lock(true);
        if (waiting && draft.current) { finishDraft(pt); return; }
        if (TWO_POINTS.includes(L.tool)) {
          measure.current = null;
          draft.current = make((L.tool === "measure" ? "trend" : L.tool) as Kind, pt, pt);
          mode = "draft"; downXY = { x, y };
          push();
          return;
        }
        const d = make(L.tool as Kind, pt);
        commit(d); setSelected(d.id); setTool("cursor"); lock(false);
        if (d.kind === "text") setTextEdit({ id: d.id, x, y, value: "" });
        return;
      }
      if (measure.current) { measure.current = null; push(); }
      const h = prim.current?.hit(x, y, tol);
      if (!h) { if (L.selected) setSelected(null); return; }
      e.preventDefault(); e.stopPropagation();
      const d = L.list.find((q) => q.id === h.id);
      if (!d) return;
      setSelected(d.id);
      const pt = toPt(x, y, false);
      if (!pt) return;
      drag = { id: d.id, handle: h.handle, orig: JSON.parse(JSON.stringify(d)), idx0: pt.idx, p0: pt.p };
      mode = "drag"; lock(true);
      try { el.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
    };

    const move = (e: PointerEvent) => {
      const { x, y } = local(e);
      const L = live.current;
      if (L.tool !== "cursor") el.style.cursor = "crosshair";
      if (draft.current && (mode === "draft" || waiting)) {
        const pt = toPt(x, y);
        if (pt) { draft.current = { ...draft.current, b: { t: pt.t, p: pt.p } }; push(); }
        return;
      }
      if (mode === "drag" && drag) {
        const T = timesRef.current, tfS = L.tf;
        const o = drag.orig;
        let d: Drawing;
        if (drag.handle === "body") {
          const pt = toPt(x, y, false);
          if (!pt) return;
          const di = Math.round(pt.idx - drag.idx0), dp = pt.p - drag.p0;
          const mv = (q: Pt): Pt => ({ t: Math.round(idxToT(T, tfS, Math.round(tToIdx(T, tfS, q.t)) + di)), p: Math.round((q.p + dp) * 100) / 100 });
          d = { ...o, a: mv(o.a), ...(o.b ? { b: mv(o.b) } : {}) };
        } else {
          const pt = toPt(x, y);
          if (!pt) return;
          const q = { t: pt.t, p: pt.p };
          d = { ...o };
          if (o.kind === "hline") d.a = { ...o.a, p: q.p };
          else if (o.kind === "vline") d.a = { ...o.a, t: q.t };
          else if (drag.handle === "a") d.a = q;
          else if (drag.handle === "b") d.b = q;
          else if (drag.handle === "ab" && o.b) { d.a = { ...o.a, t: q.t }; d.b = { ...o.b, p: q.p }; }
          else if (drag.handle === "ba" && o.b) { d.b = { ...o.b, t: q.t }; d.a = { ...o.a, p: q.p }; }
        }
        live.current.list = L.list.map((z) => (z.id === d.id ? d : z));
        if (prim.current?.st) { prim.current.st.drawings = live.current.list; prim.current.redraw(); }
        return;
      }
      if (L.tool === "cursor" && mode === "none") {
        const r = el.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
        const h = prim.current?.hit(x, y, 6);
        if (h) el.style.cursor = h.handle === "body" ? "move" : "grab";
      }
    };

    const up = (e: PointerEvent) => {
      if (mode === "draft") {
        mode = "none";
        const { x, y } = local(e);
        if (Math.hypot(x - downXY.x, y - downXY.y) > 6) { const pt = toPt(x, y); if (pt) finishDraft({ t: pt.t, p: pt.p }); }
        else waiting = true;                                // clic sin arrastrar: el segundo punto va con otro clic
        return;
      }
      if (mode === "drag" && drag) {
        mode = "none";
        const d = live.current.list.find((z) => z.id === drag!.id);
        drag = null;
        lock(false);
        if (d) { setList(live.current.list); persist(d, live.current.list); }
      }
    };

    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const L = live.current;
      if (e.key === "Escape") {
        draft.current = null; waiting = false; measure.current = null; mode = "none"; lock(false);
        setTool("cursor"); setSelected(null); push();
      } else if ((e.key === "Delete" || e.key === "Backspace") && L.selected) {
        e.preventDefault(); remove([L.selected]);
      }
    };

    el.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key);
    return () => {
      el.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key);
    };
  }, [ready]);

  // con una herramienta activa, el dedo dibuja en vez de desplazar la página
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.touchAction = tool !== "cursor" ? "none" : "";
    if (tool === "cursor") el.style.cursor = "";
    if (tool !== "measure" && measure.current) { measure.current = null; push(); }
  }, [tool]);

  const sel = list.find((d) => d.id === selected) || null;
  const update = (patch: Partial<Drawing>) => { if (sel) commit({ ...sel, ...patch }); };
  const clearAll = async () => {
    if (!list.length) return;
    if (await ask(`¿Borrar los ${list.length} dibujos de esta cuenta?`, "Borrar todo")) remove(list.map((d) => d.id));
  };

  return (
    <>
      {open ? (
        <div className="draw-ui draw-bar" role="toolbar" aria-label="Herramientas de dibujo">
          {TOOLS.map(([k, label, icon]) => (
            <button key={k} className={`draw-btn ${tool === k ? "on" : ""}`} title={label} aria-label={label} aria-pressed={tool === k}
              onClick={() => { draft.current = null; setTool(tool === k && k !== "cursor" ? "cursor" : k); if (hidden && k !== "cursor") setHidden(false); }}>{icon}</button>
          ))}
          <div className="draw-sep" />
          <button className={`draw-btn ${magnet ? "on" : ""}`} title={magnet ? "Imán activado: se pega a apertura, máximo, mínimo o cierre" : "Imán desactivado"} aria-label="Imán" aria-pressed={magnet} onClick={() => setMagnet(!magnet)}>{I("M5 3v7a5 5 0 0 0 10 0V3M5 3h3v7a2 2 0 0 0 4 0V3h3")}</button>
          <button className={`draw-btn ${hidden ? "on" : ""}`} title={hidden ? "Mostrar dibujos" : "Ocultar dibujos"} aria-label={hidden ? "Mostrar dibujos" : "Ocultar dibujos"} aria-pressed={hidden} onClick={() => { setHidden(!hidden); setSelected(null); }}>{hidden ? I("M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6zM3 3l14 14") : I("M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6zM10 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z")}</button>
          <button className="draw-btn" title="Borrar todos los dibujos" aria-label="Borrar todos los dibujos" onClick={clearAll} disabled={!list.length}>{I("M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11")}</button>
        </div>
      ) : null}

      {open && tool !== "cursor" ? <div className="draw-ui draw-hint">{tool === "measure" ? "Arrastra o haz dos clics para medir" : TWO_POINTS.includes(tool) ? "Arrastra, o haz clic en el primer punto y luego en el segundo" : "Haz clic en el gráfico"} · Esc cancela</div> : null}

      {sel && !hidden ? (
        <div className="draw-ui draw-sel">
          <span className="small muted">{NAMES[sel.kind]}</span>
          {COLORS.map((c) => <button key={c} className={`swatch ${sel.color === c ? "on" : ""}`} style={{ background: c }} title="Color" aria-label={`Color ${c}`} onClick={() => { update({ color: c }); setColor(c); }} />)}
          <select value={sel.width} onChange={(e) => update({ width: Number(e.target.value) })} title="Grosor" aria-label="Grosor">{[1, 2, 3, 4].map((w) => <option key={w} value={w}>{w}px</option>)}</select>
          {sel.kind !== "text" ? <button className={`btn sm ${sel.dash ? "primary" : "ghost"}`} title="Línea discontinua" onClick={() => update({ dash: !sel.dash })}>- -</button> : null}
          <button className="btn sm ghost" title="Texto o etiqueta" onClick={() => {
            const r = box.current?.getBoundingClientRect();
            setTextEdit({ id: sel.id, x: (r?.width || 300) / 2 - 90, y: 46, value: sel.text || "" });
          }}>Aa</button>
          <button className="btn sm ghost" title="Borrar (Supr)" aria-label="Borrar dibujo" onClick={() => remove([sel.id])}>🗑</button>
        </div>
      ) : null}

      {textEdit ? (
        <input className="draw-ui draw-text" autoFocus value={textEdit.value} maxLength={80} placeholder="Escribe y pulsa Enter"
          style={{ left: Math.max(4, textEdit.x), top: Math.max(4, textEdit.y - 14) }}
          onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") { const d = live.current.list.find((q) => q.id === textEdit.id); if (d) commit({ ...d, text: textEdit.value.trim() }); setTextEdit(null); }
            if (e.key === "Escape") { const d = live.current.list.find((q) => q.id === textEdit.id); if (d && d.kind === "text" && !d.text) remove([d.id]); setTextEdit(null); }
          }}
          onBlur={() => { const d = live.current.list.find((q) => q.id === textEdit.id); if (d) { if (d.kind === "text" && !textEdit.value.trim() && !d.text) remove([d.id]); else commit({ ...d, text: textEdit.value.trim() }); } setTextEdit(null); }} />
      ) : null}
    </>
  );
}
