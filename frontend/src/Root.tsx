import React, { useEffect, useRef, useState } from "react";
import App from "./App";
import { Login, NewPassword, useSession } from "./auth";
import { currentBackend, setBackend } from "./api";
import { lastAccount, openAccount, openSim, rememberAccount } from "./components/AccountDialog";
import { supabase } from "./lib/supabase";
import { useApp } from "./store";
import { useUI } from "./uiState";

export default function Root() {
  const { session, loading, recovery, clearRecovery } = useSession();
  const [simOnly, setSimOnly] = useState(false);
  const ui = useUI();
  const { toast } = useApp();
  const started = useRef<string | null>(null);

  // al entrar: aceptar invitaciones y abrir la última cuenta usada
  useEffect(() => {
    const uid = session?.user?.id || null;
    if (!uid || started.current === uid) return;
    started.current = uid;
    (async () => {
      try { const { data } = await supabase.rpc("claim_invites"); if (data > 0) toast(`Tienes ${data} cuenta(s) compartida(s) nueva(s)`, "ok"); } catch { /* sin invitaciones */ }
      const last = lastAccount();
      if (last) {
        try { await openAccount(last); return; } catch { rememberAccount(null); }
      }
      ui.setAccountOpen(true);
    })();
  }, [session?.user?.id]);

  useEffect(() => { if (!session && !loading && !simOnly && currentBackend()?.kind === "cloud") { setBackend(null); started.current = null; } }, [session, loading]);

  if (loading) return <div className="splash">Cargando…</div>;
  if (recovery && session) return <NewPassword done={clearRecovery} />;
  if (!session && !simOnly) return <Login onSim={async () => { setSimOnly(true); try { await openSim(); } catch (e: any) { toast(e.message, "error"); } }} />;
  return <App signedIn={!!session} onExitSim={!session ? () => { setBackend(null); setSimOnly(false); } : undefined} />;
}
