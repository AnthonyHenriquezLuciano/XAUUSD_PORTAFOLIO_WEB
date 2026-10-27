/** The trader owns the viewport.
 * Live-follow is an explicit mode, not inferred from being near the last candle.
 * setData is only used for first load / historical revisions.
 */
import type {IChartApi,Range,Logical,Time} from "lightweight-charts";
export type ViewportSnapshot={
  follow:boolean;time:Range<Time>|null;logical:Range<Logical>|null;width:number
};
const DEFAULT_WINDOW=160,RIGHT_PAD=9;
export function captureViewport(chart:IChartApi,_oldCount:number,follow=false):ViewportSnapshot {
 const scale=chart.timeScale(),logical=scale.getVisibleLogicalRange(),time=scale.getVisibleRange();
 const width=logical?Number(logical.to)-Number(logical.from):DEFAULT_WINDOW;
 return {follow,time,logical,width:Number.isFinite(width)&&width>10?width:DEFAULT_WINDOW};
}
export function restoreViewport(chart:IChartApi,snapshot:ViewportSnapshot|null,n:number,reset:boolean):void {
 if(n<=0)return;
 const scale=chart.timeScale();
 if(reset||!snapshot){
   scale.setVisibleLogicalRange({from:Math.max(-2,n-DEFAULT_WINDOW),to:n+RIGHT_PAD} as Range<Logical>);
   return;
 }
 if(snapshot.follow){
   scale.setVisibleLogicalRange({
     from:n-snapshot.width+RIGHT_PAD,to:n+RIGHT_PAD
   } as Range<Logical>);
   return;
 }
 // Preserve the actual historical timestamps across a sliding server window.
 // If the full period isn't present anymore, keep the oldest available interval.
 if(snapshot.time) {
   try {scale.setVisibleRange(snapshot.time);return;}catch{/* older bars aged out */}
 }
 if(snapshot.logical)scale.setVisibleLogicalRange(snapshot.logical);
}
