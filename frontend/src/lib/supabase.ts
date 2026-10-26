import { createClient } from "@supabase/supabase-js";

// Datos públicos del proyecto (la clave publicable solo permite lo que dejan las reglas RLS de la base de datos).
export const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || "https://neqfafcelxgcxroicmer.supabase.co";
export const SUPABASE_KEY = (import.meta as any).env?.VITE_SUPABASE_KEY || "sb_publishable_xX-_WIouf3jcyc6AII00dA_QQZepNYD";
// Clave anon (JWT público) que lleva el EA en sus entradas; se muestra en las instrucciones de conexión.
export const SUPABASE_ANON_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lcWZhZmNlbHhnY3hyb2ljbWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NzQzMTksImV4cCI6MjEwODQ1MDMxOX0.vXL1CxSMtno5ynotmSramelv7hXEaN0oQ8NmGC9eWZo";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 20 } },
});
