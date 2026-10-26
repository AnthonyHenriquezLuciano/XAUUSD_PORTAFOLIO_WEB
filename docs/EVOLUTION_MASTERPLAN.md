# XAU Portfolio AI — Programa de evolución por etapas

Auditoría de referencia: 2026-10-26. No representa autorización para activar nuevas órdenes reales.

## Estado observado
- React + Vite, TradingView Lightweight Charts, MT5 EA v6.20 y Supabase.
- Cinco estrategias LM/AORB/TOK/R50/ALB; Flow Studio y perfiles de tick volume OHLC aproximados.
- Base operativa: cerca de 176 mil velas M1 y diez operaciones en la tabla live trades al auditar; insuficientes para inferencia confiable de tasas reales de aprobación.
- Modelos actuales del repositorio: AUC direccional de ganancia ~0.53 según README, cobertura cono de 80% ~79%.
- CI previo comprobaba solo TypeScript, build y dos suites; no ejecutaba en push a main.
- Los comandos remotos pasan por Supabase `commands` y `bridge_sync`; el consumidor ejecuta y responde ACK en la siguiente sincronización. Hay estados ambiguos ante cortes entre ejecución y ACK.
- `WebRequest` del EA es síncrono, timeout 8000 ms y se invoca desde OnTimer junto a Process.
- La interfaz calcula exposición de riesgo en USD con tamaño de contrato simplificado, sin gap/slippage/pending. EA tiene tolerancia de lote mínimo parametrizable (InpMinLotTol por defecto 2.0).
- Auditor Supabase: alertas de funciones `SECURITY DEFINER` (requieren revisión de cada política y finalidad, no todas equivalen a vulnerabilidad), pg_net en public y dos foreign keys sin índice.
- El bridge_sync público valida clave del puente mediante hash SHA-256 y su exposición es una decisión de arquitectura que requiere rate limit/rotación/validación de cargas, no afirmar automáticamente que está desprotegido.

## Etapa 1. Safety Core y confiabilidad
**Objetivo:** eliminar incertidumbre de comandos y costes reales antes de habilitar automatizaciones nuevas.

Entregables:
1. Contrato de comando idempotente con ID inmutable, solicitud, recepción, resultado, conciliación con deals MT5, reintentos seguros y estado `unknown_needs_reconciliation`.
2. Auditoría de cierres/modificaciones/parciales y reconexiones: ninguna orden puede ejecutarse dos veces tras una respuesta de red perdida.
3. Separación del transporte HTTP bloqueante de las tareas de protección de órdenes. Ensayos de latencia y caída de Supabase.
4. Motor central de riesgo, cálculos `OrderCalcProfit`/`OrderCalcMargin` y atributos del símbolo; prohibición explícita de superar un límite duro de riesgo aun con lotaje mínimo.
5. Auditoría RPC/RLS/índices, rotación de bridge keys, rate limits, permisos y bitácora de comandos.
6. Test suites de seguridad y CI en main; test E2E Playwright actualizado para toda la navegación.

**Criterio de salida:** 0 ejecuciones duplicadas en pruebas de fallos, conciliación explícita de 100% de comandos, riesgo validado desde MT5 y ninguna prueba crítica de CI fallida. MT5 demo, nunca fondos reales durante QA.

## Etapa 2. Market Data Lake e instrumentación
**Objetivo:** fuente de datos unificada, reproducible y auditada.

Entregables:
1. Importaciones M1/Bid/Ask/tick opcional sin duplicación; campos de origen, UTC, reloj bróker, desplazamiento histórico, volumen y calidad.
2. Metadatos de cobertura por sesión, anomalías, huecos, cambios DST, costes y spread.
3. Pipeline incremental/caché por cuenta, ventana, temporalidad y snapshot; retención escalonada según recursos.
4. Dataset y versiones inmutables para experimentos: features/labels/estrategia/fill/costos/modelo.
5. Comparativas bróker vs instrumento GC/MGC cuando haya fuente licenciada; no confundir tick volume y volumen negociado.

**Criterio de salida:** eventos temporales trazables, sin datos posteriores a corte histórico, cobertura reportada y consistencia de checksum entre MT5 y web.

## Etapa 3. Institutional Intelligence 2.0
**Objetivo:** chart analítico y explicable sin sobrecarga.

