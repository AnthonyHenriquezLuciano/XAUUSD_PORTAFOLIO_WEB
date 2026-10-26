//+------------------------------------------------------------------+
//|                                    XAU_Portfolio_Bridge_v6.mq5   |
//|  Cartera intradía XAUUSD con 5 estrategias:                       |
//|   1) R50  – Ruptura de números redondos ($50) desde 01:05         |
//|   2) TOK  – Ruptura del rango de Tokio 03:00-03:30                |
//|   3) AORB – Ruptura del rango asiático 03:30-04:30                |
//|   4) ALB  – Ruptura en Londres del rango de Asia 01:05-09:00      |
//|   5) LM   – Momentum Asia -> Londres (09:30)                      |
//|  Riesgo global igual para todas las estrategias, sobre un balance  |
//|  base que (opcional) se actualiza cada +2% / -1%.                 |
//|  Cierre por tiempo activable/desactivable de forma global.        |
//|  Guardas de fondeo (FundingPips): 3% diario, 10% máximo estático, |
//|  sin coberturas (nunca abre una posición contraria a otra abierta)|
//|  Horas = hora del SERVIDOR (GMT+2 invierno / GMT+3 verano,        |
//|  reapertura diaria del oro a las 01:00).                          |
//|  v6: puente con la web XAU Portfolio AI (Supabase): envía precio, |
//|  velas, cuenta y operaciones; ejecuta órdenes y ajustes de la web.|
//+------------------------------------------------------------------+
#property copyright   "Anthony Henriquez"
#property version     "6.00"
#property description "Portafolio XAUUSD (R50, TOK, AORB, ALB, LM) con guardas FundingPips y puente con la web XAU Portfolio AI: la web muestra la cuenta y envía órdenes; el portafolio opera aquí."

#include <Trade/Trade.mqh>

//==================================================================
// ENTRADAS
//==================================================================
input group "=== Conexión con la web XAU Portfolio AI ==="
input bool   InpWebEnable      = true;     // Conectar con la web
input string InpBridgeKey      = "";       // Clave de la cuenta (la web la muestra en Cuenta → Conectar EA)
input string InpWebURL         = "https://neqfafcelxgcxroicmer.supabase.co";   // Dirección del servidor (añádela en Opciones → Asesores expertos → WebRequest)
input string InpWebAnonKey     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lcWZhZmNlbHhnY3hyb2ljbWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4NzQzMTksImV4cCI6MjEwODQ1MDMxOX0.vXL1CxSMtno5ynotmSramelv7hXEaN0oQ8NmGC9eWZo"; // Clave pública del servidor (no tocar)
input int    InpSyncMs         = 1000;     // Cada cuánto se sincroniza con la web (ms)
input int    InpWebHistoryDays = 180;      // Días de velas M1 que se envían a la web al conectar
input bool   InpAutoTrade      = false;    // Portafolio automático al arrancar (la web puede activarlo o desactivarlo)
input bool   InpNoHedge        = true;     // Órdenes manuales: no abrir en sentido contrario a otra posición (FundingPips)

input group "=== General ==="
input long   InpMagic          = 2610200;  // Magic base (LM +1, AORB +2, TOK +3, R50 +4, ALB +5) — igual que v2/v3
input double InpRiskPct        = 0.30;     // Riesgo % por operación, igual para todas las estrategias
input double InpMinLotTol      = 2.0;      // Cuentas pequeñas: usar el lote mínimo si su riesgo no pasa de x veces el previsto (1 = nunca)
input bool   InpCompound       = true;     // Interés compuesto escalonado: el balance base se actualiza con los pasos de abajo
input double InpCompoundUpPct  = 2.0;      // +x% de ganancia sobre el balance base -> nuevo balance base
input double InpCompoundDnPct  = 1.0;      // -x% de pérdida sobre el balance base -> nuevo balance base
input int    InpMaxOpenTrades  = 4;        // Máximo de operaciones abiertas a la vez entre todas las estrategias (0 = sin límite)
input bool   InpUseTimeExit    = true;     // Cerrar las operaciones a la hora de cierre de cada estrategia
input double InpNoTimeExitTP_R = 3.0;      // Sin cierre por tiempo: TP (en R) para estrategias configuradas sin TP
input double InpInitialBalance = 0;        // Balance inicial de la cuenta de fondeo (obligatorio en real la 1ª vez)
input bool   InpDDThrottle     = true;     // Reducir riesgo al acercarse al DD máximo
input double InpThrottleMin    = 0.30;     // Factor mínimo de riesgo con el freno de DD
input double InpMaxSpreadUSD   = 0.80;     // Spread máximo para entrar (en precio, $/oz)
input int    InpSlippagePts    = 30;       // Desviación máxima (puntos)
input int    InpATRPeriod      = 14;       // Periodo ATR diario (calculado por día de estrategia)

input group "=== Estrategia 1: Momentum Asia -> Londres (LM) ==="
input bool   InpLM_Enable        = true;
input string InpLM_OpenTime      = "01:05"; // Precio de referencia (apertura de Asia)
input string InpLM_EntryTime     = "09:30"; // Hora de entrada
input int    InpLM_EntryWindowMin= 5;       // Minutos de tolerancia para entrar
input double InpLM_SL_ATR        = 0.50;    // SL = x * ATR(D1)
input double InpLM_TP_R          = 3.0;     // TP en múltiplos de R (0 = sin TP)
input string InpLM_ExitTime      = "21:00"; // Cierre por tiempo

input group "=== Estrategia 2: Ruptura rango asiático (AORB) ==="
input bool   InpAO_Enable     = true;
input string InpAO_RangeStart = "03:30";   // Inicio del rango
input string InpAO_RangeEnd   = "04:30";   // Fin del rango (desde aquí se buscan rupturas)
input double InpAO_SL_ATR     = 0.25;      // SL = x * ATR(D1)
input double InpAO_TP_R       = 3.0;       // TP en múltiplos de R (0 = sin TP)
input string InpAO_ExitTime   = "23:30";   // Cierre por tiempo y fin de búsqueda de rupturas

input group "=== Estrategia 3: Ruptura rango de Tokio (TOK) ==="
input bool   InpTK_Enable     = true;
input string InpTK_RangeStart = "03:00";   // Inicio del rango
input string InpTK_RangeEnd   = "03:30";   // Fin del rango (desde aquí se buscan rupturas)
input double InpTK_SL_ATR     = 0.25;      // SL = x * ATR(D1)
input double InpTK_TP_R       = 2.0;       // TP en múltiplos de R (0 = sin TP)
input string InpTK_ExitTime   = "23:30";   // Cierre por tiempo y fin de búsqueda de rupturas

input group "=== Estrategia 4: Ruptura de números redondos (R50) ==="
input bool   InpR50_Enable    = true;
input string InpR50_RefTime   = "01:05";   // Precio de referencia: niveles redondos por encima y por debajo
input double InpR50_Step      = 50.0;      // Paso de los niveles redondos ($)
input double InpR50_BufATR    = 0.03;      // La ruptura se confirma x * ATR más allá del nivel
input string InpR50_FillEnd   = "20:00";   // Hasta esta hora se buscan rupturas
input double InpR50_SL_ATR    = 0.15;      // SL = x * ATR(D1)
input double InpR50_TP_R      = 0.0;       // TP en múltiplos de R (0 = sin TP, cierre por tiempo)
input string InpR50_ExitTime  = "23:30";   // Cierre por tiempo

input group "=== Estrategia 5: Ruptura en Londres del rango de Asia (ALB) ==="
input bool   InpAL_Enable     = true;
input string InpAL_RangeStart = "01:05";   // Inicio del rango de Asia
input string InpAL_RangeEnd   = "09:00";   // Fin del rango (desde aquí se buscan rupturas)
input string InpAL_FillEnd    = "18:00";   // Hasta esta hora se buscan rupturas
input double InpAL_SL_ATR     = 0.25;      // SL = x * ATR(D1)
input double InpAL_TP_R       = 2.0;       // TP en múltiplos de R (0 = sin TP)
input string InpAL_ExitTime   = "23:30";   // Cierre por tiempo

input group "=== Guardas de fondeo (FundingPips) ==="
input double InpDailyGuardPct = 2.5;   // Cierra todo y para el día al perder x% (límite real 3%)
input double InpMaxLossPct    = 10.0;  // DD máximo estático de la cuenta
input double InpMaxGuardPct   = 9.0;   // Cierra todo y bloquea al perder x% del balance inicial
input double InpTargetPct     = 0.0;   // Objetivo de fase: 8 (F1), 5 (F2), 0 = fondeada
input int    InpResetId       = 0;     // Poner un número NUEVO para borrar bloqueos una sola vez (nueva cuenta / fase)

input group "=== Horario ==="
input int      InpServerShiftMin = 0;                      // Minutos que tu servidor va por delante del horario GMT+2/+3
input bool     InpHistShift      = true;                   // Corregir historial del bróker desplazado +1h (solo backtest)
input datetime InpHistShiftEnd   = D'2025.03.09 00:00';    // Fecha hasta la que el historial está desplazado
input int      InpHistShiftMin   = 60;                     // Minutos de desplazamiento del historial

//==================================================================
// ESTADO
//==================================================================
#define RES_RETRY 0
#define RES_DONE  1
#define RES_WAIT  2   // spread alto o mercado cerrado: esperar sin contar intento

struct OrbState
  {
   bool   enabled;
   string name;
   long   magic;
   int    start, end, fillEnd, exitM;
   bool   needInside;   // el día se omite si al empezar la ventana el precio ya está fuera del rango
   double slAtr, tpR;
   bool   ready, done;
   int    tries;
   double hi, lo;
  };

CTrade   trade;
datetime g_nextClose = 0;   // pausa entre reintentos de cierre fallidos
long     g_magicLM = 0;
double   g_initBal = 0;

int      m_lmOpen, m_lmEntry, m_lmExit;
OrbState g_ao, g_tk, g_al;

long     g_magicR5 = 0;
int      m_r5Ref, m_r5FillEnd, m_r5Exit;
bool     g_r5Ready = false, g_r5Done = false;
int      g_r5Tries = 0;
double   g_r5Up = 0.0, g_r5Dn = 0.0;

datetime g_dayN   = 0;      // inicio del día de estrategia (hora normalizada)
double   g_lmRef  = 0;
bool     g_lmDone = false;
int      g_lmTries = 0;

datetime g_calcDay = 0;     // día para el que está calculado el ATR
double   g_atr     = 0.0;
double   g_riskBase = 0.0;  // balance sobre el que se calcula el riesgo

datetime g_srvDay = 0;      // día del servidor para la guarda diaria
double   g_dayRef = 0;
bool     g_dailyBlocked = false;
bool     g_permBlocked  = false;
bool     g_targetHit    = false;

string   g_gvInit, g_gvPerm, g_gvTarget, g_gvDayKey, g_gvDayRef, g_gvRiskBase;

// ajustes que se pueden cambiar desde la web sin reiniciar el EA (empiezan con el valor de las entradas)
double   g_riskPct = 0.30;
int      g_maxOpen = 4;
bool     g_useTimeExit = true;
bool     g_compound = true;
double   g_dailyGuardPct = 2.5;
double   g_maxGuardPct = 9.0;
double   g_targetPct = 0.0;
bool     g_lmEnable = true;
bool     g_r5Enable = true;
bool     g_autotrade = false;


//==================================================================
// PUENTE CON LA WEB (Supabase)
// Cada InpSyncMs el EA envía a la web: precio, cuenta, posiciones, órdenes, estado de las estrategias,
// velas M1 cerradas, operaciones y registro. La respuesta trae las órdenes enviadas desde la web y los ajustes.
// Una orden de la web solo se ejecuta si tiene menos de 20 s (lo garantiza el servidor).
//==================================================================
enum JType { J_NULL, J_BOOL, J_NUM, J_STR, J_ARR, J_OBJ };

ushort HexCode(const string h)
  {
   int v = 0;
   for(int i = 0; i < StringLen(h); i++)
     {
      ushort c = StringGetCharacter(h, i);
      int d = 0;
      if(c >= '0' && c <= '9') d = c - '0';
      else if(c >= 'a' && c <= 'f') d = c - 'a' + 10;
      else if(c >= 'A' && c <= 'F') d = c - 'A' + 10;
      v = v * 16 + d;
     }
   return (ushort)v;
  }

