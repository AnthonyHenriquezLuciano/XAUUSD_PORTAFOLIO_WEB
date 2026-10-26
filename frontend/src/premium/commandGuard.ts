/** Remote MT5 command reconciliation: browser-side fail-closed *advisory* guard.
 * Only the EA can determine whether a sent command was executed. A web timeout
 * or lost ACK must never be interpreted as an execution failure.
 */
export type CommandRow = {
  id: number; type: string; status: string; created_at?: string;
  done_at?: string | null; result?: any;
};
export const AMBIGUOUS = new Set(["pending", "sent"]);
export const TRADING_COMMANDS = new Set(["open","close","close_all","modify","modify_order","cancel"]);
export function outstandingCommands(rows: readonly CommandRow[]): CommandRow[] {
  return rows.filter(x=>TRADING_COMMANDS.has(x.type) && AMBIGUOUS.has(x.status));
}
export function commandNotice(cmd: CommandRow, now = Date.now()) {
  const ageSec = cmd.created_at ? Math.max(0, Math.floor((now - Date.parse(cmd.created_at))/1000)) : null;
  const age = ageSec == null || !Number.isFinite(ageSec) ? "antigüedad desconocida" : Math.floor(ageSec/60)+" min "+ageSec%60+" s";
  return "Orden #"+cmd.id+" ("+cmd.type+") · "+cmd.status+" · "+age;
}
export function commandAudit(rows: readonly CommandRow[], now = Date.now()) {
  const pending = outstandingCommands(rows);
  return {
    pending, blocked: pending.length > 0,
    oldestAgeSec: pending.reduce((max,x)=>{
      const age = x.created_at ? Math.max(0, Math.floor((now-Date.parse(x.created_at))/1000)) : 0;
      return Math.max(max, Number.isFinite(age) ? age : 0);
    },0),
    recentFailures: rows.filter(x=>x.status==="error"||x.status==="expired").length,
    explained: pending.length ? "Hay comandos cuyo resultado todavía no ha sido confirmado. Verifica operaciones, órdenes pendientes e historial de MT5; no repitas un comando de apertura." :
      "No hay comandos pendientes observados en esta consulta. No garantiza ausencia de órdenes ejecutadas fuera de la web."
  };
}
