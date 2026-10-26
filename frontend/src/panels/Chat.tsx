import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useApp } from "../store";
import { useUI } from "../uiState";

const TOOL_TXT: Record<string, string> = {
  get_market_state: "mirando el mercado", get_account: "revisando tu cuenta", get_trades: "leyendo tu diario",
  evaluate_trade: "evaluando la operación", get_strategy_notes: "leyendo tus notas", save_strategy_note: "guardando una nota de tu estrategia",
  get_portfolio_stats: "consultando el historial del portafolio",
};

export default function Chat() {
  const { s, dispatch, toast } = useApp();
  const ui = useUI();
  const [text, setText] = useState("");
  const [notes, setNotes] = useState<any[]>([]);
  const [noteTxt, setNoteTxt] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const busy = s.chat.some((c) => c.streaming);
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [s.chat]);
  const loadNotes = () => api("/api/notes").then((d) => setNotes(d.notes)).catch(() => {});
  useEffect(() => { loadNotes(); }, [s.chat.length]);

  const send = async (t?: string) => {
    const msg = (t ?? text).trim();
    if (!msg || busy) return;
    dispatch({ type: "chat_user", text: msg });
    setText("");
    try { await api("/api/chat", "POST", { text: msg }); } catch (e: any) { toast(e.message, "error"); }
  };

  if (!s.secrets?.anthropic && s.broker === "cloud") {
    return (
      <div className="col">
        <div className="warnbox">Para hablar con la IA necesitas tu API key de Anthropic (console.anthropic.com). Se guarda cifrada en el servidor y solo la usa la función del chat.</div>
        <button className="btn primary" onClick={() => ui.setTab("ajustes")}>Ir a Ajustes → IA</button>
      </div>
    );
  }
  const quick = ["¿Cómo ves el mercado ahora y qué me conviene?", "Evalúa mis últimas operaciones manuales", "¿Por qué el portafolio no operó hoy?", "Te explico mi estrategia manual:"];
  return (
    <div className="chat">
      <div className="msgs" ref={box}>
        {s.chat.length === 0 ? <div className="hint">Pregúntale por el mercado, por tus operaciones o explícale tu estrategia manual para que te evalúe con ella.{!s.secrets?.anthropic && s.broker === "cloud" ? " Para usarlo guarda tu API key de Anthropic en Ajustes → IA." : ""}</div> : null}
        {s.chat.map((c) => (
          <div key={c.id} className={`msg ${c.role}`}>
            {c.tools?.length ? <div className="small muted" style={{ marginBottom: 4 }}>{Array.from(new Set(c.tools)).map((t) => TOOL_TXT[t] || t).join(" · ")}…</div> : null}
            {c.text ? c.text.replace(/<nota>([\s\S]*?)<\/nota>/gi, (_m: string, t: string) => `\n📝 Nota guardada: ${t.trim()}`) : (c.streaming ? <span className="muted">pensando…</span> : null)}
            {c.error ? <div className="errbox" style={{ marginTop: 4 }}>{c.error}</div> : null}
          </div>
        ))}
      </div>
      <div className="row wrap">{quick.map((q) => <button key={q} className="btn sm" onClick={() => (q.endsWith(":") ? setText(q + " ") : send(q))}>{q}</button>)}</div>
      <div className="row">
        <textarea className="grow" rows={2} value={text} placeholder="Escribe… (Enter para enviar, Mayús+Enter para salto de línea)" style={{ fontFamily: "var(--font)", fontSize: 13 }}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => send()}>Enviar</button>
      </div>
      <details>
        <summary className="small muted" style={{ cursor: "pointer" }}>Mi estrategia manual ({notes.length} notas)</summary>
        <div className="col" style={{ marginTop: 6 }}>
          {notes.map((n) => <div key={n.id} className="row between small"><span>• {n.text}</span><button className="btn sm ghost" onClick={() => api(`/api/notes/${n.id}`, "DELETE").then(loadNotes)}>✕</button></div>)}
          <div className="row"><input className="grow" placeholder="Añadir regla (p. ej. solo compro en Londres tras barrer el mínimo de Asia)" value={noteTxt} onChange={(e) => setNoteTxt(e.target.value)} />
            <button className="btn sm" onClick={() => noteTxt.trim() && api("/api/notes", "POST", { text: noteTxt }).then(() => { setNoteTxt(""); loadNotes(); })}>Añadir</button></div>
          <button className="btn sm ghost" onClick={() => api("/api/chat", "DELETE").then(() => dispatch({ type: "chat_load", messages: [] }))}>Borrar conversación</button>
        </div>
      </details>
    </div>
  );
}
