# Institutional Flow · Session Intelligence

## Funciones incorporadas
- Nueva pestaña **Flujo** junto al gráfico de XAUUSD, con panel tipo Obsidian Gold.
- **Perfil por sesión real**: Tokio, Londres, Nueva York y día normalizado EA; permite cambiar de alcance y resolución.
- **Perfil de rango fijo (VP)**: en `Dibujo` utiliza VP y arrastra dos puntos. El tiempo seleccionado se conserva como dibujo por cuenta y se usa para recalcular el perfil.
- **Perfil reciente**: últimas seis horas (con los datos disponibles).
- **POC, VAH/VAL (área de valor 70%), HVN, LVN y VWAP proxy**.
- **PDH/PDL, PWH/PWL**; distancias relativas al cierre disponible.
- **FVG M5 con desplazamiento confirmado**, zonas abiertas o parcialmente mitigadas, sin mirar velas posteriores al corte.
- **Modo Focus**: completo / volumen / FVG / estructura; oculta capas ajenas al análisis cuando estás en Flujo.
- Capas independientes para Profile y FVG; no cambia señales ni reglas del EA.

## Fuente y límites matemáticos
El EA transmite actualmente OHLC y `tick_volume` M1 mediante CopyRates. NO transmite el volumen negociado centralizado de futuros de CME. A partir de la vela M1, el perfil reparte su número de ticks uniformemente dentro del rango OHLC: no se sabe a qué precio ocurrió cada tick.

- El POC, VAH/VAL, HVN/LVN son **aproximados**, y los datos sin actividad no se convierten en volumen artificial.
- VWAP proxy utiliza precio típico HLC/3 × tick_volume. NO es el VWAP de transacciones reales.
- FVG indica una estructura de velas, no evidencia confirmada de órdenes institucionales.
- El corte de consulta está limitado a los datos M1 cerrados disponibles en el frontend, para prevenir filtración de datos futuros.
- El modo sesión usa el desplazamiento de servidor estimado con el último heartbeat para mostrar ventanas reales; si el bróker cambió offset históricamente, perfiles antiguos podrían desplazarse 1 h. Conviene integrar la historia del offset antes de usar el dato en backtesting institucional.
- PWH/PWL son máximos/mínimos de la semana calendario anterior en el reloj de estrategia normalizado, no necesariamente la definición operativa de la bolsa.
- Datos por defecto: últimas 30 jornadas de calendario de M1 en Supabase, sujetos a conservación y disponibilidad del bróker.
- No se muestran probabilidades de alcanzar niveles hasta disponer de muestra y calibración fuera de entrenamiento.

## Compatibilidad Supabase
No precisa migración: el dibujo VP se guarda mediante el tipo SQL admitido `rect` y su subtipo lógico `profile` en `data.kind`; se recupera correctamente al cargar. No afecta RLS ni el esquema.

## Verificación
- `npm run build` comprueba TypeScript y producción Vite.
- `npm run test:sessions` valida horarios reales y DST.
- `npm run test:flow` valida conservación de volumen, 70 % de VA, falta de datos, trazas de FVG, mitigación, rangos e invariantes sin lookahead.

## Pendientes de investigación (no implementados como indicadores reales)
- Profundidad de mercado, volumen negociado real de futuros GC, delta bid/ask agresor y footprint: necesitan datos licenciados o del bróker capaces de soportarlo.
- Backtesting de tasas de llegada a cada nivel, calibración, intervalos Wilson y walk-forward.
- Persistencia de datos tick a tick con cuotas y retención, y versión M1 históricamente consistente del horario MT5.
- Stress test de rendimiento a 30 días con navegador real y comprobaciones MT5 demo en condiciones operativas.