class JNode
  {
public:
   JType             type;
   double            num;
   bool              b;
   string            str;
   string            keys[];
   JNode            *kids[];
                     JNode(void) { type = J_NULL; num = 0.0; b = false; str = ""; }
                    ~JNode(void)
     {
      for(int i = 0; i < ArraySize(kids); i++)
         if(CheckPointer(kids[i]) == POINTER_DYNAMIC)
            delete kids[i];
     }
   int               Size(void) { return ArraySize(kids); }
   JNode            *At(const int i) { if(i >= 0 && i < ArraySize(kids)) return kids[i]; return NULL; }
   JNode            *Get(const string k)
     {
      for(int i = 0; i < ArraySize(keys); i++)
         if(keys[i] == k)
            return kids[i];
      return NULL;
     }
   void              Add(const string k, JNode *n)
     {
      int s = ArraySize(kids);
      ArrayResize(kids, s + 1);
      ArrayResize(keys, s + 1);
      kids[s] = n;
      keys[s] = k;
     }
  };

class JParser
  {
private:
   string            m_s;
   int               m_p;
   int               m_n;
   ushort            Ch(void) { if(m_p < m_n) return StringGetCharacter(m_s, m_p); return 0; }
   void              Ws(void)
     {
      while(m_p < m_n)
        {
         ushort c = StringGetCharacter(m_s, m_p);
         if(c == ' ' || c == '\t' || c == '\n' || c == '\r') m_p++;
         else break;
        }
     }
   string            Str(void)
     {
      string out = "";
      m_p++;   // comilla inicial
      while(m_p < m_n)
        {
         ushort c = StringGetCharacter(m_s, m_p);
         m_p++;
         if(c == '"') break;
         if(c == '\\' && m_p < m_n)
           {
            ushort e = StringGetCharacter(m_s, m_p);
            m_p++;
            if(e == 'n') out += "\n";
            else if(e == 't') out += "\t";
            else if(e == 'r') out += "\r";
            else if(e == 'b' || e == 'f') out += " ";
            else if(e == 'u' && m_p + 4 <= m_n)
              {
               ushort code = HexCode(StringSubstr(m_s, m_p, 4));
               m_p += 4;
               out += ShortToString(code);
              }
            else out += ShortToString(e);
            continue;
           }
         out += ShortToString(c);
        }
      return out;
     }
   JNode            *Value(void)
     {
      Ws();
      JNode *node = new JNode();
      ushort c = Ch();
      if(c == '{')
        {
         node.type = J_OBJ;
         m_p++;
         Ws();
         if(Ch() == '}') { m_p++; return node; }
         while(m_p < m_n)
           {
            Ws();
            if(Ch() != '"') break;
            string k = Str();
            Ws();
            if(Ch() != ':') break;
            m_p++;
            JNode *v = Value();
            node.Add(k, v);
            Ws();
            ushort d = Ch();
            m_p++;
            if(d == '}') break;
            if(d != ',') break;
           }
         return node;
        }
      if(c == '[')
        {
         node.type = J_ARR;
         m_p++;
         Ws();
         if(Ch() == ']') { m_p++; return node; }
         while(m_p < m_n)
           {
            JNode *v = Value();
            node.Add("", v);
            Ws();
            ushort d = Ch();
            m_p++;
            if(d == ']') break;
            if(d != ',') break;
           }
         return node;
        }
      if(c == '"') { node.type = J_STR; node.str = Str(); return node; }
      if(StringSubstr(m_s, m_p, 4) == "true")  { node.type = J_BOOL; node.b = true;  m_p += 4; return node; }
      if(StringSubstr(m_s, m_p, 5) == "false") { node.type = J_BOOL; node.b = false; m_p += 5; return node; }
      if(StringSubstr(m_s, m_p, 4) == "null")  { node.type = J_NULL; m_p += 4; return node; }
      int start = m_p;
      while(m_p < m_n)
        {
         ushort d = StringGetCharacter(m_s, m_p);
         if((d >= '0' && d <= '9') || d == '-' || d == '+' || d == '.' || d == 'e' || d == 'E') m_p++;
         else break;
        }
      if(m_p > start) { node.type = J_NUM; node.num = StringToDouble(StringSubstr(m_s, start, m_p - start)); }
      else m_p++;   // carácter inesperado: se salta
      return node;
     }
public:
   JNode            *Parse(const string text) { m_s = text; m_p = 0; m_n = StringLen(text); return Value(); }
  };

double JNum(JNode *o, const string k, const double def)
  {
   if(o == NULL) return def;
   JNode *n = o.Get(k);
   if(n == NULL) return def;
   if(n.type == J_NUM)  return n.num;
   if(n.type == J_BOOL) return n.b ? 1.0 : 0.0;
   if(n.type == J_STR && n.str != "") return StringToDouble(n.str);
   return def;
  }

bool JHas(JNode *o, const string k)
  {
   if(o == NULL) return false;
   JNode *n = o.Get(k);
   return (n != NULL && n.type != J_NULL);
  }

bool JBool(JNode *o, const string k, const bool def)
  {
   if(o == NULL) return def;
   JNode *n = o.Get(k);
   if(n == NULL) return def;
   if(n.type == J_BOOL) return n.b;
   if(n.type == J_NUM)  return n.num != 0.0;
   if(n.type == J_STR)  return (n.str == "true" || n.str == "1");
   return def;
  }

string JStr(JNode *o, const string k, const string def)
  {
   if(o == NULL) return def;
   JNode *n = o.Get(k);
   if(n == NULL) return def;
   if(n.type == J_STR) return n.str;
   if(n.type == J_NUM) return DoubleToString(n.num, 8);
   return def;
  }

// ---------------------------------------------------------------- escritura JSON
string JS(const string v)
  {
   string s = v;
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\n", " ");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\t", " ");
   return "\"" + s + "\"";
  }

string JD(const double v, const int digits)
  {
   if(!MathIsValidNumber(v)) return "null";
   return DoubleToString(v, digits);
  }

string JP(const double v) { return JD(v, _Digits); }               // precio
string JPn(const double v) { return (v > 0) ? JD(v, _Digits) : "null"; }   // precio o null
string JB(const bool v) { return v ? "true" : "false"; }
string JI(const long v) { return IntegerToString(v); }

// ---------------------------------------------------------------- estado del puente
string   g_logQ[];
string   g_ackQ[];
string   g_tradeQ[];
string   g_inflight[];        // cierres enviados en esta sincronización (se reenvían si falla)
long     g_backfill[];
long     g_openTk[];
long     g_closedPending[];
int      g_closedTries[];
long     g_lastBarSrv = -1;      // última vela que tiene la web (-1 = aún no se sabe)
long     g_settingsTs = 0;
datetime g_lastSyncOk = 0;
uint     g_lastSyncMs = 0;
int      g_syncErrors = 0;
string   g_bridgeStatus = "sin conectar";
bool     g_backfillQueued = false;
long     g_lastTickMsc = 0;
datetime g_lastTickLocal = 0;
datetime g_lastErrLog = 0;

void Log(const string msg, const string level = "info")
  {
   Print(msg);
   if(!InpWebEnable) return;
   int n = ArraySize(g_logQ);
   if(n >= 200) return;
   ArrayResize(g_logQ, n + 1);
   g_logQ[n] = "{\"level\":" + JS(level) + ",\"msg\":" + JS(msg) + "}";
  }

void PushStr(string &arr[], const string v)
  {
   int n = ArraySize(arr);
   ArrayResize(arr, n + 1);
   arr[n] = v;
  }

void PushLong(long &arr[], const long v)
  {
   int n = ArraySize(arr);
   ArrayResize(arr, n + 1);
   arr[n] = v;
  }

bool HasLong(const long &arr[], const long v)
  {
   for(int i = 0; i < ArraySize(arr); i++)
      if(arr[i] == v) return true;
   return false;
  }

string Joined(const string &arr[], const int maxItems)
  {
   string out = "";
   int n = MathMin(ArraySize(arr), maxItems);
   for(int i = 0; i < n; i++) { if(i > 0) out += ","; out += arr[i]; }
   return out;
  }

void DropFirst(string &arr[], const int k)
  {
   int n = ArraySize(arr);
   if(k >= n) { ArrayResize(arr, 0); return; }
   for(int i = k; i < n; i++) arr[i - k] = arr[i];
   ArrayResize(arr, n - k);
  }

string StratName(const long magic)
  {
   if(magic == g_magicLM)  return "LM";
   if(magic == g_ao.magic) return "AORB";
   if(magic == g_tk.magic) return "TOK";
   if(magic == g_magicR5)  return "R50";
   if(magic == g_al.magic) return "ALB";
   if(magic == InpMagic)   return "MANUAL";
   if(magic == 0)          return "MT5";
   return "EA " + IntegerToString(magic);
  }

string SourceOf(const long magic)
  {
   if(IsOurMagic(magic)) return "estrategia";
   if(magic == InpMagic || magic == 0) return "manual";
   return "otro EA";
  }

// ---------------------------------------------------------------- operaciones para el diario
string OpenTradeJson(const ulong tk)
  {
   if(!PositionSelectByTicket(tk)) return "";
   long magic = PositionGetInteger(POSITION_MAGIC);
   int side = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 1 : -1;
   double sl = PositionGetDouble(POSITION_SL), tp = PositionGetDouble(POSITION_TP);
   return "{\"ticket\":" + JI(PositionGetInteger(POSITION_IDENTIFIER)) + ",\"source\":" + JS(SourceOf(magic)) + ",\"strategy\":" + JS(StratName(magic)) +
          ",\"magic\":" + JI(magic) + ",\"side\":" + IntegerToString(side) +
          ",\"lots\":" + JD(PositionGetDouble(POSITION_VOLUME), 2) + ",\"entry\":" + JP(PositionGetDouble(POSITION_PRICE_OPEN)) +
          ",\"sl0\":" + JPn(sl) + ",\"tp0\":" + JPn(tp) + ",\"sl\":" + JPn(sl) + ",\"tp\":" + JPn(tp) +
          ",\"t_open\":" + JI((long)PositionGetInteger(POSITION_TIME)) + ",\"status\":\"abierta\"}";
  }

// Operación cerrada a partir del historial. Devuelve "" si el historial aún no tiene el cierre.
string ClosedTradeJson(const long posId)
  {
   if(!HistorySelectByPosition(posId)) return "";
   int n = HistoryDealsTotal();
   double inVol = 0, inPx = 0, outVol = 0, outPx = 0, pnl = 0, sl0 = 0, tp0 = 0;
   long magic = 0, tOpen = 0, tClose = 0, reason = -1;
   int side = 0;
   string sym = "";
   for(int i = 0; i < n; i++)
     {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      long type  = HistoryDealGetInteger(d, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
      double vol = HistoryDealGetDouble(d, DEAL_VOLUME), px = HistoryDealGetDouble(d, DEAL_PRICE);
      pnl += HistoryDealGetDouble(d, DEAL_PROFIT) + HistoryDealGetDouble(d, DEAL_COMMISSION) + HistoryDealGetDouble(d, DEAL_SWAP)
             + HistoryDealGetDouble(d, DEAL_FEE);
      sym = HistoryDealGetString(d, DEAL_SYMBOL);
      if(entry == DEAL_ENTRY_IN)
        {
         inVol += vol; inPx += px * vol;
         magic = HistoryDealGetInteger(d, DEAL_MAGIC);
         if(tOpen == 0) tOpen = HistoryDealGetInteger(d, DEAL_TIME);
         side = (type == DEAL_TYPE_BUY) ? 1 : -1;
         ulong ord = (ulong)HistoryDealGetInteger(d, DEAL_ORDER);
         if(ord > 0)
           {
            sl0 = HistoryOrderGetDouble(ord, ORDER_SL);   // HistorySelectByPosition ya cargó las órdenes de la posición
            tp0 = HistoryOrderGetDouble(ord, ORDER_TP);
           }
        }
      else if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY || entry == DEAL_ENTRY_INOUT)
        {
         outVol += vol; outPx += px * vol;
         tClose = HistoryDealGetInteger(d, DEAL_TIME);
         reason = HistoryDealGetInteger(d, DEAL_REASON);
        }
     }
   if(inVol <= 0 || outVol <= 0 || side == 0) return "";
   if(sym != _Symbol) return "skip";
   double entryPx = inPx / inVol, exitPx = outPx / outVol;
   string why = "CIERRE";
   if(reason == DEAL_REASON_SL) why = "SL";
   else if(reason == DEAL_REASON_TP) why = "TP";
   else if(reason == DEAL_REASON_SO) why = "STOP OUT";
   else if(reason == DEAL_REASON_EXPERT) why = (IsOurMagic(magic) ? "TIEMPO/EA" : "EA");
   else if(reason == DEAL_REASON_CLIENT || reason == DEAL_REASON_MOBILE || reason == DEAL_REASON_WEB) why = "MANUAL";
   string r = "null";
   if(sl0 > 0 && MathAbs(entryPx - sl0) > 0) r = JD((exitPx - entryPx) * side / MathAbs(entryPx - sl0), 3);
   return "{\"ticket\":" + JI(posId) + ",\"source\":" + JS(SourceOf(magic)) + ",\"strategy\":" + JS(StratName(magic)) +
          ",\"magic\":" + JI(magic) + ",\"side\":" + IntegerToString(side) + ",\"lots\":" + JD(inVol, 2) +
          ",\"entry\":" + JP(entryPx) + ",\"sl0\":" + JPn(sl0) + ",\"tp0\":" + JPn(tp0) +
          ",\"t_open\":" + JI(tOpen) + ",\"exit\":" + JP(exitPx) + ",\"t_close\":" + JI(tClose) +
          ",\"pnl\":" + JD(pnl, 2) + ",\"r\":" + r + ",\"reason\":" + JS(why) + ",\"status\":\"cerrada\"}";
  }

