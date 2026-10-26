// Descarga el calendario económico semanal (gratuito) y lo guarda en la tabla "news".
// La llama pg_cron cada hora; si ya se actualizó hace menos de 30 min no vuelve a descargar.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const URLS = [
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (!force) {
    const { data: last } = await admin.from("news").select("updated_at").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (last && Date.now() - Date.parse(last.updated_at) < 30 * 60 * 1000) return json(200, { ok: true, skipped: "actualizado hace menos de 30 min" });
  }
  const rows: any[] = [];
  const errors: string[] = [];
  for (const url of URLS) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "xau-portfolio-web/1.0" } });
      if (!r.ok) { errors.push(`${url.split("/").pop()}: ${r.status}`); continue; }
      const list = await r.json();
      for (const e of Array.isArray(list) ? list : []) {
        const ts = Math.floor(Date.parse(e.date) / 1000);
        if (!Number.isFinite(ts) || !e.title || !e.country) continue;
        rows.push({ id: `${e.country}|${ts}|${String(e.title).slice(0, 120)}`, ts, country: String(e.country).slice(0, 8), title: String(e.title).slice(0, 160),
          impact: String(e.impact || "").slice(0, 16), forecast: String(e.forecast ?? "").slice(0, 32), previous: String(e.previous ?? "").slice(0, 32), updated_at: new Date().toISOString() });
      }
    } catch (err) { errors.push(`${url.split("/").pop()}: ${(err as Error).message}`); }
  }
  if (rows.length) {
    const uniq = [...new Map(rows.map((r) => [r.id, r])).values()];
    const { error } = await admin.from("news").upsert(uniq, { onConflict: "id" });
    if (error) return json(500, { ok: false, error: error.message, errors });
    await admin.from("news").delete().lt("ts", Math.floor(Date.now() / 1000) - 30 * 86400);
  }
  return json(200, { ok: true, saved: rows.length, errors });
});
