/** Incremental MT5 history reconciliation.
 * setData() is a destructive full-series replacement: avoid it during
 * normal polling because it reflows the timeline under a user's hand.
 * Corrections inside the historic portion do require a replacement.
 */
export type ChartBar = {time:number;open:number;high:number;low:number;close:number;volume:number};
export type HistoryChange =
  | {kind:"unchanged"; updates:[]}
  | {kind:"incremental"; updates:ChartBar[]}
  | {kind:"replace"; updates:ChartBar[]};
const same=(a:ChartBar,b:ChartBar)=>
  a.time===b.time&&a.open===b.open&&a.high===b.high&&a.low===b.low&&a.close===b.close&&a.volume===b.volume;
export function historyChange(oldBars:readonly ChartBar[],nextBars:readonly ChartBar[]):HistoryChange {
  if(!nextBars.length)return {kind:oldBars.length?"replace":"unchanged",updates:[...nextBars]} as HistoryChange;
  if(!oldBars.length)return {kind:"replace",updates:[...nextBars]};
  // The broker's rolling 3000-bar window may drop the oldest bars.
  // Treat shifting history and actual historical corrections as replacements.
  if(nextBars[0].time!==oldBars[0].time)return {kind:"replace",updates:[...nextBars]};
  const overlap=Math.min(oldBars.length,nextBars.length);
  if(nextBars.length<oldBars.length)return {kind:"replace",updates:[...nextBars]};
  for(let i=0;i<overlap-1;i++)if(!same(oldBars[i],nextBars[i]))return {kind:"replace",updates:[...nextBars]};
  // Only the final candle may be revised in-place, followed by new candles.
  const changedLast=!same(oldBars[overlap-1],nextBars[overlap-1]);
  const start=changedLast?overlap-1:overlap;
  if(start>=nextBars.length)return {kind:"unchanged",updates:[]};
  if(nextBars.slice(start).some((x,i)=>i>0&&x.time<=nextBars[start+i-1].time))
    return {kind:"replace",updates:[...nextBars]};
  return {kind:"incremental",updates:nextBars.slice(start)};
}
export function mergeCurrentTick<T extends ChartBar>(
  loaded:T[],lastTick:ChartBar|null,currentTickTime:number|undefined,periodSec:number
):T[] {
  if(!loaded.length||!lastTick)return loaded;
  const tickBucket=typeof currentTickTime==="number"?Math.floor(currentTickTime/periodSec)*periodSec:null;
  if(tickBucket!==lastTick.time)return loaded;
  const last=loaded[loaded.length-1];
  if(lastTick.time<last.time)return loaded;
  if(lastTick.time===last.time){
    loaded[loaded.length-1]={...last,high:Math.max(last.high,lastTick.high),
      low:Math.min(last.low,lastTick.low),close:lastTick.close};
  }else{
    loaded.push({...lastTick,volume:0} as T);
  }
  return loaded;
}
