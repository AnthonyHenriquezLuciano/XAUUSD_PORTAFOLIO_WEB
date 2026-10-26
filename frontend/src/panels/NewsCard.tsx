import React, { useEffect, useState } from "react";
import { useApp } from "../store";
import { Card, Seg } from "../ui";

const IMP_TXT: Record<string, string> = { High: "Alto", Medium: "Medio", Low: "Bajo", Holiday: "Festivo" };
const dayKey = (t: number) => new Date(t * 1000).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short" });
const hm = (t: number) => new Date(t * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
function left(sec: number) {
  if (sec <= 0) return "";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 47 ? `en ${Math.round(h / 24)} días` : h > 0 ? `en ${h} h ${m} min` : `en ${m} min`;
}

/** Calendario económico: próximas noticias (por defecto USD de impacto alto y medio), en tu hora local. */
export default function NewsCard() {
  const { s } = useApp();
  const [scope, setScope] = useState<"usd" | "todas">("usd");
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => { const id = setInterval(() => setNow(Date.now() / 1000), 30000); return () => clearInterval(id); }, []);
  const all: any[] = s.news || [];
  if (s.broker !== "cloud") return null;
  const ex = s.settings?.extra || {};
  const list = all.filter((n) => (scope === "todas" ? n.impact !== "Low" : n.country === "USD" && (n.impact === "High" || n.impact === "Medium")))
    .filter((n) => n.ts >= now - 3 * 3600 && n.ts <= now + 4 * 86400);
  const block = s.market?.news;
  const next = all.filter((n) => n.country === "USD" && n.impact === "High" && n.ts > now).sort((a, b) => a.ts - b.ts)[0];
  let lastDay = "";
  return (
    <Card title="Noticias" right={<Seg value={scope} options={[["usd", "USD"], ["todas", "Todas"]]} onChange={setScope} />}>
      {block ? <div className="warnbox small" style={{ marginBottom: 8 }}><b>Pausa por noticia:</b> {block.title}. El EA no abre operaciones hasta las {hm(block.until)}.</div>
        : ex.news_enabled ? <div className="okbox small" style={{ marginBottom: 8 }}>Filtro activo: sin entradas {ex.news_before} min antes y {ex.news_after} min después de cada noticia de impacto {ex.news_impact === "medium" ? "alto y medio" : "alto"}.{next ? ` Próxima: ${next.title} ${left(next.ts - now)}.` : ""}</div>
        : <div className="hint" style={{ marginBottom: 6 }}>Filtro de noticias desactivado (Ajustes → Filtro de noticias).{next ? ` Próxima de alto impacto: ${next.title} ${left(next.ts - now)}.` : ""}</div>}
      {!list.length ? <div className="hint">{all.length ? "No hay noticias de ese tipo en los próximos días." : "Cargando calendario…"}</div> : list.map((n) => {
        const dk = dayKey(n.ts);
        const head = dk !== lastDay ? <div className="day-head">{dk}</div> : null;
        lastDay = dk;
        const past = n.ts < now - 60;
        return (
          <React.Fragment key={`${n.country}${n.ts}${n.title}`}>
            {head}
            <div className={`news-row ${past ? "past" : ""}`} title={n.forecast || n.previous ? `Previsión ${n.forecast || "–"} · Anterior ${n.previous || "–"}` : undefined}>
              <span className="mono">{hm(n.ts)}</span>
              <span><i className={`imp ${n.impact}`} />{scope === "todas" ? <b className="muted" style={{ marginRight: 6 }}>{n.country}</b> : null}{n.title}</span>
              <span className="small muted">{past ? "" : left(n.ts - now)}{!past && (n.forecast || n.previous) ? <span className="mono"> · {n.forecast || "–"} / {n.previous || "–"}</span> : null}</span>
            </div>
          </React.Fragment>
        );
      })}
      <div className="hint" style={{ marginTop: 6 }}>Horas en tu zona horaria. Impacto: <i className="imp High" />alto <i className="imp Medium" />medio. Previsión / anterior a la derecha.</div>
    </Card>
  );
}
