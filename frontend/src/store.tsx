import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { api, openSocket } from "./api";
import type { FlowResponse } from "./flow/engine";

export type Tick = { time: number; bid: number; ask: number };
export type Position = { ticket: number; symbol: string; side: number; volume: number; price_open: number; sl: number; tp: number; profit: number; swap: number; magic: number; comment: string; time: number };
export type PendingOrder = { ticket: number; kind: string; volume: number; price: number; sl: number; tp: number; magic: number; comment: string; time: number };
export type EventMsg = { t: number; level: string; msg: string };

export type AppState = {
  socket: boolean;
  status: string;
  broker: string | null;
  account: any;
  positions: Position[];
  orders: PendingOrder[];
  risk: any;
  signals: any;
  strategies: any[];
  settings: any;
  models: any;
  training: any;
  tick: Tick | null;
  secrets: any;
  sim: any;
  history: number;
  mt5_available: boolean;
  local_history: any[];
  events: EventMsg[];
  lastBar: any;
  jobs: Record<string, any>;
  chat: { id: number; role: string; text: string; tools?: string[]; error?: string; streaming?: boolean }[];
  tradeClosed: number;
  market?: any;
  hist_info?: any;
  ea?: any;
  role?: string;
  me?: string;
  accountInfo?: any;
  barsVersion: number;
  flow?: FlowResponse | null;
  news?: any[];
  news_offset?: number;
};

const initial: AppState = {
  socket: false, status: "desconectado", broker: null, account: {}, positions: [], orders: [], risk: {}, signals: {},
  strategies: [], settings: null, models: {}, training: null, tick: null, secrets: {}, sim: null, history: 0,
  mt5_available: false, local_history: [], events: [], lastBar: null, jobs: {}, chat: [], tradeClosed: 0, barsVersion: 0,
};

function reducer(s: AppState, m: any): AppState {
  switch (m.type) {
    case "socket": return { ...s, socket: m.open };
    case "reset": return { ...initial, socket: s.socket };
    case "bars": return { ...s, barsVersion: s.barsVersion + 1 };
    case "flow": return { ...s, flow: m.flow };
    case "hello": return { ...s, ...m.state, signals: m.state?.signals && Object.keys(m.state.signals).length ? m.state.signals : s.signals };
    case "state": return { ...s, ...m.state };
    case "tick": return { ...s, tick: { time: m.t, bid: m.bid, ask: m.ask } };
    case "bar": return { ...s, lastBar: m };
    case "account": return { ...s, account: m.account, positions: m.positions, orders: m.orders, risk: m.risk, market: m.market ?? s.market, status: s.status === "desconectado" ? "conectado" : s.status };
    case "signals": return { ...s, signals: m.signals, strategies: m.signals?.strategies ?? s.strategies };
    case "settings": return { ...s, settings: m.settings };
    case "training": return { ...s, training: m.status };
    case "status": return { ...s, status: m.status };
    case "event": return { ...s, events: [{ t: m.t, level: m.level, msg: m.msg }, ...s.events].slice(0, 300) };
    case "events": return { ...s, events: m.events };
    case "job": return { ...s, jobs: { ...s.jobs, [m.name]: m } };
    case "trade_closed": return { ...s, tradeClosed: s.tradeClosed + 1 };
    case "chat_load": return { ...s, chat: m.messages };
    case "chat_user": return { ...s, chat: [...s.chat, { id: -Date.now(), role: "user", text: m.text }] };
    case "chat_start": return { ...s, chat: [...s.chat, { id: m.id, role: "assistant", text: "", streaming: true, tools: [] }] };
    case "chat_delta": return { ...s, chat: s.chat.map((c) => c.id === m.id ? { ...c, text: c.text + m.text } : c) };
    case "chat_tool": return { ...s, chat: s.chat.map((c) => c.id === m.id ? { ...c, tools: [...(c.tools || []), m.name] } : c) };
    case "chat_end": return { ...s, chat: s.chat.map((c) => c.id === m.id ? { ...c, streaming: false } : c) };
    case "chat_error": return { ...s, chat: s.chat.some((c) => c.id === m.id) ? s.chat.map((c) => c.id === m.id ? { ...c, streaming: false, error: m.error } : c) : [...s.chat, { id: m.id, role: "assistant", text: "", error: m.error }] };
    default: return s;
  }
}

type Ctx = { s: AppState; dispatch: React.Dispatch<any>; refresh: () => Promise<void>; toast: (msg: string, kind?: string) => void; toasts: { id: number; msg: string; kind: string }[]; ask: (msg: string, ok?: string, danger?: boolean) => Promise<boolean> };
const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [s, dispatch] = useReducer(reducer, initial);
  const [toasts, setToasts] = React.useState<{ id: number; msg: string; kind: string }[]>([]);
  const refresh = async () => {
    try { dispatch({ type: "state", state: await api("/api/state") }); } catch { /* ignore */ }
  };
  const toast = (msg: string, kind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  };
  const [dlg, setDlg] = React.useState<{ msg: string; ok: string; danger: boolean; resolve: (v: boolean) => void } | null>(null);
  const ask = (msg: string, ok = "Confirmar", danger = false) => new Promise<boolean>((resolve) => setDlg({ msg, ok, danger, resolve }));
  const close = (v: boolean) => { dlg?.resolve(v); setDlg(null); };
  const toastRef = useRef(toast);
  toastRef.current = toast;
  useEffect(() => {
    const close = openSocket((m) => {
      dispatch(m);
      if (m.type === "event" && (m.level === "warn" || m.level === "error")) toastRef.current(m.msg, m.level === "error" ? "error" : "warn");
    }, (open) => dispatch({ type: "socket", open }));
    return close;
  }, []);
  const value = useMemo(() => ({ s, dispatch, refresh, toast, toasts, ask }), [s, toasts]);
  return (
    <AppCtx.Provider value={value}>
      {children}
      {dlg ? (
        <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) close(false); }}>
          <div className="modal" style={{ width: "min(460px, 100%)" }} role="dialog" aria-modal="true">
            <div style={{ whiteSpace: "pre-wrap", marginBottom: 14 }}>{dlg.msg}</div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => close(false)}>Cancelar</button>
              <button className={`btn ${dlg.danger ? "danger" : "primary"}`} autoFocus onClick={() => close(true)}>{dlg.ok}</button>
            </div>
          </div>
        </div>
      ) : null}
    </AppCtx.Provider>
  );
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("sin contexto");
  return c;
}

export const fmt = (v: any, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? "–" : Number(v).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d }));
export const pct = (v: any, d = 0) => (v === null || v === undefined ? "–" : `${(Number(v) * 100).toFixed(d)} %`);
export const tstr = (t: number) => (t ? new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") : "–");
export const sideTxt = (s: number) => (s > 0 ? "COMPRA" : "VENTA");