void QueueBackfill(const int days)
  {
   datetime now = TimeCurrent();
   if(!HistorySelect(now - days * 86400, now + 86400)) return;
   int n = HistoryDealsTotal();
   for(int i = 0; i < n; i++)
     {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      if(HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol) continue;
      long entry = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY) continue;
      long pid = HistoryDealGetInteger(d, DEAL_POSITION_ID);
      if(pid > 0 && !HasLong(g_backfill, pid) && ArraySize(g_backfill) < 500) PushLong(g_backfill, pid);
     }
  }

// Posiciones del símbolo ahora; detecta las que se han cerrado desde la última sincronización.
string TradesJson()
  {
   string parts[];
   long now[];
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0 || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      PushLong(now, (long)PositionGetInteger(POSITION_IDENTIFIER));
      string j = OpenTradeJson(tk);
      if(j != "") PushStr(parts, j);
     }
   for(int i = 0; i < ArraySize(g_openTk); i++)
      if(!HasLong(now, g_openTk[i]) && !HasLong(g_closedPending, g_openTk[i]))
        {
         PushLong(g_closedPending, g_openTk[i]);
         int k = ArraySize(g_closedTries); ArrayResize(g_closedTries, k + 1); g_closedTries[k] = 0;
        }
   ArrayResize(g_openTk, ArraySize(now));
   for(int i = 0; i < ArraySize(now); i++) g_openTk[i] = now[i];

   // cierres pendientes de aparecer en el historial (reintento hasta 20 veces)
   long keepId[]; int keepTry[];
   for(int i = 0; i < ArraySize(g_closedPending); i++)
     {
      string j = ClosedTradeJson(g_closedPending[i]);
      if(j != "" && j != "skip") { PushStr(parts, j); PushStr(g_inflight, j); }
      else if(j == "" && g_closedTries[i] < 20)
        {
         int k = ArraySize(keepId);
         ArrayResize(keepId, k + 1); ArrayResize(keepTry, k + 1);
         keepId[k] = g_closedPending[i]; keepTry[k] = g_closedTries[i] + 1;
        }
     }
   ArrayResize(g_closedPending, ArraySize(keepId)); ArrayResize(g_closedTries, ArraySize(keepTry));
   for(int i = 0; i < ArraySize(keepId); i++) { g_closedPending[i] = keepId[i]; g_closedTries[i] = keepTry[i]; }

   // historial antiguo (al conectar), 40 por envío
   int sent = 0;
   while(ArraySize(g_backfill) > 0 && sent < 40)
     {
      long pid = g_backfill[ArraySize(g_backfill) - 1];
      ArrayResize(g_backfill, ArraySize(g_backfill) - 1);
      if(HasLong(g_openTk, pid)) continue;
      string j = ClosedTradeJson(pid);
      if(j != "" && j != "skip") { PushStr(parts, j); PushStr(g_inflight, j); sent++; }
     }
   for(int i = 0; i < ArraySize(g_tradeQ); i++) { PushStr(parts, g_tradeQ[i]); PushStr(g_inflight, g_tradeQ[i]); }
   ArrayResize(g_tradeQ, 0);
   string out = "";
   for(int i = 0; i < ArraySize(parts); i++) { if(i > 0) out += ","; out += parts[i]; }
   return out;
  }

// ---------------------------------------------------------------- velas M1 cerradas para la web
string BarsJson()
  {
   if(g_lastBarSrv < 0) return "";
   datetime lastClosed = iTime(_Symbol, PERIOD_M1, 1);
   if(lastClosed <= 0) return "";
   datetime start = (datetime)((long)TimeCurrent() - (long)InpWebHistoryDays * 86400);
   datetime from = (g_lastBarSrv > 0) ? (datetime)(g_lastBarSrv + 60) : start;
   if(from < start) from = start;
   int total = iBars(_Symbol, PERIOD_M1);
   if(total <= 1) return "";
   datetime oldest = iTime(_Symbol, PERIOD_M1, total - 1);   // el terminal guarda «Máx. barras en el gráfico»
   if(oldest > 0 && from < oldest) from = oldest;
   if(from > lastClosed) return "";
   datetime to = (datetime)((long)from + 2 * 86400);
   if(to > lastClosed) to = lastClosed;
   MqlRates r[];
   int n = CopyRates(_Symbol, PERIOD_M1, from, to, r);
   if(n <= 0)
     {
      // sin velas en ese tramo (fin de semana o festivo): saltar el tramo, solo si los datos están sincronizados
      if(to < lastClosed && SeriesInfoInteger(_Symbol, PERIOD_M1, SERIES_SYNCHRONIZED) && Bars(_Symbol, PERIOD_M1, from, to) == 0)
         g_lastBarSrv = (long)to;
      return "";
     }
   string out = "";
   for(int i = 0; i < n; i++)
     {
      if(i > 0) out += ",";
      double sp = (r[i].spread > 0) ? r[i].spread * _Point : 0.10;
      out += "[" + JI((long)r[i].time) + "," + JP(r[i].open) + "," + JP(r[i].high) + "," + JP(r[i].low) + "," +
             JP(r[i].close) + "," + JD(sp, 3) + "," + JI((long)r[i].tick_volume) + "]";
     }
   return out;
  }

// ---------------------------------------------------------------- estado en vivo
string StratState(const string name, const bool en, const int startMin, const bool done, const bool ready,
                  const long magic, const double buy, const double sell, const int mod)
  {
   string st;
   if(!en) st = "desactivada";
   else if(PosDir(magic) != 0) st = "en operación";
   else if(ready && !done) st = "orden pendiente";
   else if(done) st = (TradedToday(magic, g_dayN) ? "hecha hoy" : "sin señal hoy");
   else if(mod < startMin) st = "pendiente";
   else st = "esperando datos";
   string lv = "null";
   if(st == "orden pendiente") lv = "{\"buy\":" + JPn(buy) + ",\"sell\":" + JPn(sell) + "}";
   return "{\"name\":" + JS(name) + ",\"enabled\":" + JB(en) + ",\"state\":" + JS(st) + ",\"levels\":" + lv + "}";
  }

