# XAU Portfolio AI · versión web

Web para operar oro (XAUUSD) en MetaTrader 5 desde el navegador (PC o móvil), con:

- **Portafolio automático** de 5 estrategias (LM, AORB, TOK, R50, ALB) con las reglas de FundingPips. Lo ejecuta el **EA puente** dentro de tu MT5, así que sigue operando aunque cierres la web.
- **Gráfico en vivo**: compra y venta en un clic, **SL/TP que se arrastran** (ratón y dedo), BE, cierre parcial y cierre total.
- **IA** (se calcula en tu navegador con las velas de tu bróker):
  - probabilidad de TP / SL / cierre por tiempo de cada entrada;
  - cono de rango probable a 1–8 h;
  - historial de cada estrategia en el escenario actual.
- **Señales**: régimen, volatilidad, sesión, niveles clave y qué conviene hacer.
- **Diario evaluado**: cada operación cerrada recibe una nota (0–100) y un veredicto: «buena entrada» o «debiste esperar».
- **Chat con Claude** que conoce tu cuenta, tus operaciones y tu estrategia manual. Usa tu API key; las reglas que le explicas se guardan como notas.
- **Backtest** del portafolio con las velas reales de tu bróker. Permite probar otros parámetros o una estrategia nueva, por ejemplo traducida de un `.mq5` con ayuda de la IA.
- **Cuentas compartidas**: invitas a quien quieras por correo, con acceso de «solo ver» o «puede operar».

## Cómo funciona

```
MT5 + EA puente  ──(cada 1 s, HTTPS)──►  Supabase (base de datos, tiempo real, chat)  ◄──►  Web (Vercel)
   ejecuta las 5 estrategias                 velas, cuenta, diario, órdenes, ajustes          gráfico, IA, señales
   y las órdenes de la web
```

Las piezas:

- **EA puente** (`mt5/XAU_Portfolio_Bridge_v6.mq5`): es el EA v5 con un módulo añadido.
  - Cada segundo envía precio, cuenta, posiciones, estado de las estrategias, velas M1 cerradas, operaciones y registro.
  - Recibe las órdenes y los ajustes de la web.
  - Solo ejecuta órdenes con menos de 20 s de antigüedad.
  - Valida el SL y respeta las guardas de fondeo y la regla de no cobertura.
- **Supabase**, proyecto `neqfafcelxgcxroicmer`:
  - Postgres con reglas RLS: cada persona ve solo sus cuentas y las compartidas con ella.
  - Tiempo real para precio, estado, órdenes y diario.
  - Función `chat`, que usa tu API key de Anthropic guardada en el servidor. El navegador no puede leer la key.
- **Web** (`frontend/`): React + TradingView Lightweight Charts. La IA (árboles exportados del modelo entrenado, tablas del cono y estadísticas por escenario) va en `public/ai/models.json`.

## Puesta en marcha

### 1. Publicar la web en Vercel (una vez, ~5 min)

