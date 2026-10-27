/** Session-scoped bounded chart history cache.
 * Account-specific keys; never contains secrets and never leaks across accounts.
 * Memory + sessionStorage are best-effort, with strict TTL and size limits.
 */
import type {ChartBar} from "./historySync";
const TTL=10*60*1000,STORE="xauai.chart.history.v4";
type Entry={updated:number;bars:ChartBar[]};
const memo=new Map<string,Entry>();
const clean=(bars:ChartBar[]):ChartBar[]=>bars.filter(b=>Number.isFinite(b.time)&&
  [b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)).slice(-3000);
export function cacheKey(account:string,tf:string){return account+"::"+tf;}
export function cacheGet(key:string):ChartBar[]|null{
 let item=memo.get(key);
 if(!item){
   try{const raw=sessionStorage.getItem(STORE+":"+key);if(raw)item=JSON.parse(raw) as Entry;}catch{/* storage optional */}
 }
 if(!item||Date.now()-item.updated>TTL){memo.delete(key);return null;}
 memo.set(key,item);return clean(item.bars);
}
export function cachePut(key:string,bars:ChartBar[]){
 const b=clean(bars),item:Entry={updated:Date.now(),bars:b};
 memo.delete(key);memo.set(key,item);
 while(memo.size>6)memo.delete(memo.keys().next().value!);
 try{sessionStorage.setItem(STORE+":"+key,JSON.stringify({...item,bars:b.slice(-1200)}));}catch{/* browser storage is optional */}
}
export function cacheClear(key:string){memo.delete(key);try{sessionStorage.removeItem(STORE+":"+key);}catch{/* optional */}}
/** Merge time-ordered server pages; a newer page wins on overlapping timestamps. */
export function mergePages(older:readonly ChartBar[],newer:readonly ChartBar[]):ChartBar[]{
 const result=new Map<number,ChartBar>();
 for(const b of older)if(Number.isFinite(b.time))result.set(Number(b.time),b);
 for(const b of newer)if(Number.isFinite(b.time))result.set(Number(b.time),b);
 return [...result.values()].sort((a,b)=>a.time-b.time).slice(-12000);
}
export const HISTORICAL_PAGE_SIZE=700,INITIAL_SIZE=900;
