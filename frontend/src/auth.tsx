import React, { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { Field } from "./ui";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((ev, s) => {
      setSession(s);
      if (ev === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return { session, loading, recovery, clearRecovery: () => setRecovery(false) };
}

const Logo = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#1a2030" /><path d="M7 22l6-8 5 5 7-10" stroke="#e0b04f" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

function errText(m: string) {
  if (/Invalid login credentials/i.test(m)) return "Correo o contraseña incorrectos.";
  if (/Email not confirmed/i.test(m)) return "Confirma tu correo con el enlace que te llegó antes de entrar.";
  if (/User already registered/i.test(m)) return "Ese correo ya tiene cuenta: entra con tu contraseña.";
  if (/Password should be at least/i.test(m)) return "La contraseña debe tener al menos 8 caracteres.";
  if (/rate limit/i.test(m)) return "Demasiados intentos seguidos. Espera unos minutos.";
  return m;
}

export function Login({ onSim }: { onSim: () => void }) {
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "err" | "ok"; t: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (error) throw error;
      } else if (mode === "up") {
        if (pw.length < 8) throw new Error("Password should be at least 8");
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: pw, options: { emailRedirectTo: location.origin } });
        if (error) throw error;
        if (!data.session) setMsg({ k: "ok", t: "Cuenta creada. Revisa tu correo y pulsa el enlace de confirmación; después entra aquí." });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin });
        if (error) throw error;
        setMsg({ k: "ok", t: "Si el correo tiene cuenta, te llegará un enlace para elegir una contraseña nueva." });
      }
    } catch (err: any) {
      setMsg({ k: "err", t: errText(err.message || String(err)) });
    } finally { setBusy(false); }
  };

  return (
    <div className="login-bg">
      <form className="login card" onSubmit={submit}>
        <div className="row" style={{ gap: 10, marginBottom: 6 }}><Logo /><div><div style={{ fontSize: 20, fontWeight: 700 }}>XAU <span className="gold">Portfolio AI</span></div><div className="small muted">Oro · MetaTrader 5 · FundingPips</div></div></div>
        <h3 style={{ margin: "10px 0 4px" }}>{mode === "in" ? "Entrar" : mode === "up" ? "Crear cuenta" : "Recuperar contraseña"}</h3>
        <Field label="Correo"><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        {mode !== "reset" ? <Field label="Contraseña"><input type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} required minLength={mode === "up" ? 8 : undefined} value={pw} onChange={(e) => setPw(e.target.value)} /></Field> : null}
        {msg ? <div className={msg.k === "err" ? "errbox" : "okbox"}>{msg.t}</div> : null}
        <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%", marginTop: 4 }}>{busy ? "Un momento…" : mode === "in" ? "Entrar" : mode === "up" ? "Crear cuenta" : "Enviar enlace"}</button>
        <div className="row between small" style={{ marginTop: 6 }}>
          {mode !== "in" ? <a href="#" onClick={(e) => { e.preventDefault(); setMode("in"); setMsg(null); }}>Ya tengo cuenta</a> : <a href="#" onClick={(e) => { e.preventDefault(); setMode("up"); setMsg(null); }}>Crear cuenta</a>}
          {mode === "in" ? <a href="#" onClick={(e) => { e.preventDefault(); setMode("reset"); setMsg(null); }}>Olvidé mi contraseña</a> : <span />}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>Solo tú y las personas que invites ven tus cuentas. Si te invitaron, crea tu cuenta con el mismo correo de la invitación.</div>
        <hr className="sep" />
        <button className="btn ghost" type="button" onClick={onSim} style={{ width: "100%" }}>Probar el simulador sin cuenta</button>
      </form>
    </div>
  );
}

export function NewPassword({ done }: { done: () => void }) {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) setMsg(errText(error.message)); else done();
  };
  return (
    <div className="login-bg">
      <form className="login card" onSubmit={save}>
        <h3 style={{ margin: 0 }}>Nueva contraseña</h3>
        <Field label="Contraseña nueva (mín. 8 caracteres)"><input type="password" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {msg ? <div className="errbox">{msg}</div> : null}
        <button className="btn primary" type="submit">Guardar</button>
      </form>
    </div>
  );
}