string StateJson()
  {
   MqlTick tk;
   bool hasTick = SymbolInfoTick(_Symbol, tk);
   if(hasTick && tk.time_msc != g_lastTickMsc) { g_lastTickMsc = tk.time_msc; g_lastTickLocal = TimeLocal(); }
   bool live = hasTick && (TimeLocal() - g_lastTickLocal) < 180;
   datetime srv = TimeCurrent();
   int mod = MinOfDay(ToNorm(srv));

   string tick = hasTick ? "{\"time\":" + JI((long)tk.time) + ",\"bid\":" + JP(tk.bid) + ",\"ask\":" + JP(tk.ask) + "}" : "null";
   long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string acc = "{\"login\":" + JI(AccountInfoInteger(ACCOUNT_LOGIN)) + ",\"server\":" + JS(AccountInfoString(ACCOUNT_SERVER)) +
                ",\"name\":" + JS(AccountInfoString(ACCOUNT_NAME)) + ",\"company\":" + JS(AccountInfoString(ACCOUNT_COMPANY)) +
                ",\"currency\":" + JS(AccountInfoString(ACCOUNT_CURRENCY)) +
                ",\"balance\":" + JD(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",\"equity\":" + JD(AccountInfoDouble(ACCOUNT_EQUITY), 2) +
                ",\"margin\":" + JD(AccountInfoDouble(ACCOUNT_MARGIN), 2) + ",\"free_margin\":" + JD(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) +
                ",\"leverage\":" + JI(AccountInfoInteger(ACCOUNT_LEVERAGE)) +
                ",\"mode\":" + JS(mode == ACCOUNT_TRADE_MODE_DEMO ? "demo" : (mode == ACCOUNT_TRADE_MODE_REAL ? "real" : "concurso")) +
                ",\"hedging\":" + JB((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE) == ACCOUNT_MARGIN_MODE_RETAIL_HEDGING) +
                ",\"trade_allowed\":" + JB(TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) != 0 && MQLInfoInteger(MQL_TRADE_ALLOWED) != 0) + "}";

   string pos = "";
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(pos != "") pos += ",";
      pos += "{\"ticket\":" + JI((long)t) + ",\"symbol\":" + JS(PositionGetString(POSITION_SYMBOL)) +
             ",\"side\":" + IntegerToString(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1) +
             ",\"volume\":" + JD(PositionGetDouble(POSITION_VOLUME), 2) + ",\"price_open\":" + JP(PositionGetDouble(POSITION_PRICE_OPEN)) +
             ",\"sl\":" + JP(PositionGetDouble(POSITION_SL)) + ",\"tp\":" + JP(PositionGetDouble(POSITION_TP)) +
             ",\"profit\":" + JD(PositionGetDouble(POSITION_PROFIT), 2) + ",\"swap\":" + JD(PositionGetDouble(POSITION_SWAP), 2) +
             ",\"magic\":" + JI(PositionGetInteger(POSITION_MAGIC)) + ",\"comment\":" + JS(PositionGetString(POSITION_COMMENT)) +
             ",\"strategy\":" + JS(StratName(PositionGetInteger(POSITION_MAGIC))) +
             ",\"time\":" + JI(PositionGetInteger(POSITION_TIME)) + "}";
     }
   string ords = "";
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong t = OrderGetTicket(i);
      if(t == 0) continue;
      long ty = OrderGetInteger(ORDER_TYPE);
      string kind = "";
      if(ty == ORDER_TYPE_BUY_LIMIT) kind = "buy_limit";
      else if(ty == ORDER_TYPE_SELL_LIMIT) kind = "sell_limit";
      else if(ty == ORDER_TYPE_BUY_STOP) kind = "buy_stop";
      else if(ty == ORDER_TYPE_SELL_STOP) kind = "sell_stop";
      else continue;
      if(ords != "") ords += ",";
      ords += "{\"ticket\":" + JI((long)t) + ",\"symbol\":" + JS(OrderGetString(ORDER_SYMBOL)) + ",\"kind\":" + JS(kind) +
              ",\"volume\":" + JD(OrderGetDouble(ORDER_VOLUME_CURRENT), 2) + ",\"price\":" + JP(OrderGetDouble(ORDER_PRICE_OPEN)) +
              ",\"sl\":" + JP(OrderGetDouble(ORDER_SL)) + ",\"tp\":" + JP(OrderGetDouble(ORDER_TP)) +
              ",\"magic\":" + JI(OrderGetInteger(ORDER_MAGIC)) + ",\"comment\":" + JS(OrderGetString(ORDER_COMMENT)) +
              ",\"time\":" + JI(OrderGetInteger(ORDER_TIME_SETUP)) + "}";
     }

   string strat = "[" +
      StratState("R50", g_r5Enable, m_r5Ref, g_r5Done, g_r5Ready, g_magicR5, g_r5Up, g_r5Dn, mod) + "," +
      StratState("TOK", g_tk.enabled, g_tk.end, g_tk.done, g_tk.ready, g_tk.magic, g_tk.hi, g_tk.lo, mod) + "," +
      StratState("AORB", g_ao.enabled, g_ao.end, g_ao.done, g_ao.ready, g_ao.magic, g_ao.hi, g_ao.lo, mod) + "," +
      StratState("ALB", g_al.enabled, g_al.end, g_al.done, g_al.ready, g_al.magic, g_al.hi, g_al.lo, mod) + "," +
      StratState("LM", g_lmEnable, m_lmEntry, g_lmDone, false, g_magicLM, 0, 0, mod) + "]";

   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   string blocked = g_permBlocked ? "bloqueado por DD máximo" : (g_targetHit ? "objetivo de fase alcanzado" : (g_dailyBlocked ? "pausa diaria" : ""));
   string risk = "{\"init_bal\":" + JD(g_initBal, 2) + ",\"day_ref\":" + JD(g_dayRef, 2) + ",\"risk_base\":" + JD(g_riskBase, 2) +
                 ",\"daily_floor\":" + JD(g_dayRef * (1.0 - g_dailyGuardPct / 100.0), 2) +
                 ",\"max_floor\":" + JD(g_initBal * (1.0 - g_maxGuardPct / 100.0), 2) +
                 ",\"daily_limit\":" + JD(g_dayRef * 0.97, 2) + ",\"max_limit\":" + JD(g_initBal * (1.0 - InpMaxLossPct / 100.0), 2) +
                 ",\"target\":" + (g_targetPct > 0 ? JD(g_initBal * (1.0 + g_targetPct / 100.0), 2) : "null") +
                 ",\"daily_dd_pct\":" + JD(g_dayRef > 0 ? MathMax(0.0, (g_dayRef - eq) / g_dayRef * 100.0) : 0.0, 2) +
                 ",\"max_dd_pct\":" + JD(g_initBal > 0 ? MathMax(0.0, (g_initBal - eq) / g_initBal * 100.0) : 0.0, 2) +
                 ",\"progress_pct\":" + JD(g_initBal > 0 ? (eq / g_initBal - 1.0) * 100.0 : 0.0, 2) +
                 ",\"factor\":" + JD(RiskFactor(), 2) + ",\"blocked\":" + (blocked == "" ? "null" : JS(blocked)) +
                 ",\"autotrade\":" + JB(g_autotrade) + "}";

   string market = "{\"open\":" + JB(live) + ",\"last_tick\":" + (hasTick ? JI((long)tk.time) : "null") + "}";

   string settings = "{\"autotrade\":" + JB(g_autotrade) + ",\"risk_pct\":" + JD(g_riskPct, 2) +
                     ",\"max_open_trades\":" + IntegerToString(g_maxOpen) + ",\"use_time_exit\":" + JB(g_useTimeExit) +
                     ",\"compound\":" + JB(g_compound) + ",\"daily_guard_pct\":" + JD(g_dailyGuardPct, 2) +
                     ",\"max_guard_pct\":" + JD(g_maxGuardPct, 2) + ",\"target_pct\":" + JD(g_targetPct, 2) +
                     ",\"initial_balance\":" + JD(g_initBal, 2) + ",\"max_loss_pct\":" + JD(InpMaxLossPct, 2) +
                     ",\"strategies\":{\"LM\":" + JB(g_lmEnable) + ",\"AORB\":" + JB(g_ao.enabled) + ",\"TOK\":" + JB(g_tk.enabled) +
                     ",\"R50\":" + JB(g_r5Enable) + ",\"ALB\":" + JB(g_al.enabled) + "}}";
   string ea = "{\"version\":\"6.00\",\"symbol\":" + JS(_Symbol) + ",\"magic\":" + JI(InpMagic) + ",\"digits\":" + IntegerToString(_Digits) +
               ",\"contract\":" + JD(SymbolInfoDouble(_Symbol, SYMBOL_TRADE_CONTRACT_SIZE), 2) +
               ",\"vol_min\":" + JD(SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), 2) +
               ",\"vol_step\":" + JD(SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), 2) +
               ",\"server_shift_min\":" + IntegerToString(InpServerShiftMin) + ",\"atr\":" + JD(g_atr, 2) +
               ",\"server_time\":" + JI((long)srv) + ",\"settings\":" + settings + "}";

   return "{\"tick\":" + tick + ",\"account\":" + acc + ",\"positions\":[" + pos + "],\"orders\":[" + ords + "],\"strategies\":" + strat +
          ",\"risk\":" + risk + ",\"market\":" + market + ",\"ea\":" + ea + "}";
  }

