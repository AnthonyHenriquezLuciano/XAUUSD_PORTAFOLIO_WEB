import React, { useEffect, useState } from "react";
import { currentBackend, setBackend } from "../api";
import { createCloud } from "../cloud/engine";
import { createSim } from "../demo/sim";
import { SUPABASE_ANON_JWT, SUPABASE_URL, supabase } from "../lib/supabase";
import { useApp } from "../store";
import { useUI } from "../uiState";
import { Field } from "../ui";

const LAST = "xauai.lastAccount";
export const rememberAccount = (id: string | null) => { try { if (id) localStorage.setItem(LAST, id); else localStorage.removeItem(LAST); } catch { /* sin almacenamiento */ } };
export const lastAccount = () => { try { return localStorage.getItem(LAST); } catch { return null; } };

export async function openAccount(id: string) {
  await setBackend(await createCloud(id));
  rememberAccount(id);
}
export async function openSim() {
  await setBackend(await createSim());
}

const ago = (iso?: string | null) => {
  if (!iso) return "nunca";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? `hace ${Math.round(s)} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : `hace ${Math.round(s / 86400)} días`;
};

export default function AccountDialog({ signedIn }: { signedIn: boolean }) {
  const { s, toast, ask } = useApp();
  const ui = useUI();
  const [accs, setAccs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<{ k: "list" } | { k: "connect"; acc: any } | { k: "share"; acc: any }>({ k: "list" });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!signedIn) return;
    setLoading(true);
    try {
      const { data: me } = await supabase.auth.getUser();
      const [a, m, l] = await Promise.all([
        supabase.from("accounts").select("id, name, login, server, symbol, owner, created_at").order("created_at"),
        supabase.from("account_members").select("account_id, role").eq("user_id", me.user?.id),
        supabase.from("live").select("account_id, updated_at, equity"),
      ]);
      const roles = new Map((m.data || []).map((x: any) => [x.account_id, x.role]));
      const lv = new Map((l.data || []).map((x: any) => [x.account_id, x]));
      setAccs((a.data || []).map((x: any) => ({ ...x, role: roles.get(x.id) || "viewer", live: lv.get(x.id) })));
    } catch (e: any) { toast(e.message, "error"); } finally { setLoading(false); }
  };
  useEffect(() => { if (ui.accountOpen) { setView({ k: "list" }); load(); } }, [ui.accountOpen, signedIn]);

  if (!ui.accountOpen) return null;
  const close = () => { if (currentBackend()) ui.setAccountOpen(false); };

  const open = async (id: string) => {
    setBusy(true);
    try { await openAccount(id); ui.setAccountOpen(false); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const create = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_account", { p_name: name || "Mi cuenta" });
      if (error) throw error;
      setName("");
      await load();
      const { data: a } = await supabase.from("accounts").select("*").eq("id", data).single();
      setView({ k: "connect", acc: { ...a, role: "owner" } });
    } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); }
  };
  const remove = async (a: any) => {
    if (!(await ask(`¿Borrar la cuenta «${a.name}» de la web? Se borran sus velas, diario y ajustes guardados aquí (no toca MT5).`, "Borrar", true))) return;
    const { error } = await supabase.from("accounts").delete().eq("id", a.id);
    if (error) toast(error.message, "error"); else { if (lastAccount() === a.id) rememberAccount(null); load(); }
  };

  return (
    <div className="modal-bg" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal" style={{ width: "min(680px, 100%)" }} role="dialog" aria-modal="true">
        {view.k === "list" ? (
          <div className="col">
            <div className="row between"><h3 style={{ margin: 0 }}>Cuentas</h3>{currentBackend() ? <button className="btn sm ghost" onClick={close}>Cerrar</button> : null}</div>
            {signedIn ? (
              <>
                {loading ? <div className="hint">Cargando…</div> : null}
                {!loading && !accs.length ? <div className="hint">Aún no tienes cuentas. Crea una (una por cada cuenta de MT5 que quieras ver y operar desde aquí) y conecta el EA puente.</div> : null}
                {accs.map((a) => {
                  const online = a.live?.updated_at && Date.now() - Date.parse(a.live.updated_at) < 15000;
                  return (
                    <div key={a.id} className="acc" style={{ cursor: "default" }}>
                      <div className="row between wrap" style={{ gap: 8 }}>
                        <div>
                          <div className="row" style={{ gap: 6 }}><span className={`dot ${online ? "ok" : ""}`} /><b>{a.name}</b><span className="chip">{a.role === "owner" ? "propietario" : a.role === "trader" ? "puede operar" : "solo ver"}</span></div>
                          <div className="small muted">{a.login ? `${a.login} · ${a.server} · ${a.symbol || "XAUUSD"}` : "EA sin conectar todavía"} · EA {online ? "conectado" : `visto ${ago(a.live?.updated_at)}`}</div>
                        </div>
                        <div className="row" style={{ gap: 6 }}>
                          {a.role === "owner" ? <button className="btn sm" onClick={() => setView({ k: "connect", acc: a })}>Conectar EA</button> : null}
                          {a.role === "owner" ? <button className="btn sm" onClick={() => setView({ k: "share", acc: a })}>Compartir</button> : null}
                          <button className="btn sm primary" disabled={busy} onClick={() => open(a.id)}>{s.accountInfo?.id === a.id ? "Abierta" : "Abrir"}</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="card" style={{ marginTop: 4 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <input placeholder="Nombre (p. ej. FundingPips 100k fase 1)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
                    <button className="btn primary" disabled={busy} onClick={create}>Nueva cuenta</button>
                  </div>
                </div>
              </>
            ) : <div className="hint">Estás en el simulador sin iniciar sesión. Para conectar tu MT5, cierra el simulador y entra con tu correo.</div>}
            <div className="row between wrap" style={{ marginTop: 6, gap: 8 }}>
              <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { await openSim(); ui.setAccountOpen(false); } catch (e: any) { toast(e.message, "error"); } finally { setBusy(false); } }}>Simulador (días reales de oro)</button>
              {signedIn ? <button className="btn ghost sm" onClick={async () => { await setBackend(null); await supabase.auth.signOut(); rememberAccount(null); }}>Cerrar sesión</button> : null}
            </div>
            {accs.some((a) => a.role === "owner") ? <div className="small muted">¿Borrar una cuenta? {accs.filter((a) => a.role === "owner").map((a) => <a key={a.id} href="#" onClick={(e) => { e.preventDefault(); remove(a); }} style={{ marginLeft: 6 }}>{a.name}</a>)}</div> : null}
          </div>
        ) : view.k === "connect" ? <ConnectEA acc={view.acc} back={() => { setView({ k: "list" }); load(); }} open={() => open(view.acc.id)} /> : <Share acc={view.acc} back={() => setView({ k: "list" })} />}
      </div>
    </div>
  );
}

function Copy({ text, label }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="copyrow">
      <code className="mono">{text}</code>
      <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => {}); }}>{ok ? "Copiado" : label || "Copiar"}</button>
    </div>
  );
}

function ConnectEA({ acc, back, open }: { acc: any; back: () => void; open: () => void }) {
  const { toast, ask } = useApp();
  const [key, setKey] = useState("");
  const gen = async () => {
    if (!(await ask("Se genera una clave nueva para el EA. Si ya tenías el EA conectado con otra clave, dejará de funcionar hasta que pongas la nueva.\n\n¿Generar clave?", "Generar"))) return;
    const { data, error } = await supabase.rpc("rotate_bridge_key", { acc: acc.id });
    if (error) toast(error.message, "error"); else setKey(String(data));
  };
  return (
    <div className="col">
      <div className="row between"><h3 style={{ margin: 0 }}>Conectar el EA · {acc.name}</h3><button className="btn sm ghost" onClick={back}>Volver</button></div>
      <ol className="steps">
        <li><b>Descarga el EA</b> <a className="btn sm" href="/ea/XAU_Portfolio_Bridge_v6.mq5" download>XAU_Portfolio_Bridge_v6.mq5</a><div className="small muted">En MT5: Archivo → Abrir carpeta de datos → MQL5 → Experts. Copia ahí el archivo, ábrelo en MetaEditor y pulsa Compilar (F7).</div></li>
        <li><b>Permite la conexión</b>: MT5 → Herramientas → Opciones → Asesores expertos → marca «Permitir WebRequest para las URL listadas» y añade:<Copy text={SUPABASE_URL} /></li>
        <li><b>Genera la clave de esta cuenta</b> <button className="btn sm primary" onClick={gen}>Generar clave</button>
          {key ? <div style={{ marginTop: 6 }}><Copy text={key} /><div className="warnbox small" style={{ marginTop: 4 }}>Cópiala ahora: por seguridad no se vuelve a mostrar (se guarda cifrada). Con ella el EA puede enviar datos a esta cuenta y recibir sus órdenes.</div></div> : null}
        </li>
        <li><b>Pon el EA en un gráfico de XAUUSD</b> (cualquier temporalidad) y en «Entradas» rellena:
          <ul className="small">
            <li><code>InpBridgeKey</code> = la clave del paso 3.</li>
            <li><code>InpInitialBalance</code> = balance inicial de la cuenta de fondeo (obligatorio).</li>
            <li><code>InpTargetPct</code> = 8 en fase 1, 5 en fase 2, 0 si ya está fondeada.</li>
            <li><code>InpAutoTrade</code> = false (lo activas después desde la web cuando quieras).</li>
            <li>Las demás entradas pueden quedarse como están. <code>InpWebURL</code> y <code>InpWebAnonKey</code> ya vienen puestas.</li>
          </ul>
          Activa el botón <b>Algo Trading</b> de MT5.
        </li>
        <li><b>Listo.</b> En unos segundos esta cuenta aparece como conectada y el EA empieza a subir el histórico de velas M1 (hasta 180 días, unos minutos).</li>
      </ol>
      <details className="small"><summary>Datos técnicos</summary><div className="muted">El EA llama cada segundo a la función <code>bridge_sync</code> con su clave. Clave pública del servidor (ya incluida en el EA):</div><Copy text={SUPABASE_ANON_JWT} /></details>
      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}><button className="btn" onClick={back}>Volver</button><button className="btn primary" onClick={open}>Abrir la cuenta</button></div>
    </div>
  );
}

function Share({ acc, back }: { acc: any; back: () => void }) {
  const { toast, ask } = useApp();
  const [members, setMembers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const load = async () => {
    const [m, i] = await Promise.all([
      supabase.from("account_members").select("user_id, role, email").eq("account_id", acc.id),
      supabase.from("invites").select("id, email, role, created_at").eq("account_id", acc.id),
    ]);
    setMembers(m.data || []); setInvites(i.data || []);
  };
  useEffect(() => { load(); }, [acc.id]);
  const invite = async () => {
    const e = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) return toast("Escribe un correo válido", "warn");
    const { error } = await supabase.from("invites").insert({ account_id: acc.id, email: e, role });
    if (error) toast(error.message.includes("duplicate") ? "Ya hay una invitación para ese correo" : error.message, "error"); else { setEmail(""); load(); toast("Invitación creada", "ok"); }
  };
  const setR = async (uid: string, r: string) => { const { error } = await supabase.from("account_members").update({ role: r }).eq("account_id", acc.id).eq("user_id", uid); if (error) toast(error.message, "error"); load(); };
  const del = async (uid: string, em: string) => { if (!(await ask(`¿Quitar el acceso de ${em}?`, "Quitar", true))) return; const { error } = await supabase.from("account_members").delete().eq("account_id", acc.id).eq("user_id", uid); if (error) toast(error.message, "error"); load(); };
  const delInv = async (id: string) => { await supabase.from("invites").delete().eq("id", id); load(); };
  const roleTxt = (r: string) => r === "owner" ? "propietario" : r === "trader" ? "puede operar" : "solo ver";
  return (
    <div className="col">
      <div className="row between"><h3 style={{ margin: 0 }}>Compartir · {acc.name}</h3><button className="btn sm ghost" onClick={back}>Volver</button></div>
      <div className="hint">Invita por correo. La persona crea su cuenta en esta web con ese mismo correo y verá la cuenta. «Solo ver» no puede operar ni cambiar ajustes; «Puede operar» sí (no puede generar la clave del EA ni compartir).</div>
      <div className="row wrap" style={{ gap: 6 }}>
        <input type="email" placeholder="correo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        <select value={role} onChange={(e) => setRole(e.target.value)}><option value="viewer">Solo ver</option><option value="trader">Puede operar</option></select>
        <button className="btn primary" onClick={invite}>Invitar</button>
      </div>
      <table className="t">
        <thead><tr><th>Persona</th><th>Acceso</th><th></th></tr></thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.user_id}><td>{m.email || m.user_id.slice(0, 8)}</td>
              <td>{m.role === "owner" ? roleTxt(m.role) : <select value={m.role} onChange={(e) => setR(m.user_id, e.target.value)}><option value="viewer">Solo ver</option><option value="trader">Puede operar</option></select>}</td>
              <td className="n">{m.role !== "owner" ? <button className="btn sm danger" onClick={() => del(m.user_id, m.email)}>Quitar</button> : null}</td></tr>
          ))}
          {invites.map((i) => <tr key={`i${i.id}`}><td>{i.email} <span className="chip">pendiente</span></td><td>{roleTxt(i.role)}</td><td className="n"><button className="btn sm ghost" onClick={() => delInv(i.id)}>Anular</button></td></tr>)}
        </tbody>
      </table>
    </div>
  );
}