1. El código ya está en GitHub: `AnthonyHenriquezLuciano/XAUUSD_PORTAFOLIO_WEB`.
2. En [vercel.com](https://vercel.com) entra con tu cuenta de GitHub: «Add New → Project» y elige el repositorio **XAUUSD_PORTAFOLIO_WEB**.
3. No cambies nada: `vercel.json` ya indica cómo construirla. Pulsa **Deploy**.
4. Apunta la dirección que te da, por ejemplo `https://xau-portfolio.vercel.app`.

### 2. Ajustes de acceso en Supabase (una vez)

En [supabase.com](https://supabase.com) → tu proyecto (ref. `neqfafcelxgcxroicmer`) → Authentication:

1. **URL Configuration**:
   - Site URL = la dirección de Vercel.
   - En «Redirect URLs» añade esa misma dirección.
   - Así los enlaces de confirmación y de nueva contraseña vuelven a tu web.
2. **Correos**. Deja activada la confirmación de correo, porque es lo que impide que alguien use el correo de un invitado. El remitente gratuito de Supabase tiene un límite muy bajo de correos por hora y puede no entregar a direcciones externas. Para invitar a otras personas:
   - Configura un SMTP propio en Authentication → Emails → SMTP Settings. Por ejemplo [Resend](https://resend.com), que es gratis hasta cierto volumen.
   - O pídeme que confirme manualmente a esa persona.

### 3. Crear tu cuenta y conectar MT5

1. Abre la web → **Crear cuenta** con tu correo → confirma el enlace → entra.
2. **Nueva cuenta**: ponle un nombre, por ejemplo «FundingPips 100k F1». Se abren los pasos de conexión:
   1. Descarga `XAU_Portfolio_Bridge_v6.mq5` y cópialo en MT5 → Archivo → Abrir carpeta de datos → `MQL5/Experts`. Ábrelo en MetaEditor y pulsa **Compilar (F7)**.
   2. En MT5 ve a Herramientas → Opciones → Asesores expertos → «Permitir WebRequest para las URL listadas» y añade `https://neqfafcelxgcxroicmer.supabase.co`.
   3. **Generar clave** en la web y cópiala. Solo se muestra una vez.
   4. Arrastra el EA a un gráfico de XAUUSD y rellena las entradas:
      - `InpBridgeKey` = la clave;
      - `InpInitialBalance` = el balance inicial de la cuenta de fondeo;
      - `InpTargetPct` = 8 en fase 1, 5 en fase 2, 0 si ya está fondeada;
      - `InpAutoTrade` = false.
      Activa **Algo Trading**.
3. En segundos la cuenta aparece como «EA conectado». El EA sube hasta 180 días de velas M1, lo que tarda unos minutos.
4. Cuando lo hayas revisado, activa **Automático ON** en la barra superior.

> **Importante:** no pongas el EA v5 y el v6 a la vez en la misma cuenta. Usan los mismos magic numbers. El v6 sustituye al v5.

### 4. Compartir

En Cuentas → **Compartir**, escribe el correo de la persona y elige «Solo ver» o «Puede operar». La persona crea su cuenta en la web con ese correo y la cuenta le aparece al entrar.

## Seguridad

- **Clave del EA**:
  - Son 192 bits aleatorios.
  - En la base de datos solo se guarda su hash SHA-256.
  - Con ella solo se puede sincronizar esa cuenta. Si se filtra, genera otra.
- **Permisos**:
  - Todas las tablas tienen RLS.
  - «Solo ver» no puede enviar órdenes ni cambiar ajustes.
  - Solo el propietario genera claves y comparte.
  - Se probó con usuarios reales de prueba en la base de datos y después se borraron.
- **API key de Anthropic**: se guarda en el servidor y el navegador no puede leerla. Solo la usa la función `chat`.
- **La web**:
  - Lleva una cabecera CSP que solo permite conectar con tu proyecto de Supabase, y no se puede incrustar en otras páginas.
  - El código MQ5 que pegues nunca se ejecuta: solo se envía a Claude para analizarlo.

## Qué se ha comprobado y qué no

Lo que se ha comprobado:

- **Base de datos**: se ejecutó contra el Supabase real:
  - el ciclo completo del EA (estado, velas, operaciones, órdenes, confirmaciones, caducidad a 20 s, ajustes);
  - las reglas RLS;
  - que el estado lento no se reescribe si no cambia (ahorra tiempo real).
- **IA en el navegador**: da resultados idénticos a Python.
  - Variables: error 0 en 108 puntos.
  - Probabilidades: diferencia < 0,000001.
  - La ventana de 15 días más la tabla diaria da las mismas variables que el histórico completo.
- **Backtest en el navegador**: coincide **operación a operación** con el de Python. Sobre 5 meses de M1 da 359/359 operaciones idénticas sin reglas de fondeo y 151/151 con ellas.
- **Web completa**: se probó con Playwright contra un Supabase simulado (REST, auth, tiempo real y chat) y un EA simulado, en escritorio y móvil, con la CSP de producción. Pasaron los 14 pasos, sin errores de consola:
  - entrar, abrir la cuenta, señales y predicción;
  - preparar la orden con probabilidades, enviarla, BE y arrastrar el TP;
  - diario evaluado, ajustes, Automático ON, chat con nota guardada y backtest.

Lo que no se ha podido probar:

- **El EA no se ha compilado**: aquí no hay MetaEditor. Se revisó a mano, con comprobación automática de llaves, variables declaradas y funciones duplicadas. Si MetaEditor da un error, pásame el texto exacto.
- **No se ha probado contra un MT5 real**. Empieza en una **cuenta demo**, mira la pestaña Expertos de MT5 y el registro de la web.
- **El chat no se ha probado con una key real de Anthropic**: el entorno de pruebas no tiene acceso a Internet. La función está desplegada y responde con mensajes claros si la key falta o no es válida.

## Qué esperar de la IA (medido fuera de muestra)

- **Probabilidades de una entrada**:
  - son un 4,9 % mejores que usar solo el SL, el TP y el horizonte;
  - **no adivinan la dirección**: el AUC de terminar en ganancia es ~0,53.
- **Cono de predicción**: el rango del 80 % contuvo el precio ~79 % de las veces. La dirección acierta ~50 %.
- **Historial por escenario**: es el resultado real del backtest 2024-2026, suavizado cuando hay pocos casos.

Esto no es asesoramiento financiero. Revisa las reglas vigentes de FundingPips (noticias, días mínimos, consistencia).

## Plan gratuito de Supabase

- La web solo se suscribe a filas pequeñas (precio y equity cada segundo), y el estado completo solo se envía cuando cambia.
- Con una pestaña abierta todo el día el consumo es moderado. Cierra la web cuando no la uses: el EA sigue operando igual.
- Las velas se guardan en la base de datos, unas 1.400 filas por día. Para años de histórico conviene el plan Pro.

## Estructura

```
vercel.json                  cómo construir y publicar la web
frontend/                    la web (React + Vite)
  src/cloud/engine.ts        cuenta real: Supabase, órdenes al EA, IA en el navegador
  src/demo/                  simulador con días reales de oro
  src/ai/                    velas, variables, modelo, señales, evaluación y backtest
  public/ai/models.json      IA exportada
  public/ea/                 EA para descargar desde la web
  test/                      pruebas (validación de la IA, backtest y extremo a extremo)
supabase/migrations/         esquema, reglas RLS y funciones (ya aplicadas en el proyecto)
supabase/functions/chat/     función del chat (ya desplegada)
mt5/XAU_Portfolio_Bridge_v6.mq5   EA puente
tools/export_models.py       exporta la IA entrenada a JSON
```

Desarrollo local: `cd frontend && npm ci && npm run dev`.