// ---------------------------------------------------------------- órdenes desde la web
string CmdOpen(JNode *pl, ulong &ticketOut, double &priceOut, double &lotsOut)
  {
   int side = (int)JNum(pl, "side", 0);
   string kind = JStr(pl, "kind", "market");
   double sl = JNum(pl, "sl", 0.0), tp = JNum(pl, "tp", 0.0), price = JNum(pl, "price", 0.0);
   double lots = JNum(pl, "lots", 0.0), riskPct = JNum(pl, "risk_pct", 0.0);
   string cmt = JStr(pl, "comment", "web");
   if(StringLen(cmt) > 25) cmt = StringSubstr(cmt, 0, 25);
   if(side != 1 && side != -1) return "lado no válido";
   if(sl <= 0) return "falta el stop loss";
   if(g_permBlocked || g_targetHit || g_dailyBlocked) return "cuenta bloqueada por las guardas de fondeo";
   if(InpNoHedge && OppositeOpen(side)) return "hay una posición contraria abierta (FundingPips no permite cobertura)";
   MqlTick tk;
   if(!SymbolInfoTick(_Symbol, tk)) return "sin precio";
   double entry = (kind == "market") ? ((side > 0) ? tk.ask : tk.bid) : price;
   if(entry <= 0) return "precio de entrada no válido";
   if((side > 0 && sl >= entry) || (side < 0 && sl <= entry)) return "el SL está del lado equivocado";
   if(tp > 0 && ((side > 0 && tp <= entry) || (side < 0 && tp >= entry))) return "el TP está del lado equivocado";
   sl = NormPrice(sl);
   tp = (tp > 0) ? NormPrice(tp) : 0.0;
   ENUM_ORDER_TYPE ot = (side > 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   double lpl = LossPerLot(ot, entry, sl);
   if(lpl <= 0) return "no se pudo calcular el riesgo";
   double floorD = g_dayRef  * (1.0 - g_dailyGuardPct / 100.0);
   double floorS = g_initBal * (1.0 - g_maxGuardPct   / 100.0);
   double room   = WorstCaseEquity() - MathMax(floorD, floorS);
   if(room <= 0) return "sin margen de riesgo hasta las guardas";
   if(lots <= 0)
     {
      double pct = (riskPct > 0) ? riskPct : g_riskPct;
      if(pct > 3.0) pct = 3.0;
      UpdateRiskBase();
      double base = g_compound ? g_riskBase : g_initBal;
      double riskMoney = MathMin(base * pct / 100.0, room * 0.9);
      lots = NormLots(riskMoney / lpl);
      if(lots <= 0) return "el lote mínimo arriesga más de lo permitido";
     }
   else
     {
      lots = NormLots(lots);
      if(lots > 0 && lots * lpl > room * 0.9)
         return StringFormat("con %.2f lotes el SL pasaría las guardas de fondeo (pérdida %.2f, margen %.2f)", lots, lots * lpl, room * 0.9);
     }
   if(lots <= 0) return "volumen no válido";

   trade.SetExpertMagicNumber((ulong)InpMagic);
   bool ok = false;
   if(kind == "market")
      ok = (side > 0) ? trade.Buy(lots, _Symbol, 0.0, sl, tp, cmt) : trade.Sell(lots, _Symbol, 0.0, sl, tp, cmt);
   else if(kind == "limit")
     {
      price = NormPrice(price);
      ok = (side > 0) ? trade.BuyLimit(lots, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, cmt)
                      : trade.SellLimit(lots, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, cmt);
     }
   else if(kind == "stop")
     {
      price = NormPrice(price);
      ok = (side > 0) ? trade.BuyStop(lots, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, cmt)
                      : trade.SellStop(lots, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, cmt);
     }
   else return "tipo de orden no válido";
   uint rc = trade.ResultRetcode();
   if(!ok || (rc != TRADE_RETCODE_DONE && rc != TRADE_RETCODE_DONE_PARTIAL && rc != TRADE_RETCODE_PLACED))
     {
      string msg = StringFormat("orden rechazada: %u %s", rc, trade.ResultRetcodeDescription());
      if(rc == TRADE_RETCODE_CLIENT_DISABLES_AT) msg += " (activa «Algo Trading» en MetaTrader 5)";
      return msg;
     }
   ticketOut = trade.ResultOrder();
   priceOut  = (trade.ResultPrice() > 0) ? trade.ResultPrice() : entry;
   lotsOut   = lots;
   return "";
  }

string RetMsg(const bool ok)
  {
   if(ok) return "";
   return StringFormat("%u %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());
  }

void RunCommand(JNode *c)
  {
   long id = (long)JNum(c, "id", 0);
   string type = JStr(c, "type", "");
   JNode *pl = c.Get("payload");
   string err = "";
   string extra = "";
   if(type == "open")
     {
      ulong tk = 0; double px = 0, lots = 0;
      err = CmdOpen(pl, tk, px, lots);
      if(err == "")
        {
         extra = ",\"ticket\":" + JI((long)tk) + ",\"price\":" + JP(px) + ",\"lots\":" + JD(lots, 2);
         Log(StringFormat("WEB: %s %s %.2f lotes @%.2f SL %.2f TP %.2f", JStr(pl, "kind", "market"),
                          (JNum(pl, "side", 0) > 0 ? "COMPRA" : "VENTA"), lots, px, JNum(pl, "sl", 0), JNum(pl, "tp", 0)));
        }
     }
   else if(type == "modify")
     {
      ulong tk = (ulong)JNum(pl, "ticket", 0);
      if(!PositionSelectByTicket(tk)) err = "posición no encontrada";
      else
        {
         double sl = JHas(pl, "sl") ? NormPrice(JNum(pl, "sl", 0)) : PositionGetDouble(POSITION_SL);
         double tp = JHas(pl, "tp") ? NormPrice(JNum(pl, "tp", 0)) : PositionGetDouble(POSITION_TP);
         if(JNum(pl, "sl", 1) == 0) sl = 0.0;
         if(JNum(pl, "tp", 1) == 0) tp = 0.0;
         err = RetMsg(trade.PositionModify(tk, sl, tp));
         if(err == "") Log(StringFormat("WEB: #%I64u SL %.2f TP %.2f", tk, sl, tp));
        }
     }
   else if(type == "close")
     {
      ulong tk = (ulong)JNum(pl, "ticket", 0);
      double vol = JNum(pl, "volume", 0);
      if(!PositionSelectByTicket(tk)) err = "posición no encontrada";
      else
        {
         double cur = PositionGetDouble(POSITION_VOLUME);
         bool ok = (vol > 0 && vol < cur) ? trade.PositionClosePartial(tk, NormLots(vol), InpSlippagePts) : trade.PositionClose(tk, InpSlippagePts);
         err = RetMsg(ok);
         if(err == "") Log(StringFormat("WEB: #%I64u cerrada%s", tk, (vol > 0 && vol < cur) ? " (parcial)" : ""));
        }
     }
   else if(type == "cancel")
     {
      ulong tk = (ulong)JNum(pl, "ticket", 0);
      err = RetMsg(trade.OrderDelete(tk));
     }
   else if(type == "modify_order")
     {
      ulong tk = (ulong)JNum(pl, "ticket", 0);
      if(!OrderSelect(tk)) err = "orden no encontrada";
      else
        {
         double price = JHas(pl, "price") ? NormPrice(JNum(pl, "price", 0)) : OrderGetDouble(ORDER_PRICE_OPEN);
         double sl = JHas(pl, "sl") ? NormPrice(JNum(pl, "sl", 0)) : OrderGetDouble(ORDER_SL);
         double tp = JHas(pl, "tp") ? NormPrice(JNum(pl, "tp", 0)) : OrderGetDouble(ORDER_TP);
         err = RetMsg(trade.OrderModify(tk, price, sl, tp, ORDER_TIME_GTC, 0));
        }
     }
   else if(type == "close_all")
     {
      int fails = 0;
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong tk = PositionGetTicket(i);
         if(tk == 0 || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
         if(!trade.PositionClose(tk, InpSlippagePts)) fails++;
        }
      if(fails > 0) err = IntegerToString(fails) + " posiciones no se pudieron cerrar";
      Log("WEB: cerrar todas las posiciones de " + _Symbol, "warn");
     }
   else if(type == "reset_guards")
     {
      g_dailyBlocked = false; g_permBlocked = false; g_targetHit = false;
      GlobalVariableDel(g_gvPerm); GlobalVariableDel(g_gvTarget); GlobalVariableDel(g_gvDayKey + "_BLK");
      g_riskBase = AccountInfoDouble(ACCOUNT_BALANCE);
      GlobalVariableSet(g_gvRiskBase, g_riskBase);
      g_srvDay = 0;
      Log("WEB: bloqueos reiniciados (nueva fase o cuenta)", "warn");
     }
   else if(type == "history")
     {
      QueueBackfill((int)MathMax(1, MathMin(365, JNum(pl, "days", 30))));
     }
   else err = "orden desconocida: " + type;

   if(err != "" && type != "") Log("WEB: " + type + " falló: " + err, "warn");
   PushStr(g_ackQ, "{\"id\":" + JI(id) + ",\"ok\":" + JB(err == "") + ",\"result\":{\"msg\":" + JS(err) + extra + "}}");
  }

void ApplySettings(JNode *s)
  {
   if(s == NULL || s.type != J_OBJ || s.Size() == 0) return;
   string changes = "";
   if(JHas(s, "autotrade"))
     {
      bool v = JBool(s, "autotrade", g_autotrade);
      if(v != g_autotrade) { g_autotrade = v; changes += (v ? " automático ON" : " automático OFF"); }
     }
   if(JHas(s, "risk_pct"))
     {
      double v = JNum(s, "risk_pct", g_riskPct);
      if(v > 0 && v <= 3.0 && v != g_riskPct) { g_riskPct = v; changes += StringFormat(" riesgo %.2f%%", v); }
     }
   if(JHas(s, "max_open_trades"))
     {
      int v = (int)JNum(s, "max_open_trades", g_maxOpen);
      if(v >= 0 && v <= 20 && v != g_maxOpen) { g_maxOpen = v; changes += StringFormat(" máx. operaciones %d", v); }
     }
   if(JHas(s, "use_time_exit"))
     {
      bool v = JBool(s, "use_time_exit", g_useTimeExit);
      if(v != g_useTimeExit) { g_useTimeExit = v; changes += (v ? " cierre por tiempo ON" : " cierre por tiempo OFF"); }
     }
   if(JHas(s, "compound"))
     {
      bool v = JBool(s, "compound", g_compound);
      if(v != g_compound) { g_compound = v; changes += (v ? " compuesto ON" : " compuesto OFF"); }
     }
   if(JHas(s, "daily_guard_pct"))
     {
      double v = JNum(s, "daily_guard_pct", g_dailyGuardPct);
      if(v > 0 && v <= 10 && v != g_dailyGuardPct) { g_dailyGuardPct = v; changes += StringFormat(" guarda diaria %.1f%%", v); }
     }
   if(JHas(s, "max_guard_pct"))
     {
      double v = JNum(s, "max_guard_pct", g_maxGuardPct);
      if(v > 0 && v <= InpMaxLossPct && v != g_maxGuardPct) { g_maxGuardPct = v; changes += StringFormat(" guarda máxima %.1f%%", v); }
     }
   if(JHas(s, "target_pct"))
     {
      double v = JNum(s, "target_pct", g_targetPct);
      if(v >= 0 && v <= 50 && v != g_targetPct) { g_targetPct = v; changes += StringFormat(" objetivo %.1f%%", v); }
     }
   JNode *st = s.Get("strategies");
   if(st != NULL && st.type == J_OBJ)
     {
      bool wk = false;
      if(g_dayN > 0) { int dw = DayOfWeekN(g_dayN); wk = (dw == 0 || dw == 6); }
      if(JHas(st, "LM"))
        {
         bool v = JBool(st, "LM", g_lmEnable);
         if(v != g_lmEnable)
           {
            g_lmEnable = v; changes += " LM " + (v ? "ON" : "OFF");
            if(v && g_dayN > 0) { g_lmRef = 0.0; g_lmTries = 0; g_lmDone = wk || TradedToday(g_magicLM, g_dayN); }
           }
        }
      if(JHas(st, "R50"))
        {
         bool v = JBool(st, "R50", g_r5Enable);
         if(v != g_r5Enable)
           {
            g_r5Enable = v; changes += " R50 " + (v ? "ON" : "OFF");
            if(v && g_dayN > 0) { g_r5Ready = false; g_r5Up = 0.0; g_r5Dn = 0.0; g_r5Tries = 0; g_r5Done = wk || TradedToday(g_magicR5, g_dayN); }
           }
        }
      if(JHas(st, "AORB")) { bool v = JBool(st, "AORB", g_ao.enabled); if(v != g_ao.enabled) { g_ao.enabled = v; changes += " AORB " + (v ? "ON" : "OFF"); if(v && g_dayN > 0) ResetOrb(g_ao, wk, g_dayN); } }
      if(JHas(st, "TOK"))  { bool v = JBool(st, "TOK", g_tk.enabled);  if(v != g_tk.enabled) { g_tk.enabled = v; changes += " TOK " + (v ? "ON" : "OFF"); if(v && g_dayN > 0) ResetOrb(g_tk, wk, g_dayN); } }
      if(JHas(st, "ALB"))  { bool v = JBool(st, "ALB", g_al.enabled);  if(v != g_al.enabled) { g_al.enabled = v; changes += " ALB " + (v ? "ON" : "OFF"); if(v && g_dayN > 0) ResetOrb(g_al, wk, g_dayN); } }
     }
   if(changes != "") Log("Ajustes desde la web:" + changes, g_autotrade ? "warn" : "info");
  }

// ---------------------------------------------------------------- sincronización
void RequeueInflight()
  {
   for(int i = 0; i < ArraySize(g_inflight); i++)
      if(ArraySize(g_tradeQ) < 300) PushStr(g_tradeQ, g_inflight[i]);
   ArrayResize(g_inflight, 0);
  }

void BridgeSync()
  {
   if(!InpWebEnable || InpBridgeKey == "" || MQLInfoInteger(MQL_TESTER)) return;
   uint nowMs = GetTickCount();
   if(g_lastSyncMs != 0 && nowMs - g_lastSyncMs < (uint)MathMax(500, InpSyncMs)) return;
   if(g_syncErrors >= 3 && nowMs - g_lastSyncMs < (uint)MathMin(30000, 2000 * g_syncErrors)) return;   // espera creciente tras errores
   g_lastSyncMs = nowMs;

   if(!g_backfillQueued) { QueueBackfill(30); g_backfillQueued = true; }

   string bars = BarsJson();
   string trades = TradesJson();
   int nLog = ArraySize(g_logQ), nAck = ArraySize(g_ackQ);
   string payload = "{\"state\":" + StateJson();
   if(bars != "")   payload += ",\"bars\":[" + bars + "]";
   if(trades != "") payload += ",\"trades\":[" + trades + "]";
   if(nLog > 0)     payload += ",\"events\":[" + Joined(g_logQ, nLog) + "]";
   if(nAck > 0)     payload += ",\"acks\":[" + Joined(g_ackQ, nAck) + "]";
   payload += "}";
   string body = "{\"p_key\":" + JS(InpBridgeKey) + ",\"p\":" + payload + "}";

   char data[], res[];
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0) ArrayResize(data, len - 1);   // sin el 0 final
   string headers = "Content-Type: application/json\r\napikey: " + InpWebAnonKey + "\r\nAuthorization: Bearer " + InpWebAnonKey + "\r\n";
   string resHeaders;
   string url = InpWebURL + "/rest/v1/rpc/bridge_sync";
   ResetLastError();
   int code = WebRequest("POST", url, headers, 8000, data, res, resHeaders);
   if(code == -1)
     {
      int e = GetLastError();
      g_syncErrors++;
      g_bridgeStatus = "sin conexión con la web";
      if(TimeLocal() - g_lastErrLog > 60)
        {
         g_lastErrLog = TimeLocal();
         if(e == 4014)
            Print("WebRequest no permitido: en MT5 ve a Herramientas → Opciones → Asesores expertos, marca «Permitir WebRequest» y añade ", InpWebURL);
         else
            PrintFormat("No se pudo conectar con la web (error %d). Se reintenta.", e);
        }
      RequeueInflight();
      return;
     }
   string text = CharArrayToString(res, 0, WHOLE_ARRAY, CP_UTF8);
   if(code != 200)
     {
      g_syncErrors++;
      g_bridgeStatus = StringFormat("la web respondió %d", code);
      if(TimeLocal() - g_lastErrLog > 60)
        {
         g_lastErrLog = TimeLocal();
         PrintFormat("La web respondió %d: %s", code, StringSubstr(text, 0, 300));
         if(StringFind(text, "no v") >= 0) Print("Revisa InpBridgeKey: copia la clave de la cuenta desde la web (Cuenta → Conectar EA).");
        }
      RequeueInflight();
      return;
     }
   // envío correcto: vaciar colas enviadas
   DropFirst(g_logQ, nLog);
   DropFirst(g_ackQ, nAck);
   ArrayResize(g_inflight, 0);
   g_syncErrors = 0;
   g_lastSyncOk = TimeLocal();
   g_bridgeStatus = "conectado";

   JParser parser;
   JNode *root = parser.Parse(text);
   if(root == NULL) return;
   if(root.type == J_OBJ)
     {
      g_lastBarSrv = (long)JNum(root, "last_bar", 0);
      long sts = (long)JNum(root, "settings_ts", 0);
      if(sts != g_settingsTs) { ApplySettings(root.Get("settings")); g_settingsTs = sts; }
      JNode *cmds = root.Get("commands");
      if(cmds != NULL && cmds.type == J_ARR)
         for(int i = 0; i < cmds.Size(); i++)
            RunCommand(cmds.At(i));
     }
   delete root;
  }

//==================================================================
// UTILIDADES DE TIEMPO
//==================================================================
int ParseHM(const string s)
  {
   string p[];
   if(StringSplit(s, ':', p) != 2) return -1;
   int h = (int)StringToInteger(p[0]);
   int m = (int)StringToInteger(p[1]);
   if(h < 0 || h > 23 || m < 0 || m > 59) return -1;
   return h * 60 + m;
  }

datetime DayStart(const datetime t)  { return (datetime)((long)t - ((long)t % 86400)); }
int      MinOfDay(const datetime t)  { return (int)(((long)t % 86400) / 60); }

// Hora del servidor -> hora normalizada de la estrategia
datetime ToNorm(const datetime srv)
  {
   long s = (long)InpServerShiftMin * 60;
   if(InpHistShift && srv < InpHistShiftEnd) s += (long)InpHistShiftMin * 60;
   return (datetime)((long)srv - s);
  }

// Hora normalizada -> hora del servidor
datetime ToSrv(const datetime nrm)
  {
   datetime c = (datetime)((long)nrm + (long)InpServerShiftMin * 60);
   if(InpHistShift)
     {
      datetime c2 = (datetime)((long)c + (long)InpHistShiftMin * 60);
      if(c2 < InpHistShiftEnd) return c2;
     }
   return c;
  }

int DayOfWeekN(const datetime t)
  {
   MqlDateTime s;
   TimeToStruct(t, s);
   return s.day_of_week;
  }

//==================================================================
// UTILIDADES DE PRECIO / VOLUMEN
//==================================================================
double NormPrice(const double p)
  {
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(ts <= 0) ts = _Point;
   return NormalizeDouble(MathRound(p / ts) * ts, _Digits);
  }

double NormLots(double lots)
  {
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = 0.01;
   lots = MathFloor(lots / step + 1e-9) * step;
   if(lots < vmin) return 0.0;
   lots = MathMin(lots, vmax);
   int vd = (int)MathMax(0.0, MathCeil(-MathLog10(step) - 1e-9));
   return NormalizeDouble(lots, vd);
  }

// Pérdida monetaria por 1 lote si el precio va de 'price' a 'sl'
double LossPerLot(const ENUM_ORDER_TYPE type, const double price, const double sl)
  {
   double p = 0.0;
   if(OrderCalcProfit(type, _Symbol, 1.0, price, sl, p))
      return MathAbs(p);
   double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(ts <= 0 || tv <= 0) return 0.0;
   return MathAbs(price - sl) / ts * tv;
  }

// Calcula una vez por día el ATR(D1): media simple de los TR de los últimos N días cerrados,
// con los días agrupados por hora normalizada desde velas H1 (igual que el backtest).
// Válido si InpServerShiftMin es múltiplo de 60.
bool ComputeDaily()
  {
   if(g_calcDay == g_dayN && g_atr > 0) return true;
   int calDays = (int)MathCeil((InpATRPeriod + 5) * 7.0 / 5.0) + 15;
   MqlRates r[];
   int n = CopyRates(_Symbol, PERIOD_H1, ToSrv((datetime)((long)g_dayN - (long)calDays * 86400)),
                     (datetime)((long)ToSrv(g_dayN) - 1), r);
   if(n <= 0) return false;
   if(!MQLInfoInteger(MQL_TESTER) && !SeriesInfoInteger(_Symbol, PERIOD_H1, SERIES_SYNCHRONIZED)) return false;
   double dh[], dl[], dc[];
   datetime dd[];
   int k = -1;
   for(int i = 0; i < n; i++)
     {
      datetime d = DayStart(ToNorm(r[i].time));
      int dw = DayOfWeekN(d);
      if(dw == 0 || dw == 6 || d >= g_dayN) continue;
      if(k < 0 || dd[k] != d)
        {
         k++;
         ArrayResize(dh, k + 1); ArrayResize(dl, k + 1); ArrayResize(dc, k + 1); ArrayResize(dd, k + 1);
         dd[k] = d; dh[k] = r[i].high; dl[k] = r[i].low;
        }
      else
        {
         dh[k] = MathMax(dh[k], r[i].high);
         dl[k] = MathMin(dl[k], r[i].low);
        }
      dc[k] = r[i].close;
     }
   int nd = k + 1;
   int P  = InpATRPeriod;
   if(nd < P + 1) return false;
   double sum = 0.0;
   for(int j = nd - P; j < nd; j++)
      sum += MathMax(dh[j] - dl[j], MathMax(MathAbs(dh[j] - dc[j - 1]), MathAbs(dl[j] - dc[j - 1])));
   g_atr     = sum / P;
   g_calcDay = g_dayN;
   Log(StringFormat("Día %s: ATR %.2f", TimeToString(g_dayN, TIME_DATE), g_atr));
   return true;
  }

// Apertura de la primera vela M1 entre hhmm y hhmm+5 (día normalizado dN)
double GetOpenPrice(const datetime dN, const int minute)
  {
   MqlRates r[];
   datetime from = ToSrv((datetime)((long)dN + (long)minute * 60));
   datetime to   = ToSrv((datetime)((long)dN + (long)(minute + 5) * 60));
   int n = CopyRates(_Symbol, PERIOD_M1, from, to, r);
   if(n <= 0) return 0.0;
   return r[0].open;
  }

// Máximo / mínimo de las velas M1 con apertura en [start, end-1min]
bool GetRange(const datetime dN, const int startMin, const int endMin, double &hi, double &lo)
  {
   MqlRates r[];
   datetime from = ToSrv((datetime)((long)dN + (long)startMin * 60));
   datetime to   = ToSrv((datetime)((long)dN + (long)(endMin - 1) * 60));
   int n = CopyRates(_Symbol, PERIOD_M1, from, to, r);
   int need = MathMax(1, (endMin - startMin) / 2);
   if(n < need) return false;
   hi = -DBL_MAX; lo = DBL_MAX;
   for(int i = 0; i < n; i++)
     {
      if(r[i].high > hi) hi = r[i].high;
      if(r[i].low  < lo) lo = r[i].low;
     }
   return (hi > lo);
  }

//==================================================================
// POSICIONES
//==================================================================
bool IsOurMagic(const long mg) { return (mg == g_magicLM || mg == g_ao.magic || mg == g_tk.magic || mg == g_magicR5 || mg == g_al.magic); }

// Dirección de la posición abierta con ese magic (0 = ninguna)
int PosDir(const long magic)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != magic) continue;
      return (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 1 : -1;
     }
   return 0;
  }

