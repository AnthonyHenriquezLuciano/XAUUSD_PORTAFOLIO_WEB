import React, { useEffect, useState } from "react";
import { useApp } from "../store";
import { Card, Seg } from "../ui";

const dayKey = (t: number) => new Date(t * 1000).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short" });
const hm = (t: number) => new Date(t * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
function left(sec: number) {
  if (sec <= 0) return "";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 47 ? `${Math.round(h / 24)} d` : h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** Calendario económico (USD de impacto alto y medio por defecto), en hora local */
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
  let lastDay = "";
  return (
    <Card title="Noticias" tip="Hora local. Rojo: impacto alto · ámbar: medio. A la derecha, previsión / anterior."
      right={<Seg value={scope} options={[["usd", "USD"], ["todas", "Todas"]]} onChange={setScope} />}>
      {block ? <div className="note bad">Pausa hasta las {hm(block.until)}: {block.title}</div>
        : ex.news_enabled ? <div className="note ok">Filtro activo · {ex.news_before} min antes y {ex.news_after} después</div> : null}
      {!list.length ? <div className="empty-s">{all.length ? "Sin noticias de ese tipo en los próximos días." : "Cargando calendario…"}</div> : list.map((n) => {
        const dk = dayKey(n.ts);
        const head = dk !== lastDay ? <div className="day-head">{dk}</div> : null;
        lastDay = dk;
        const past = n.ts < now - 60;
        return (
          <React.Fragment key={`${n.country}${n.ts}${n.title}`}>
            {head}
            <div className={`news-row ${past ? "past" : ""}`}>
              <span className="news-t">{hm(n.ts)}</span>
              <span className="news-n"><i className={`imp ${n.impact}`} />{scope === "todas" ? <b className="muted">{n.country} </b> : null}{n.title}</span>
              <span className="news-r">{past ? "" : left(n.ts - now)}{!past && (n.forecast || n.previous) ? <span className="dim"> {n.forecast || "–"}/{n.previous || "–"}</span> : null}</span>
            </div>
          </React.Fragment>
        );
      })}
    </Card>
  );
}
