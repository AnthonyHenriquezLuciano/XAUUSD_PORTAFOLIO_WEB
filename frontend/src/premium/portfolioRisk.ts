/** Consolidated, read-only risk estimates for several *owned/linked* MT5 accounts.
 * Never emits trading commands. Do not sum accounts of different currencies.
 */
export type OwnedAccount = { id:string;name:string;login?:number;server?:string;symbol?:string };
export type LiveRow = {account_id:string;balance?:number|null;equity?:number|null;bid?:number|null;ask?:number|null;updated_at?:string;open?:boolean|null };
export type StateRow = {account_id:string;account?:any;risk?:any;ea?:any;positions?:any[];orders?:any[]};
export type PortfolioRow = {
 id:string;name:string;currency:string;balance:number|null;equity:number|null;dailyBuffer:number|null;maxBuffer:number|null;
 stopRisk:number|null;positions:number;unprotected:number;pending:number;contract:number|null;
 connected:boolean;secondsStale:number|null;blocked:string|null;server:string;unknown:boolean;
};
export function summarizeAccount(a:OwnedAccount,l:LiveRow|undefined,s:StateRow|undefined,nowMs=Date.now()):PortfolioRow {
 const obj=s?.account||{},risk=s?.risk||{},ea=s?.ea||{};
 const equity=Number(l?.equity ?? obj.equity ?? NaN),balance=Number(l?.balance ?? obj.balance ?? NaN);
 const daily=Number(risk.daily_floor??NaN),maximum=Number(risk.max_floor??NaN),contract=Number(ea.contract??NaN);
 const bid=Number(l?.bid??NaN),ask=Number(l?.ask??NaN);
 const positions=Array.isArray(s?.positions)?s!.positions!:[],orders=Array.isArray(s?.orders)?s!.orders!:[];
 let stopRisk=0,unprotected=0;
 for(const p of positions) {
   const lots=Number(p.volume),stop=Number(p.sl),side=Number(p.side);
   if(!(lots>0)||!(stop>0)||![1,-1].includes(side)||!Number.isFinite(contract)||contract<=0||
      !Number.isFinite(bid)||!Number.isFinite(ask)) {unprotected++;continue;}
   const against=side>0?bid-stop:stop-ask;
   if(against<0){unprotected++;continue;}
   stopRisk+=Math.max(0,against)*lots*contract;
 }
 const sec=l?.updated_at?(nowMs-Date.parse(l.updated_at))/1000:null;
 const stale=sec==null||!Number.isFinite(sec)?null:Math.max(0,Math.round(sec));
 const dataOk=Number.isFinite(equity)&&equity>0;
 return {
  id:a.id,name:a.name,currency:obj.currency||"Sin divisa",
  balance:Number.isFinite(balance)?balance:null,equity:dataOk?equity:null,
  dailyBuffer:dataOk&&Number.isFinite(daily)?Math.max(0,equity-daily):null,
  maxBuffer:dataOk&&Number.isFinite(maximum)?Math.max(0,equity-maximum):null,
  stopRisk:unprotected===0&&positions.length?Math.round(stopRisk*100)/100:positions.length?null:0,
  positions:positions.length,unprotected,pending:orders.length,
  contract:Number.isFinite(contract)&&contract>0?contract:null,
  connected:stale!==null&&stale<=15,
  secondsStale:stale,blocked:risk.blocked||null,
  server:a.server||obj.server||"—",
  unknown:!dataOk||stale===null||stale>15
 };
}
export function portfolioTotals(rows:PortfolioRow[]) {
 const usd=rows.filter(x=>x.currency==="USD");
 const sum=(key:"balance"|"equity"|"dailyBuffer"|"maxBuffer"|"stopRisk")=>{
   const a=usd.map(x=>x[key]);
   return a.some(x=>x===null)?null:a.reduce<number>((total,x)=>total+(x??0),0);
 };
 return {
   accounts:rows.length,usdAccounts:usd.length,excluded:rows.length-usd.length,connected:rows.filter(x=>x.connected).length,
   blocked:rows.filter(x=>!!x.blocked).length,unprotected:rows.reduce((sum,x)=>sum+x.unprotected,0),
   balanceUsd:sum("balance"),equityUsd:sum("equity"),dailyBufferUsd:sum("dailyBuffer"),
   maxBufferUsd:sum("maxBuffer"),stopRiskUsd:sum("stopRisk"),
   estimatedAvailableUsd:rows.some(x=>x.unknown)||rows.some(x=>x.unprotected)?null:
     sum("stopRisk")!==null&&sum("dailyBuffer")!==null&&sum("maxBuffer")!==null?
       Math.max(0,Math.min(sum("dailyBuffer")!,sum("maxBuffer")!)-sum("stopRisk")!):null
 };
}