// ¿Hay alguna posición del símbolo (de este EA o manual) en sentido contrario? Abrirla sería cobertura.
bool OppositeOpen(const int dir)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      int d = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 1 : -1;
      if(d == -dir) return true;
     }
   return false;
  }

void CloseMagic(const long magic, const bool onlyStale = false)
  {
   if(TimeCurrent() < g_nextClose) return;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != magic) continue;
      if(onlyStale)
        {
         datetime ot = (datetime)PositionGetInteger(POSITION_TIME);
         if(DayStart(ToNorm(ot)) >= g_dayN) continue;   // abierta hoy: no es antigua
        }
      if(!trade.PositionClose(tk, InpSlippagePts))
        {
         Log(StringFormat("Error al cerrar #%I64u: %u %s (reintento en 30 s)", tk, trade.ResultRetcode(), trade.ResultRetcodeDescription()), "warn");
         g_nextClose = TimeCurrent() + 30;
        }
     }
  }

void CloseAllEA()
  {
   CloseMagic(g_magicLM);
   CloseMagic(g_ao.magic);
   CloseMagic(g_tk.magic);
   CloseMagic(g_magicR5);
   CloseMagic(g_al.magic);
   CloseMagic(InpMagic);        // operaciones abiertas desde la web
  }

// Número de posiciones abiertas de este EA en el símbolo
int CountOpenEA()
  {
   int c = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(IsOurMagic(PositionGetInteger(POSITION_MAGIC))) c++;
     }
   return c;
  }

// Equity si todas las posiciones con SL lo tocan (el resto a su flotante actual)
double WorstCaseEquity()
  {
   double w = AccountInfoDouble(ACCOUNT_BALANCE);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      string sym  = PositionGetString(POSITION_SYMBOL);
      double sl   = PositionGetDouble(POSITION_SL);
      double vol  = PositionGetDouble(POSITION_VOLUME);
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double swp  = PositionGetDouble(POSITION_SWAP);
      ENUM_ORDER_TYPE ot = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      double p = 0.0;
      if(sl > 0 && OrderCalcProfit(ot, sym, vol, open, sl, p))
         w += p + swp;
      else
         w += PositionGetDouble(POSITION_PROFIT) + swp;
     }
   return w;
  }

// ¿Ya abrió hoy esta estrategia? (deals de entrada desde el inicio del día de estrategia)
bool TradedToday(const long magic, const datetime dN)
  {
   if(!HistorySelect(ToSrv(dN), TimeCurrent() + 60)) return false;
   int n = HistoryDealsTotal();
   for(int i = 0; i < n; i++)
     {
      ulong tk = HistoryDealGetTicket(i);
      if(tk == 0) continue;
      if(HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(tk, DEAL_MAGIC) != magic) continue;
      if(HistoryDealGetInteger(tk, DEAL_ENTRY) == DEAL_ENTRY_IN) return true;
     }
   return false;
  }

//==================================================================
// RIESGO Y EJECUCIÓN
//==================================================================
// Interés compuesto escalonado: cuando el balance sube InpCompoundUpPct% o baja InpCompoundDnPct%
// respecto al balance base, el balance actual pasa a ser el nuevo balance base.
void UpdateRiskBase()
  {
   if(g_riskBase <= 0) g_riskBase = g_initBal;
   if(!g_compound) return;
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   if(bal >= g_riskBase * (1.0 + InpCompoundUpPct / 100.0) || bal <= g_riskBase * (1.0 - InpCompoundDnPct / 100.0))
     {
      Log(StringFormat("Nuevo balance base para el riesgo: %.2f -> %.2f", g_riskBase, bal));
      g_riskBase = bal;
      GlobalVariableSet(g_gvRiskBase, g_riskBase);
     }
  }

double RiskFactor()
  {
   if(!InpDDThrottle || g_initBal <= 0) return 1.0;
   double eq      = AccountInfoDouble(ACCOUNT_EQUITY);
   double ddFloor = g_initBal * (1.0 - InpMaxLossPct / 100.0);
   double f       = (eq - ddFloor) / (g_initBal * InpMaxLossPct / 100.0);
   return MathMax(InpThrottleMin, MathMin(1.0, f));
  }

