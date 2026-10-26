import React, { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { Field } from "./ui";
import { Logo } from "./icons";

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

// Línea decorativa del fondo de la pantalla de acceso (forma de una sesión de oro, no son datos reales)
const SPARK = Array.from({ length: 90 }, (_, i) => {
  const y = 62 - i * 0.32 + 7 * Math.sin(i / 5.5) + 3.5 * Math.sin(i / 1.9) + (i > 55 ? (i - 55) * 0.5 : 0) * -0.6;
  return `${(i / 89) * 100},${y.toFixed(2)}`;
}).join(" ");
function Art() {
  return (
    <div className="login-art">
      <svg className="spark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="sp-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d8a23c" stopOpacity=".22" /><stop offset="1" stopColor="#d8a23c" stopOpacity="0" /></linearGradient></defs>
        <polygon points={`0,100 ${SPARK} 100,100`} fill="url(#sp-f)" />
        <polyline points={SPARK} fill="none" stroke="#d8a23c" strokeWidth=".35" vectorEffect="non-scaling-stroke" style={{ strokeWidth: 1.5 }} />
      </svg>
      <div className="brand"><Logo size={30} /><span className="brand-t">XAU <b>Portfolio</b></span></div>
      <h2>Opera oro con tus reglas de fondeo.</h2>
      <p>Portafolio automático, señales y diario evaluado para XAUUSD en MetaTrader 5.</p>
    </div>
  );
}

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

  const go = (m: "in" | "up" | "reset") => (e: React.MouseEvent) => { e.preventDefault(); setMode(m); setMsg(null); };
  return (
    <div className="login-bg">
      <Art />
      <div className="login-side">
        <form className="login" onSubmit={submit}>
          <h1>{mode === "in" ? "Entrar" : mode === "up" ? "Crear cuenta" : "Recuperar contraseña"}</h1>
          <div className="sub">{mode === "in" ? "Accede a tus cuentas de MT5." : mode === "up" ? "Usa el correo de tu invitación si te invitaron." : "Te enviaremos un enlace."}</div>
          <Field label="Correo"><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {mode !== "reset" ? <Field label="Contraseña"><input type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} required minLength={mode === "up" ? 8 : undefined} value={pw} onChange={(e) => setPw(e.target.value)} /></Field> : null}
          {msg ? <div className={msg.k === "err" ? "note bad" : "note ok"}>{msg.t}</div> : null}
          <button className="btn primary" type="submit" disabled={busy} style={{ width: "100%", padding: "10px" }}>{busy ? "Un momento…" : mode === "in" ? "Entrar" : mode === "up" ? "Crear cuenta" : "Enviar enlace"}</button>
          <div className="login-links">
            {mode !== "in" ? <a href="#" onClick={go("in")}>Ya tengo cuenta</a> : <a href="#" onClick={go("up")}>Crear cuenta</a>}
            {mode === "in" ? <a href="#" onClick={go("reset")}>Olvidé mi contraseña</a> : <span />}
          </div>
          <hr className="sep" />
          <button className="btn" type="button" onClick={onSim} style={{ width: "100%" }}>Probar el simulador sin cuenta</button>
        </form>
      </div>
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
      <Art />
      <div className="login-side">
        <form className="login" onSubmit={save}>
          <h1>Nueva contraseña</h1>
          <Field label="Contraseña nueva (mínimo 8 caracteres)"><input type="password" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          {msg ? <div className="note bad">{msg}</div> : null}
          <button className="btn primary" type="submit">Guardar contraseña</button>
        </form>
      </div>
    </div>
  );
}
