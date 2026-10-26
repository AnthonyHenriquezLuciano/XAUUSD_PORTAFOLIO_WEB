import { useEffect, useRef, useState } from "react";
import type { AppState } from "../store";

export type SmartAlerts = {
  enabled: boolean;
  supported: boolean;
  permission: NotificationPermission | "unavailable";
  setEnabled: (next: boolean) => Promise<void>;
};

export function useSmartAlerts(s: AppState): SmartAlerts {
  const id = s.accountInfo?.id || "sim";
  const key = "xauai.alerts." + id;
  const [enabled, setOn] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unavailable">(
    typeof Notification === "undefined" ? "unavailable" : Notification.permission
  );
  const prior = useRef<{ online: boolean; warning: string; over: boolean } | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    try { setOn(localStorage.getItem(key) === "on"); } catch { setOn(false); }
    prior.current = null;
    loaded.current = true;
  }, [key]);

  const setEnabled = async (next: boolean) => {
    if (!next) {
      setOn(false);
      try { localStorage.setItem(key, "off"); } catch { /* no storage */ }
      return;
    }
    if (typeof Notification === "undefined") return;
    const p = Notification.permission === "default"
      ? await Notification.requestPermission() : Notification.permission;
    setPermission(p);
    if (p !== "granted") { setOn(false); return; }
    prior.current = null;
    setOn(true);
    try { localStorage.setItem(key, "on"); } catch { /* no storage */ }
  };

  useEffect(() => {
    if (!loaded.current || s.status !== "conectado" || !s.accountInfo?.id) return;
    const online = !!s.ea?.online;
    const warning = s.risk?.blocked || s.market?.discipline?.why || "";
    const d = Number(s.risk?.daily_dd_pct || 0);
    const limit = Number(s.settings?.funding?.daily_loss_pct || 3);
    const over = limit > 0 && d >= limit * .75;
    const next = { online, warning: String(warning), over };
    const prev = prior.current;
    prior.current = next;
    if (!enabled || permission !== "granted" || !prev) return;
    const alert = (title: string, body: string) => {
      try { new Notification(title, { body, tag: "xau-portfolio-risk-" + id }); }
      catch { /* El navegador puede bloquear notificaciones según su configuración */ }
    };
    if (prev.online && !next.online) alert("XAU Portfolio · EA desconectado", "Verifica MT5 y la conexión del puente.");
    else if (!prev.over && next.over) alert("XAU Portfolio · DD elevado", "Se ha utilizado al menos el 75% del límite diario configurado.");
    else if (next.warning && next.warning !== prev.warning) alert("XAU Portfolio · Protección activa", next.warning);
  }, [enabled, permission, s.status, s.ea?.online, s.risk?.blocked,
    s.risk?.daily_dd_pct, s.settings?.funding?.daily_loss_pct, s.market?.discipline?.why, s.accountInfo?.id]);

  return { enabled, supported: typeof Notification !== "undefined", permission, setEnabled };
}
