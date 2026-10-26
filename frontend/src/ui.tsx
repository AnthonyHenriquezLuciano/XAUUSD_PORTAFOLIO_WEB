import React from "react";

export function Toggle({ on, onChange, title }: { on: boolean; onChange: (v: boolean) => void; title?: string }) {
  return <button className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)} title={title} aria-pressed={on}><i /></button>;
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  const id = React.useId();
  const el = React.isValidElement(children) ? (children as React.ReactElement<any>) : null;
  const labelable = !!el && (["input", "select", "textarea"].includes(el.type as string) || el.type === Num);
  return (
    <div className="field">
      <label htmlFor={labelable ? id : undefined}>{label}</label>
      {labelable ? React.cloneElement(el!, { id: el!.props.id || id }) : children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Num({ value, onChange, step = 0.01, min, max, disabled, id }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; disabled?: boolean; id?: string }) {
  const [txt, setTxt] = React.useState(String(value ?? ""));
  React.useEffect(() => { if (Number(txt) !== value) setTxt(value === null || value === undefined ? "" : String(value)); }, [value]);
  return (
    <input id={id} type="number" className="mono" style={{ width: "100%" }} value={txt} step={step} min={min} max={max} disabled={disabled}
      onChange={(e) => { setTxt(e.target.value); const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange(v); }} />
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => <button key={v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

const PCOL: Record<string, string> = { TP: "#22b07d", "TIEMPO+": "#5fae8f", "TIEMPO-": "#a8744a", SL: "#e5534b" };

export function ProbBar({ probs }: { probs: Record<string, number> | undefined }) {
  if (!probs) return <div className="hint">Sin modelo todavía (Ajustes → IA → Entrenar).</div>;
  const order = ["TP", "TIEMPO+", "TIEMPO-", "SL"];
  return (
    <div>
      <div className="probs">
        {order.map((k) => {
          const v = probs[k] || 0;
          return <div key={k} style={{ width: `${v * 100}%`, background: PCOL[k] }} title={`${k}: ${(v * 100).toFixed(1)} %`}>{v > 0.08 ? `${Math.round(v * 100)}%` : ""}</div>;
        })}
      </div>
      <div className="legend">
        {order.map((k) => <span key={k}><i style={{ background: PCOL[k] }} />{k === "TP" ? "Llega al TP" : k === "SL" ? "Toca el SL" : k === "TIEMPO+" ? "Cierre por tiempo en ganancia" : "Cierre por tiempo en pérdida"}</span>)}
      </div>
    </div>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const c = score >= 80 ? "#22b07d" : score >= 65 ? "#7fbf5a" : score >= 45 ? "#e3a008" : "#e5534b";
  return <div className="score" style={{ border: `3px solid ${c}`, color: c }}>{score}</div>;
}

export function Card({ title, children, right }: { title?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="card">
      {title ? <div className="row between"><h4>{title}</h4>{right}</div> : null}
      {children}
    </div>
  );
}
