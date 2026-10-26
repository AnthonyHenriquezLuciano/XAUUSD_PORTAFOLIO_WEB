// Chat de XAU Portfolio AI: reenvía la conversación a Claude con la API key que el usuario guardó en la web.
// La clave nunca llega al navegador: se lee aquí con el rol de servicio. Devuelve el texto en streaming.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: u, error: ue } = await admin.auth.getUser(jwt);
  if (ue || !u?.user) return json(401, { error: "Inicia sesión de nuevo" });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "Petición no válida" }); }
  const system = String(body.system || "").slice(0, 60000);
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const messages = msgs.slice(-24)
    .filter((m: any) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, 12000) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") return json(400, { error: "Falta tu mensaje" });

  const { data: sec } = await admin.from("user_secrets").select("anthropic_key, chat_model").eq("user_id", u.user.id).maybeSingle();
  const key = sec?.anthropic_key;
  if (!key) return json(400, { error: "Guarda tu API key de Anthropic en Ajustes → IA para usar el chat." });
  const model = MODELS.has(body.model) ? body.model : MODELS.has(sec?.chat_model) ? sec!.chat_model : "claude-sonnet-5-5";

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 1500, system, messages, stream: true }),
  });
  if (!r.ok || !r.body) {
    let msg = `Anthropic respondió ${r.status}`;
    try { const e = await r.json(); if (e?.error?.message) msg += `: ${e.error.message}`; } catch { /* sin cuerpo */ }
    if (r.status === 401) msg = "La API key de Anthropic no es válida. Revísala en Ajustes → IA.";
    return json(502, { error: msg });
  }

  // SSE de Anthropic -> texto plano en streaming
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  const stream = r.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      buf += dec.decode(chunk, { stream: true });
      let k: number;
      while ((k = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, k);
        buf = buf.slice(k + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") ctl.enqueue(enc.encode(ev.delta.text));
            else if (ev.type === "error") ctl.enqueue(enc.encode(`\n\n[Error de Claude: ${ev.error?.message || "desconocido"}]`));
          } catch { /* línea incompleta */ }
        }
      }
    },
  }));
  return new Response(stream, { headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } });
});
