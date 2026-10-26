import React, { useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";

export function Toggle({ on, onChange, title, label }: { on: boolean; onChange: (v: boolean) => void; title?: string; label?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label || title} className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)} title={title}><i /></button>;
}

/** Ayuda bajo demanda: un icono ⓘ que muestra el texto al pasar el ratón, enfocar o tocar */
export function Tip({ text, size = 14 }: { text: React.ReactNode; size?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !ref.current || !pop.current) return;
    const r = ref.current.getBoundingClientRect(), p = pop.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - p.width - 8, r.left + r.width / 2 - p.width / 2));
    const below = r.bottom + 8 + p.height < window.innerHeight;
    setPos({ left, top: below ? r.bottom + 8 : r.top - p.height - 8 });
  }, [open]);
  return (
    <span ref={ref} className="tip" tabIndex={0} role="button" aria-label="Más información"
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => { setOpen(false); setPos(null); }}
      onFocus={() => setOpen(true)} onBlur={() => { setOpen(false); setPos(null); }}
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((o) => !o); if (open) setPos(null); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } else if (e.key === "Escape") { setOpen(false); setPos(null); } }}>
      <Icon name="info" size={size} />
      {open ? <span ref={pop} className="tip-pop" role="tooltip" style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden", left: 0, top: 0 }}>{text}</span> : null}
    </span>
  );
}

export function Field({ label, children, hint, tip }: { label: string; children: React.ReactNode; hint?: string; tip?: React.ReactNode }) {
  const id = React.useId();
  const el = React.isValidElement(children) ? (children as React.ReactElement<any>) : null;
  const labelable = !!el && (["input", "select", "textarea"].includes(el.type as string) || el.type === Num);
  return (
    <div className="field">
      <span className="field-l"><label htmlFor={labelable ? id : undefined}>{label}</label>{tip ? <Tip text={tip} size={13} /> : null}</span>
      {labelable ? React.cloneElement(el!, { id: el!.props.id || id }) : children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Num({ value, onChange, step = 0.01, min, max, disabled, id, suffix }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; disabled?: boolean; id?: string; suffix?: string }) {
  const [txt, setTxt] = React.useState(String(value ?? ""));
  React.useEffect(() => { if (Number(txt) !== value) setTxt(value === null || value === undefined ? "" : String(value)); }, [value]);
  const input = (
    <input id={id} type="number" inputMode="decimal" className="num" value={txt} step={step} min={min} max={max} disabled={disabled}
      onChange={(e) => { setTxt(e.target.value); const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange(v); }} />
  );
  return suffix ? <span className="num-wrap">{input}<span className="num-suf">{suffix}</span></span> : input;
}

export function Seg<T extends string>({ value, options, onChange, full }: { value: T; options: [T, string][]; onChange: (v: T) => void; full?: boolean }) {
  return (
    <div className={`seg ${full ? "full" : ""}`} role="radiogroup">
      {options.map(([v, l], i) => <button type="button" key={v} role="radio" aria-checked={value === v}
        tabIndex={value===v?0:-1} className={value === v ? "on" : ""} onClick={() => onChange(v)}
        onKeyDown={(e) => {
          const d = e.key==="ArrowRight"||e.key==="ArrowDown" ? 1 : e.key==="ArrowLeft"||e.key==="ArrowUp" ? -1 : 0;
          const next = e.key==="Home" ? 0 : e.key==="End" ? options.length-1 : d ? (i+d+options.length)%options.length : null;
          if(next===null)return;
          e.preventDefault();onChange(options[next][0]);
          const buttons=e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[role="radio"]');
          buttons?.[next]?.focus();
        }}>{l}</button>)}
    </div>
  );
}

/** Dato con etiqueta (KPI) */
export function Stat({ label, value, tone, sub, tip }: { label: string; value: React.ReactNode; tone?: "buy" | "sell" | "gold" | ""; sub?: React.ReactNode; tip?: React.ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-l">{label}{tip ? <Tip text={tip} size={12} /> : null}</span>
      <span className={`stat-v ${tone || ""}`}>{value}</span>
      {sub ? <span className="stat-s">{sub}</span> : null}
    </div>
  );
}

const PCOL: Record<string, string> = { TP: "var(--buy)", "TIEMPO+": "#5aa88a", "TIEMPO-": "#a8794e", SL: "var(--sell)" };
const PTXT: Record<string, string> = { TP: "TP", "TIEMPO+": "Tiempo +", "TIEMPO-": "Tiempo −", SL: "SL" };

export function ProbBar({ probs }: { probs: Record<string, number> | undefined }) {
  if (!probs) return <div className="hint">Calculando…</div>;
  const order = ["TP", "TIEMPO+", "TIEMPO-", "SL"];
  return (
    <div>
      <div className="probs">
        {order.map((k) => {
          const v = probs[k] || 0;
          return <div key={k} style={{ width: `${v * 100}%`, background: PCOL[k] }} title={`${PTXT[k]}: ${(v * 100).toFixed(1)} %`}>{v > 0.1 ? `${Math.round(v * 100)}%` : ""}</div>;
        })}
      </div>
      <div className="legend">{order.map((k) => <span key={k}><i style={{ background: PCOL[k] }} />{PTXT[k]}</span>)}</div>
    </div>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const c = score >= 80 ? "var(--buy)" : score >= 65 ? "#7fbf5a" : score >= 45 ? "var(--warn)" : "var(--sell)";
  return <div className="score" style={{ borderColor: c, color: c }}>{score}</div>;
}

export function Card({ title, children, right, tip, className, id }: { title?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode; tip?: React.ReactNode; className?: string; id?: string }) {
  return (
    <section className={`card ${className || ""}`} id={id}>
      {title ? <header className="card-h"><h3>{title}{tip ? <Tip text={tip} /> : null}</h3>{right ? <div className="card-a">{right}</div> : null}</header> : null}
      {children}
    </section>
  );
}

/** Fila de ajuste: etiqueta (con ayuda opcional) a la izquierda y control a la derecha */
export function SetRow({ label, tip, children, pending }: { label: React.ReactNode; tip?: React.ReactNode; children: React.ReactNode; pending?: boolean }) {
  return (
    <div className="setrow">
      <span className="setrow-l">{label}{tip ? <Tip text={tip} size={13} /> : null}{pending ? <span className="pending" title="Guardado; el EA lo aplicará al conectarse">pendiente</span> : null}</span>
      <div className="setrow-c">{children}</div>
    </div>
  );
}

export function Empty({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty"><span>{children}</span>{action}</div>;
}

/** Cabecera de página completa: título a la izquierda, acciones a la derecha */
export function PageHead({ title, children, sub }: { title: string; children?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="phead">
      <div><h1>{title}</h1>{sub ? <div className="phead-s">{sub}</div> : null}</div>
      {children ? <div className="phead-a">{children}</div> : null}
    </div>
  );
}
