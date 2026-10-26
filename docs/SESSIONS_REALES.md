# Sesiones reales de mercado

## Objetivo
Mostrar una referencia de los principales centros de actividad FX **independiente** de las ventanas de estrategias automáticas del oro.

| Centro | Zona horaria IANA | Jornada local de referencia |
|---|---|---|
| Tokio / Asia | Asia/Tokyo | 09:00–18:00 |
| Londres | Europe/London | 08:00–17:00 |
| Nueva York | America/New_York | 08:00–17:00 |

Las jornadas se calculan por fecha local con Intl.DateTimeFormat (IANA), incluyendo cambios de horario de verano, fines de semana y los periodos donde Europa y EE. UU. cambian el reloj en semanas distintas.

Definiciones:
- Referencia educativa de centros financieros, NO horario contractual del instrumento XAUUSD en MT5.
- Festivos, pausas intradiarias, cierre temporal de mercado y disponibilidad del oro dependen del bróker.
- Tokio lunes 09:00 corresponde al domingo 20:00 en República Dominicana.
- El estado "en sesión" NO implica permiso para operar.
- TZ seleccionable: hora RD, UTC o servidor MT5 estimado desde sincronización (opción deshabilitada si no hay conexión).
- En el gráfico se dibujan **bandas verticales por horario**; rangos de precio de ALB, TOK y AORB siguen siendo distintos.
- El gráfico usa el offset actual inferido del servidor del bróker. En periodos históricos que atraviesan su DST, debe verificarse la correspondencia o incorporarse una serie histórica de offsets del servidor. La disponibilidad precisa requeriría un calendario propio del bróker.

## Arquitectura
- src/sessions/marketSessions.ts: horarios y conversiones IANA, proyección al timestamp-naive de velas MT5.
- src/panels/RealSessions.tsx: apartado visual con cuenta atrás y timeline 24h.
- src/chart/overlay.ts: bandas verticales, etiquetas y límites, separadas de recuadros de estrategias.
- src/components/Chart.tsx: toggle de capas y navegación.
- test/validate_sessions.mjs: pruebas automatizadas de DST 2026 y RD / UTC / broker.

La capa no transmite comandos al EA y NO cambia horarios automáticos.

Referencias:
- https://www.babypips.com/tools/forex-market-hours
- https://fxrecap.com/forex-market-hours