Entregables:
1. Profiles incremental de rango fijo/sesión/composite/developing, nodos, POC migrante, áreas de valor.
2. VWAP anclado y bandas estadísticas, opening drive/range, PDH/PDL/PWH/PWL con DST.
3. FVG/IFVG/BPR, displacement, BOS/CHOCH, barridos, LVN/voids, aceptación y rechazo.
4. Focus Workspace personalizable, inspector al clicar nivel, persistencia cross-device.
5. Versionado de niveles y alerta explicativa "por qué aparece/desaparece".
6. Score por relevancia verificable, sin llamar "probabilidad" a una puntuación heurística.

**Criterio de salida:** benchmark visual/performance y tests de no-lookahead con replay, carga de móvil y estabilidad de cálculos.

## Etapa 4. Portfolio Lab científico
**Objetivo:** medir si las nuevas ideas agregan expectativa neta real.

Entregables:
1. Replay mercado determinista con paso M1 y ticks si están disponibles.
2. Backtesting único con costes/spread/slippage y simulación de fills conservadores; contraste con Strategy Tester MT5.
3. Walk-forward, purged CV, holdout final y análisis de estabilidad de parámetros.
4. Monte Carlo con dependencias entre estrategias, rachas, días de fondeo y escenarios de ruina.
5. Reporte de funnel candidato→filtro→ejecución→cierre por estrategia y sesión.
6. Shadow Trading persistente, completamente separado de cuentas reales.

**Criterio de salida:** mejora neta verificada fuera de muestra, tamaño efectivo de muestra y métricas de incertidumbre publicados; no comparar solo win rate.

## Etapa 5. IA con abstención y predicción por niveles
**Objetivo:** modelos calibrados, no afirmaciones de certeza.

Entregables:
1. Etiquetas triple-barrier/tiempo y probabilidad de tocar un nivel antes del stop y del horizonte.
2. Conformal prediction/calibración por horizonte, reliability diagrams, Brier, ECE y intervalos.
3. Modelos base tabulares y secuenciales como experimentos, con comparación contra baseline sin IA.
4. Abstention y detección out-of-distribution; explicaciones de features, calidad de datos y cambios.
5. Registro de predicciones previas, evaluación prospectiva y drift; feature flags por modelo.

**Criterio de salida:** skill incremental fuera de muestra después de costes, calibración aceptable según tolerancia predefinida y cobertura estable; sin evidencia, "sin ventaja demostrada".

## Etapa 6. Supervised Autopilot y Multi-Account
**Objetivo:** automatización controlada, con protección de fondeo por cuenta y en agregado.

Entregables:
1. Modo Manual / Sugerencia / Confirmación / Auto limitado; ninguna IA puede eludir hard stops EA.
2. Cuentas y copiador idempotentes, riesgos correlacionados, políticas independientes por seguidor.
3. Funding Mission Control parametrizado por producto/fase y reglas verificadas; kill switch local incluso sin internet.
4. Notificaciones persistentes, alertas por umbral, órdenes pendientes de conciliar y razones de rechazo.
5. "Why no trade": evento estructurado por oportunidad desde MQL5, diagnóstico de costes y guardas.
6. Cockpit multimonitor y aplicación escritorio sólo si añade beneficios operativos medibles.

**Criterio de salida:** pruebas de interrupción, duplicación, desfase de bróker, reconexión y reglas por cuenta; rollback ejercitado en demo.

## Reglas transversales de desarrollo
- Una etapa = PR aislados por responsabilidad, CI, QA visual, ensayos de integración y salida controlada.
- Ninguna nueva feature conecta por defecto con operaciones reales.
- Datos y modelos siempre etiquetados por procedencia (tick volume ≠ futuro GC, probabilidad calibrada ≠ heurística).
- Unificación de fechas UTC + offset histórico del bróker; nunca usar offset actual para retrospectiva sin advertirlo.
- Especificaciones MT5 y límite de prop firm gobiernan ejecución, no los widgets del browser.
- Test suite estable y ejecutable en CI; no introducir herramientas con fixtures inexistentes.
- Auditoría de dependencias y actualización planificada de paquetes con changelog/test y rollback.
- Documentar comparación antes/después de cada etapa con datos reproducibles.

## Orden
1. Stage 1 es requisito previo para cambiar estrategias en live.
2. Stage 2 habilita Stage 3/4/5.
3. Stage 4 verifica Stage 3 y la validez estadística de Stage 5.
4. Stage 6 se habilita sólo tras Stage 1 y criterios de Stage 4/5.
