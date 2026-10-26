/** Restore chart view after a historical refresh without dragging a trader
 * back to latest prices (or to the beginning of a 30-day history).
 * Only change TF/account resets a range. No trading/data side effects.
 */
import type { IChartApi, IRange, Logical, Time } from "lightweight-charts";
export type ViewportSnapshot = { follow:boolean; time:IRange<Time>|null; logical:IRange<Logical>|null; width:number };
const RANGE=160;
export function captureViewport(chart:IChartApi,oldCount:number):ViewportSnapshot {
 const scale=chart.timeScale(),logical=scale.getVisibleLogicalRange(),time=scale.getVisibleRange();
 const width=logical?Number(logical.to)-Number(logical.from):RANGE;
 const follow=!logical || Number(logical.to)>=oldCount-1.5;
 return {follow,time,logical,width:Number.isFinite(width)&&width>10?width:RANGE};
}
export function restoreViewport(chart:IChartApi,snapshot:ViewportSnapshot|null,n:number,reset:boolean):void {
 if(n<=0)return;
 const scale=chart.timeScale();
 if(reset||!snapshot){
   scale.setVisibleLogicalRange({from:Math.max(-2,n-RANGE),to:n+8} as IRange<Logical>);
   return;
 }
 if(snapshot.follow){
   // Retain the zoom while following the rightmost candles.
   scale.setVisibleLogicalRange({from:n-snapshot.width+8,to:n+8} as IRange<Logical>);
   return;
 }
 if(snapshot.time){
   try {scale.setVisibleRange(snapshot.time);return;}catch{/* old range outside loaded history */}
 }
 if(snapshot.logical)scale.setVisibleLogicalRange(snapshot.logical);
}
