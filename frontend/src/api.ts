// Capa común: la interfaz habla con un "motor" (la cuenta en la nube o el simulador) mediante api() y mensajes.
export type Backend = {
  kind: "cloud" | "sim";
  api: (path: string, method: string, body: any) => Promise<any>;
  start: () => void | Promise<void>;
  stop: () => void;
};

const listeners = new Set<(m: any) => void>();
export function emit(m: any) { listeners.forEach((f) => { try { f(m); } catch (e) { console.error(e); } }); }
export function subscribe(fn: (m: any) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

let backend: Backend | null = null;
export function currentBackend() { return backend; }
export async function setBackend(b: Backend | null) {
  if (backend) { try { backend.stop(); } catch { /* nada */ } }
  backend = b;
  emit({ type: "reset" });
  if (b) await b.start();
}

export async function api<T = any>(path: string, method = "GET", body?: unknown): Promise<T> {
  if (!backend) throw new Error("Elige primero una cuenta o el simulador.");
  return (await backend.api(path, method, body ?? {})) as T;
}

export function openSocket(onMsg: (m: any) => void, onState: (open: boolean) => void) {
  const off = subscribe(onMsg);
  onState(true);
  return off;
}