// RES_DONE: abierta o descartada a propósito | RES_RETRY: fallo, reintentar | RES_WAIT: esperar
int OpenTrade(const int dir, const double slDist, const double tpR, const long magic, const string cmt)
  {
   if(g_maxOpen > 0 && CountOpenEA() >= g_maxOpen)
     {
      Log(StringFormat("%s: omitido (límite de %d operaciones simultáneas)", cmt, g_maxOpen));
      return RES_DONE;
     }
   MqlTick tk;
   if(!SymbolInfoTick(_Symbol, tk)) return RES_RETRY;
   if(tk.ask - tk.bid > InpMaxSpreadUSD) return RES_WAIT;

   long stopsLvl = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   if(slDist <= (double)stopsLvl * _Point || slDist <= 0)
     {
      Log(StringFormat("%s: SL demasiado cercano (%.2f), se omite el día", cmt, slDist));
      return RES_DONE;
     }

   double price = (dir > 0) ? tk.ask : tk.bid;
   double sl    = NormPrice((dir > 0) ? price - slDist : price + slDist);
   double tp    = 0.0;
   double tpUse = (tpR <= 0 && !g_useTimeExit) ? InpNoTimeExitTP_R : tpR;   // sin cierre por tiempo, toda operación lleva TP
   if(tpUse > 0) tp = NormPrice((dir > 0) ? price + tpUse * slDist : price - tpUse * slDist);
   ENUM_ORDER_TYPE ot = (dir > 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;

   double lpl = LossPerLot(ot, price, sl);
   if(lpl <= 0) return RES_RETRY;

   UpdateRiskBase();
   double base      = g_compound ? g_riskBase : g_initBal;
   double riskMoney = base * g_riskPct / 100.0 * RiskFactor();

   // Margen hasta las guardas: la nueva pérdida + las abiertas nunca deben cruzarlas
   double floorD = g_dayRef  * (1.0 - g_dailyGuardPct / 100.0);
   double floorS = g_initBal * (1.0 - g_maxGuardPct   / 100.0);
   double room   = WorstCaseEquity() - MathMax(floorD, floorS);
   if(room <= 0)
     {
      Log(StringFormat("%s: sin margen de riesgo hasta las guardas, se omite", cmt));
      return RES_DONE;
     }
   riskMoney = MathMin(riskMoney, room * 0.9);

   double lots = NormLots(riskMoney / lpl);
   if(lots <= 0)
     {
      double minVol  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
      double riskMin = lpl * minVol;
      if(InpMinLotTol > 1.0 && riskMoney > 0 && riskMin <= riskMoney * InpMinLotTol && riskMin <= room * 0.9)
        {
         lots = NormLots(minVol);
         Log(StringFormat("%s: se usa el lote mínimo %.2f (riesgo real %.2f = %.1fx el previsto %.2f)", cmt, lots, riskMin, riskMin / riskMoney, riskMoney));
        }
      if(lots <= 0)
        {
         Log(StringFormat("%s: lote mínimo arriesgaría %.2f (previsto %.2f), se omite", cmt, riskMin, riskMoney));
         return RES_DONE;
        }
     }

   trade.SetExpertMagicNumber((ulong)magic);
   bool ok = (dir > 0) ? trade.Buy(lots, _Symbol, 0.0, sl, tp, cmt)
                       : trade.Sell(lots, _Symbol, 0.0, sl, tp, cmt);
   uint rc = trade.ResultRetcode();
   if(!ok || (rc != TRADE_RETCODE_DONE && rc != TRADE_RETCODE_DONE_PARTIAL && rc != TRADE_RETCODE_PLACED))
     {
      Log(StringFormat("%s: orden rechazada %u %s", cmt, rc, trade.ResultRetcodeDescription()), "warn");
      if(rc == TRADE_RETCODE_MARKET_CLOSED) return RES_WAIT;
      if(rc == TRADE_RETCODE_NO_MONEY || rc == TRADE_RETCODE_INVALID_STOPS || rc == TRADE_RETCODE_INVALID_VOLUME ||
         rc == TRADE_RETCODE_TRADE_DISABLED || rc == TRADE_RETCODE_INVALID_FILL || rc == TRADE_RETCODE_LIMIT_VOLUME ||
         rc == TRADE_RETCODE_LIMIT_POSITIONS) return RES_DONE;
      return RES_RETRY;
     }
   Log(StringFormat("%s %s %.2f lotes @%.2f SL %.2f TP %.2f riesgo %.2f (base %.2f)", cmt, (dir > 0 ? "BUY" : "SELL"),
               lots, trade.ResultPrice(), sl, tp, riskMoney, base));
   return RES_DONE;
  }

//==================================================================
// GUARDAS DE FONDEO
//==================================================================
void SaveDayRef()
  {
   GlobalVariableSet(g_gvDayKey, (double)g_srvDay);
   GlobalVariableSet(g_gvDayRef, g_dayRef);
  }

void UpdateServerDay(const datetime srv)
  {
   datetime d = DayStart(srv);
   if(d == g_srvDay) return;
   g_srvDay = d;
   if(GlobalVariableCheck(g_gvDayKey) && (datetime)GlobalVariableGet(g_gvDayKey) == d && GlobalVariableCheck(g_gvDayRef))
      g_dayRef = GlobalVariableGet(g_gvDayRef);     // reinicio del EA a mitad de día
   else
     {
      g_dayRef = MathMax(AccountInfoDouble(ACCOUNT_BALANCE), AccountInfoDouble(ACCOUNT_EQUITY));
      SaveDayRef();
     }
   g_dailyBlocked = GlobalVariableCheck(g_gvDayKey + "_BLK") && (datetime)GlobalVariableGet(g_gvDayKey + "_BLK") == d;
  }

void CheckGuards()
  {
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   if(!g_dailyBlocked && eq <= g_dayRef * (1.0 - g_dailyGuardPct / 100.0))
     {
      g_dailyBlocked = true;
      GlobalVariableSet(g_gvDayKey + "_BLK", (double)g_srvDay);
      Log(StringFormat("GUARDA DIARIA: equity %.2f <= %.2f. Sin operaciones hasta mañana.", eq, g_dayRef * (1.0 - g_dailyGuardPct / 100.0)), "warn");
     }
   if(!g_permBlocked && eq <= g_initBal * (1.0 - g_maxGuardPct / 100.0))
     {
      g_permBlocked = true;
      GlobalVariableSet(g_gvPerm, 1.0);
      Log(StringFormat("GUARDA DD MÁXIMO: equity %.2f. EA bloqueado.", eq), "warn");
     }
   if(g_targetPct > 0 && !g_targetHit && eq >= g_initBal * (1.0 + g_targetPct / 100.0))
     {
      g_targetHit = true;
      GlobalVariableSet(g_gvTarget, 1.0);
      Log(StringFormat("OBJETIVO %.1f%% ALCANZADO: equity %.2f. EA detenido.", g_targetPct, eq), "warn");
     }
   if(g_dailyBlocked || g_permBlocked || g_targetHit) CloseAllEA();   // se reintenta hasta quedar plano
  }

//==================================================================
// ESTRATEGIAS
//==================================================================
void ResetOrb(OrbState &o, const bool weekend, const datetime dN)
  {
   o.ready = false; o.hi = 0.0; o.lo = 0.0; o.tries = 0;
   o.done  = !o.enabled || weekend || TradedToday(o.magic, dN);
  }

void NewStrategyDay(const datetime dN)
  {
   g_dayN    = dN;
   g_lmRef   = 0.0;
   g_lmTries = 0;
   int dow   = DayOfWeekN(dN);
   bool weekend = (dow == 0 || dow == 6);
   g_lmDone  = !g_lmEnable || weekend || TradedToday(g_magicLM, dN);
   ResetOrb(g_ao, weekend, dN);
   ResetOrb(g_tk, weekend, dN);
   ResetOrb(g_al, weekend, dN);
   g_r5Ready = false; g_r5Up = 0.0; g_r5Dn = 0.0; g_r5Tries = 0;
   g_r5Done  = !g_r5Enable || weekend || TradedToday(g_magicR5, dN);
   if(g_compound) GlobalVariableSet(g_gvRiskBase, g_riskBase);   // refresca la variable global para que no caduque
  }

// R50: niveles redondos alrededor del precio de las 01:05; stops virtuales a +/- buffer
void RunR50(const int mod)
  {
   if(!g_r5Enable || g_r5Done || mod < m_r5Ref) return;
   if(mod >= m_r5FillEnd || g_r5Tries >= 20) { g_r5Done = true; return; }

   if(!g_r5Ready)
     {
      double p0 = GetOpenPrice(g_dayN, m_r5Ref);
      if(p0 <= 0) { if(mod > m_r5Ref + 10) { g_r5Done = true; Log("R50: sin precio de referencia, día omitido"); } return; }
      if(!ComputeDaily()) return;
      double up = MathCeil(p0 / InpR50_Step) * InpR50_Step;
      double dn = MathFloor(p0 / InpR50_Step) * InpR50_Step;
      if(up - p0 <= 0.1 || p0 - dn <= 0.1) { g_r5Done = true; Log("R50: precio pegado a un nivel redondo, día omitido"); return; }
      g_r5Up = up + InpR50_BufATR * g_atr;
      g_r5Dn = dn - InpR50_BufATR * g_atr;
      g_r5Ready = true;
      if(mod > m_r5Ref + 1)
        {
         double hh, ll; MqlTick t0;
         if(SymbolInfoTick(_Symbol, t0) && GetRange(g_dayN, m_r5Ref, mod, hh, ll) &&
            (hh + (t0.ask - t0.bid) >= g_r5Up || ll <= g_r5Dn))
           { g_r5Done = true; Log("R50: el disparo ya se cruzó antes de activar los niveles, día omitido"); return; }
        }
      Log(StringFormat("R50: referencia %.2f  niveles %.2f / %.2f  disparos %.2f / %.2f", p0, dn, up, g_r5Dn, g_r5Up));
     }

   MqlTick tk;
   if(!SymbolInfoTick(_Symbol, tk)) return;
   int dir = 0;
   if(tk.ask >= g_r5Up)      dir = 1;
   else if(tk.bid <= g_r5Dn) dir = -1;
   if(dir == 0) return;

   if(OppositeOpen(dir)) { g_r5Done = true; Log("R50: omitido (hay una posición contraria abierta)"); return; }
   if(g_r5Tries > 0 && TradedToday(g_magicR5, g_dayN)) { g_r5Done = true; return; }
   if(PosDir(g_magicR5) != 0) { g_r5Done = true; Log("R50: omitido (posición anterior abierta)"); return; }

   if(!ComputeDaily()) return;
   int res = OpenTrade(dir, MathMax(InpR50_SL_ATR * g_atr, 0.5), InpR50_TP_R, g_magicR5, "R50");
   if(res == RES_DONE)       g_r5Done = true;
   else if(res == RES_RETRY) g_r5Tries++;
  }

void RunLM(const int mod)
  {
   if(!g_lmEnable || g_lmDone || mod < m_lmEntry) return;
   if(mod > m_lmEntry + InpLM_EntryWindowMin || g_lmTries >= 20) { g_lmDone = true; return; }

   if(g_lmTries > 0 && TradedToday(g_magicLM, g_dayN)) { g_lmDone = true; return; }   // un fallo ambiguo pudo abrirla
   if(g_lmRef <= 0) { g_lmRef = GetOpenPrice(g_dayN, m_lmOpen); if(g_lmRef <= 0) return; }   // la ventana decide

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   int dir = (bid > g_lmRef) ? 1 : ((bid < g_lmRef) ? -1 : 0);
   if(dir == 0) { g_lmDone = true; return; }
   if(OppositeOpen(dir)) { g_lmDone = true; Log("LM: omitido (hay una posición contraria abierta)"); return; }
   if(PosDir(g_magicLM) != 0) { g_lmDone = true; Log("LM: omitido (posición anterior abierta)"); return; }

   if(!ComputeDaily()) return;
   int res = OpenTrade(dir, InpLM_SL_ATR * g_atr, InpLM_TP_R, g_magicLM, "LM");
   if(res == RES_DONE)       g_lmDone = true;
   else if(res == RES_RETRY) g_lmTries++;
  }

void RunOrb(OrbState &o, const int mod)
  {
   if(!o.enabled || o.done || mod < o.end) return;
   if(mod >= o.fillEnd || o.tries >= 20) { o.done = true; return; }

   if(!o.ready)
     {
      if(!GetRange(g_dayN, o.start, o.end, o.hi, o.lo))
        {
         if(mod > o.end + 10) { o.done = true; Log(StringFormat("%s: rango sin datos, día omitido", o.name)); }
         return;
        }
      MqlTick t0;
      if(!SymbolInfoTick(_Symbol, t0)) return;
      if(o.needInside && (t0.bid >= o.hi || t0.bid <= o.lo))
        { o.done = true; Log(StringFormat("%s: el precio ya está fuera del rango al empezar, día omitido", o.name)); return; }
      if(mod > o.end)
        {
         double hh, ll;
         if(GetRange(g_dayN, o.end, mod, hh, ll) && (hh + (t0.ask - t0.bid) >= o.hi || ll <= o.lo))
           { o.done = true; Log(StringFormat("%s: la ruptura ya ocurrió antes de activar el EA, día omitido", o.name)); return; }
        }
      o.ready = true;
      Log(StringFormat("%s: rango %.2f - %.2f", o.name, o.lo, o.hi));
     }

   MqlTick tk;
   if(!SymbolInfoTick(_Symbol, tk)) return;
   int dir = 0;
   if(tk.ask >= o.hi)      dir = 1;    // buy stop virtual (se activa con el Ask)
   else if(tk.bid <= o.lo) dir = -1;   // sell stop virtual (se activa con el Bid)
   if(dir == 0) return;

   if(OppositeOpen(dir)) { o.done = true; Log(StringFormat("%s: omitido (hay una posición contraria abierta)", o.name)); return; }
   if(o.tries > 0 && TradedToday(o.magic, g_dayN)) { o.done = true; return; }   // un fallo ambiguo pudo abrirla
   if(PosDir(o.magic) != 0) { o.done = true; Log(StringFormat("%s: omitido (posición anterior abierta)", o.name)); return; }

   if(!ComputeDaily()) return;
   int res = OpenTrade(dir, MathMax(o.slAtr * g_atr, 0.5), o.tpR, o.magic, o.name);
   if(res == RES_DONE)       o.done = true;
   else if(res == RES_RETRY) o.tries++;
  }

string OrbText(const OrbState &o)
  {
   if(!o.enabled) return o.name + " off";
   return StringFormat("%s %s (%.2f / %.2f)", o.name, (o.done ? "hecho" : "pendiente"), o.lo, o.hi);
  }

void ShowPanel(const int mod)
  {
   if(MQLInfoInteger(MQL_TESTER) && !MQLInfoInteger(MQL_VISUAL_MODE)) return;
   static datetime last = 0;
   datetime now = TimeCurrent();
   if(now == last) return;
   last = now;
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   string st = g_permBlocked ? "BLOQUEADO (DD máx)" : (g_targetHit ? "OBJETIVO ALCANZADO" : (g_dailyBlocked ? "PAUSA DIARIA" : "ACTIVO"));
   string r5 = !g_r5Enable ? "R50 off" : StringFormat("R50 %s (%.2f / %.2f)", (g_r5Done ? "hecho" : "pendiente"), g_r5Dn, g_r5Up);
   string lm = !g_lmEnable ? "LM off" : StringFormat("LM %s", (g_lmDone ? "hecho" : "pendiente"));
   string cb = g_compound ? StringFormat("compuesto ON, base %.2f", g_riskBase) : StringFormat("compuesto OFF, base %.2f", g_initBal);
   Comment("Web: " + g_bridgeStatus + (g_autotrade ? "  |  Automático ON" : "  |  Automático OFF") + "\n" + StringFormat("XAU Portfolio Bridge v6.00  |  %s\n"
                        "Balance inicial %.2f  |  Equity %.2f  |  Ref. día %.2f\n"
                        "Suelo diario %.2f  |  Suelo máx %.2f  |  Freno DD x%.2f\n"
                        "ATR %.2f  |  Riesgo %.2f%% (%s)  |  Cierre por tiempo %s  |  Abiertas %d/%d\n"
                        "Hora estrategia %02d:%02d\n%s\n%s  |  %s\n%s  |  %s",
                        st, g_initBal, eq, g_dayRef,
                        g_dayRef * (1.0 - g_dailyGuardPct / 100.0), g_initBal * (1.0 - g_maxGuardPct / 100.0), RiskFactor(),
                        g_atr, g_riskPct, cb, (g_useTimeExit ? "ON" : "OFF"), CountOpenEA(), g_maxOpen,
                        mod / 60, mod % 60, r5, OrbText(g_tk), OrbText(g_ao), OrbText(g_al), lm));
  }

void Process()
  {
   datetime srv = TimeCurrent();
   if(srv <= 0) return;
   UpdateServerDay(srv);

   datetime n  = ToNorm(srv);
   datetime dN = DayStart(n);
   if(dN != g_dayN) NewStrategyDay(dN);
   int mod = MinOfDay(n);

   CheckGuards();

   // Salidas por tiempo y limpieza de posiciones de días anteriores (solo si el cierre por tiempo está activo)
   UpdateRiskBase();
   if(g_useTimeExit)
     {
      if(mod >= m_lmExit)   CloseMagic(g_magicLM);
      if(mod >= g_ao.exitM) CloseMagic(g_ao.magic);
      if(mod >= g_tk.exitM) CloseMagic(g_tk.magic);
      if(mod >= m_r5Exit)   CloseMagic(g_magicR5);
      if(mod >= g_al.exitM) CloseMagic(g_al.magic);
      CloseMagic(g_magicLM, true);
      CloseMagic(g_ao.magic, true);
      CloseMagic(g_tk.magic, true);
      CloseMagic(g_magicR5, true);
      CloseMagic(g_al.magic, true);
     }

   if(g_autotrade && !(g_permBlocked || g_targetHit || g_dailyBlocked))
     {
      // orden cronológico de las señales: R50 (01:05) -> TOK (03:30) -> AORB (04:30) -> ALB (09:00) -> LM (09:30)
      RunR50(mod);
      RunOrb(g_tk, mod);
      RunOrb(g_ao, mod);
      RunOrb(g_al, mod);
      RunLM(mod);
     }
   ShowPanel(mod);
  }

//==================================================================
// EVENTOS
//==================================================================
bool InitOrb(OrbState &o, const string name, const bool en, const long magic, const string s, const string e,
             const string fe, const string x, const double slAtr, const double tpR, const bool needInside)
  {
   o.name = name; o.enabled = en; o.magic = magic; o.needInside = needInside;
   o.start = ParseHM(s); o.end = ParseHM(e); o.fillEnd = ParseHM(fe); o.exitM = ParseHM(x);
   o.slAtr = slAtr; o.tpR = tpR;
   o.ready = false; o.done = true; o.tries = 0; o.hi = 0.0; o.lo = 0.0;
   if(o.start < 0 || o.end < 0 || o.fillEnd < 0 || o.exitM < 0) { Log(StringFormat("%s: formato de hora inválido (HH:MM)", name)); return false; }
   if(!(o.start < o.end && o.end < o.fillEnd && o.fillEnd <= o.exitM)) { Log(StringFormat("%s: las horas deben ir en orden", name)); return false; }
   if(slAtr <= 0) { Log(StringFormat("%s: SL inválido", name)); return false; }
   return true;
  }

int OnInit()
  {
   g_riskPct       = InpRiskPct;
   g_maxOpen       = InpMaxOpenTrades;
   g_useTimeExit   = InpUseTimeExit;
   g_compound      = InpCompound;
   g_dailyGuardPct = InpDailyGuardPct;
   g_maxGuardPct   = InpMaxGuardPct;
   g_targetPct     = InpTargetPct;
   g_lmEnable      = InpLM_Enable;
   g_r5Enable      = InpR50_Enable;
   g_autotrade     = InpAutoTrade;
   g_lastBarSrv    = -1;
   g_settingsTs    = 0;
   g_backfillQueued = false;
   m_lmOpen  = ParseHM(InpLM_OpenTime);
   m_lmEntry = ParseHM(InpLM_EntryTime);
   m_lmExit  = ParseHM(InpLM_ExitTime);
   if(m_lmOpen < 0 || m_lmEntry < 0 || m_lmExit < 0)
     { Log("LM: formato de hora inválido (usar HH:MM)"); return INIT_PARAMETERS_INCORRECT; }
   if(!(m_lmOpen < m_lmEntry && m_lmEntry < m_lmExit))
     { Log("LM: las horas deben ir en orden dentro del mismo día"); return INIT_PARAMETERS_INCORRECT; }
   if(InpMinLotTol < 1.0 || InpMinLotTol > 3.0)
     { Log("InpMinLotTol fuera de rango (1-3)"); return INIT_PARAMETERS_INCORRECT; }
   if(g_riskPct <= 0 || g_riskPct > 3.0)
     { Log("Riesgo por operación fuera de rango (0-3%)"); return INIT_PARAMETERS_INCORRECT; }
   if(InpATRPeriod < 2 || InpATRPeriod > 30) { Log("Periodo ATR fuera de rango (2-30)"); return INIT_PARAMETERS_INCORRECT; }
   if(g_maxOpen < 0 || g_maxOpen > 20) { Log("InpMaxOpenTrades fuera de rango (0-20)"); return INIT_PARAMETERS_INCORRECT; }
   if(InpCompoundUpPct <= 0 || InpCompoundDnPct <= 0 || InpCompoundUpPct > 50 || InpCompoundDnPct > 50)
     { Log("Pasos del interés compuesto fuera de rango"); return INIT_PARAMETERS_INCORRECT; }
   if(!g_useTimeExit)
     {
      if(InpNoTimeExitTP_R <= 0) { Log("Sin cierre por tiempo hace falta InpNoTimeExitTP_R > 0"); return INIT_PARAMETERS_INCORRECT; }
      Log("AVISO: cierre por tiempo desactivado. Las operaciones solo se cierran por SL o TP y pueden quedar abiertas de noche o el fin de semana (swaps y gaps). El backtest se validó con cierre por tiempo.", "warn");
     }
   if(StringFind(_Symbol, "XAU") < 0 && StringFind(_Symbol, "GOLD") < 0)
      Log("Aviso: el EA está diseñado y probado solo para XAUUSD", "warn");

   g_magicLM = InpMagic + 1;
   if(!InitOrb(g_ao, "AORB", InpAO_Enable, InpMagic + 2, InpAO_RangeStart, InpAO_RangeEnd, InpAO_ExitTime, InpAO_ExitTime, InpAO_SL_ATR, InpAO_TP_R, false))
      return INIT_PARAMETERS_INCORRECT;
   g_magicR5   = InpMagic + 4;
   m_r5Ref     = ParseHM(InpR50_RefTime);
   m_r5FillEnd = ParseHM(InpR50_FillEnd);
   m_r5Exit    = ParseHM(InpR50_ExitTime);
   if(m_r5Ref < 0 || m_r5FillEnd < 0 || m_r5Exit < 0 || !(m_r5Ref < m_r5FillEnd && m_r5FillEnd <= m_r5Exit))
     { Log("R50: horas inválidas o fuera de orden"); return INIT_PARAMETERS_INCORRECT; }
   if(InpR50_Step <= 0 || InpR50_SL_ATR <= 0)
     { Log("R50: parámetros fuera de rango"); return INIT_PARAMETERS_INCORRECT; }
   if(!InitOrb(g_tk, "TOK", InpTK_Enable, InpMagic + 3, InpTK_RangeStart, InpTK_RangeEnd, InpTK_ExitTime, InpTK_ExitTime, InpTK_SL_ATR, InpTK_TP_R, false))
      return INIT_PARAMETERS_INCORRECT;
   if(!InitOrb(g_al, "ALB", InpAL_Enable, InpMagic + 5, InpAL_RangeStart, InpAL_RangeEnd, InpAL_FillEnd, InpAL_ExitTime, InpAL_SL_ATR, InpAL_TP_R, true))
      return INIT_PARAMETERS_INCORRECT;

   if((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
     { Log("Este EA requiere una cuenta hedging: cada estrategia usa su propia posición"); return INIT_FAILED; }

   trade.SetDeviationInPoints(InpSlippagePts);
   trade.SetTypeFillingBySymbol(_Symbol);

   string key = "XGP_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "_" + IntegerToString(InpMagic) + "_";
   g_gvInit   = key + "INIT";
   g_gvPerm   = key + "PERM";
   g_gvTarget = key + "TGT";
   g_gvDayKey = key + "DKEY";
   g_gvDayRef = key + "DREF";
   g_gvRiskBase = key + "RBASE";

   string gvRid = key + "RID";
   if(InpResetId > 0 && (!GlobalVariableCheck(gvRid) || (int)GlobalVariableGet(gvRid) != InpResetId))
     {
      GlobalVariableDel(g_gvInit);
      GlobalVariableDel(g_gvPerm);
      GlobalVariableDel(g_gvTarget);
      GlobalVariableDel(g_gvDayKey);
      GlobalVariableDel(g_gvDayRef);
      GlobalVariableDel(g_gvDayKey + "_BLK");
      GlobalVariableDel(g_gvRiskBase);
      GlobalVariableSet(gvRid, (double)InpResetId);
      Log("Bloqueos y balance inicial guardados borrados (ResetId " + (string)(InpResetId) + ")");
     }

   if(InpInitialBalance > 0)              g_initBal = InpInitialBalance;
   else if(GlobalVariableCheck(g_gvInit)) g_initBal = GlobalVariableGet(g_gvInit);
   else if(!MQLInfoInteger(MQL_TESTER))
     { Log("Indica InpInitialBalance (balance inicial de la cuenta de fondeo)"); return INIT_PARAMETERS_INCORRECT; }
   else
     {
      g_initBal = AccountInfoDouble(ACCOUNT_BALANCE);
      GlobalVariableSet(g_gvInit, g_initBal);
     }

   g_riskBase = (GlobalVariableCheck(g_gvRiskBase) && GlobalVariableGet(g_gvRiskBase) > 0) ? GlobalVariableGet(g_gvRiskBase) : g_initBal;
   if(!GlobalVariableCheck(g_gvRiskBase)) GlobalVariableSet(g_gvRiskBase, g_riskBase);
   g_permBlocked = GlobalVariableCheck(g_gvPerm)   && GlobalVariableGet(g_gvPerm)   > 0;
   g_targetHit   = GlobalVariableCheck(g_gvTarget) && GlobalVariableGet(g_gvTarget) > 0;

   g_srvDay = 0;
   g_dayN   = 0;
   g_calcDay = 0;
   EventSetMillisecondTimer(500);
   if(InpWebEnable && InpBridgeKey == "")
      Log("Falta InpBridgeKey: crea la cuenta en la web, copia su clave en las entradas del EA y vuelve a cargarlo.", "warn");
   if(InpWebEnable && !MQLInfoInteger(MQL_TESTER))
      Log("Conectando con la web. Si no conecta, añade " + InpWebURL + " en Herramientas → Opciones → Asesores expertos → Permitir WebRequest.");
   Log(StringFormat("XAU Portfolio Bridge v6 iniciado. Balance inicial %.2f, riesgo %.2f%%", g_initBal, g_riskPct));
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }

void OnTick()  { Process(); }
void OnTimer() { Process(); BridgeSync(); }
//+------------------------------------------------------------------+
