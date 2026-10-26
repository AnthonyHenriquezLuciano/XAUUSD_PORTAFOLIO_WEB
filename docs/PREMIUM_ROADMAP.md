# XAU Portfolio AI · Plan de entrega Premium

**Estado:** primera iteración en rama de características. No habilitar directamente en cuentas de fondeo sin pruebas del EA en MetaTrader 5 y reglas del proveedor.

## Alcance aprobado

| # | Módulo | Primera entrega | Próxima fase necesaria |
|---|---|---|---|
| 1 | Centro de comando personalizable | Dashboard modular, orden, visibilidad y tamaño local por cuenta | Sincronización cloud, drag-and-drop, plantillas multimonitor |
| 2 | Smart Trade Ticket | Preflight de SL y exposición, margen y predicciones actualizadas | Validación de margen MT5, volumen real, spread, costes, slippage y garantías de EA |
| 3 | AI Decision Assistant | Régimen, volatilidad, sesgo y expectativa histórica | Calibración, atribuciones, abstención y evaluación independiente |
| 4 | Multi-Account Cockpit | Cuentas autorizadas, equity y conectividad | Riesgo consolidado, switching instantáneo y auditoría |
| 5 | Smart Notifications | Alertas browser con consentimiento mientras la web está abierta | Web Push y canales de servidor |
| 6 | Portfolio Lab | Monte Carlo exploratorio con remuestreo de R por bloques | Walk-forward y rutas de fondeo realistas por sesión |
| 7 | Funding Mission Control | Objetivos, DD y margen actual | Días operados, consistencia y plantillas verificadas |
| 8 | Shadow Trading | Libro local de operaciones virtuales, PnL flotante | Motor paper persistente con SL, TP, costes y gaps |
| 9 | Trading Replay Pro | Velas M1/M5/M15/H1 progresivas, reproducción y diario | Sincronización horaria del bróker, órdenes simuladas y ticks |
| 10 | Portfolio Risk Radar | Lotes y pérdida estimada hasta stops | Peores fills/gaps, pendientes y riesgo entre cuentas |
| 11 | Strategy Timeline | Horas nominales y estados de EA | Timeline con fases, cuenta regresiva y DST |
| 12 | Simulador de decisiones | TP/SL/ATR/riesgo y evaluación IA hipotética | Sensibilidad sistemática y escenarios |
| 13 | ¿Por qué no operó mi EA? | Bloqueos globales y estado de estrategias | Instrumentación por candidato en MQL5 |
| 14 | Autopiloto supervisado | Pausa/activación del EA y asistencia manual | Confirmaciones por entrada, ACK y reconciliación |
| 15 | Hardening para operar en real | Preflight y build automatizado | Auditoría MQL5 e integración demo exhaustiva |
| 16 | Obsidian Gold | Negro grafito, oro mate, responsive y reduced-motion | QA visual y accesibilidad completa |

Los estados de primera entrega no significan que las funciones estén validadas para ejecución real. Las simulaciones no demuestran rentabilidad ni predicción fiable.

## Protocolo obligatorio antes de live

1. Confirmar npm ci y npm run build en CI.
2. QA navegador: desktop, móvil 320px y movimientos reducidos.
3. Verificar que RLS de accounts y live no permite ver cuentas no autorizadas.
4. Confirmar ticket con SL contrario, riesgo insuficiente y cuenta con posiciones sin SL.
5. Verificar contratos, tick value, tamaño de lote y volumen mínimo para brokers distintos.
6. Probar cuentas pequeñas de 5k sin aumentar riesgo de forma silenciosa.
7. Confirmar comisiones, spread, swap, bid/ask y fill en entorno real demo.
8. Probar WebRequest bajo latencia, timeouts, desconexión y reconexión.
9. Evitar ejecución duplicada con claves idempotentes y conciliación deals MT5.
10. Cortar conexión y cerrar la web, verificar guardas críticas en EA.
11. Validar el DD diario con equity flotante y el reset horario de cada bróker.
12. Verificar reglas de FundingPips vigentes según producto, fase y complementos.
13. Probar copiador ante cierre parcial, retrasos, master/follower, fallos y límites.
14. Evaluar IA fuera de muestra con calibración, tamaño de muestra y drift.
15. Comparar replay y backtest con el Strategy Tester MT5 y costes reales.
16. Compilar el EA en MetaEditor, probar operaciones demo y confirmar permisos de usuario.

Reglas: empezar en demo, con automático apagado. No modificar parámetros u operaciones sin un comando explícito y confirmado.

## Datos pendientes

- Motivos estructurados de rechazo por candidato desde MQL5.
- Histórico tick a tick y ejecución real para replay y Shadow persistentes.
- Riesgo consolidado de stops, órdenes y posiciones por cuenta autorizada.
- Base de costes, swaps, slippage y drawdown del proveedor.
- Especificaciones verificadas del programa de fondeo y sus addons.

## Arquitectura

- frontend/src/panels/CommandCenter.tsx — ocho módulos del centro.
- frontend/src/panels/PremiumLab.tsx — simulador, Monte Carlo, shadow y diario.
- frontend/src/premium/CandleReplay.tsx — reproducción histórica.
- frontend/src/premium/risk.ts — exposición y preflight (asesor, no autoridad).
- frontend/src/premium/useSmartAlerts.ts — notificaciones opt-in.
- frontend/src/premium.css — tema Obsidian Gold.
