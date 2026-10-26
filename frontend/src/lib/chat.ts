import { SUPABASE_KEY, SUPABASE_URL, supabase } from "./supabase";

/** Envía la conversación a la función "chat" (que usa la API key guardada por el usuario) y devuelve el texto en streaming. */
export async function streamChat(system: string, messages: { role: string; content: string }[], onDelta: (t: string) => void, model?: string): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Inicia sesión para usar el chat con Claude (usa la API key que guardes en Ajustes → IA).");
  const r = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ system, messages, model }),
  });
  if (!r.ok || !r.body) {
    let msg = `El chat respondió ${r.status}`;
    try { const j = await r.json(); if (j?.error) msg = j.error; } catch { /* sin cuerpo */ }
    throw new Error(msg);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const t = dec.decode(value, { stream: true });
    if (t) { full += t; onDelta(t); }
  }
  return full;
}

/** Extrae las notas que Claude propone guardar: <nota>texto</nota>. */
export function extractNotes(text: string) {
  const out: string[] = [];
  const re = /<nota>([\s\S]*?)<\/nota>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { const t = m[1].trim(); if (t) out.push(t.slice(0, 2000)); }
  return { notes: out, clean: text.replace(re, (_s, t) => `📝 ${String(t).trim()}`) };
}
