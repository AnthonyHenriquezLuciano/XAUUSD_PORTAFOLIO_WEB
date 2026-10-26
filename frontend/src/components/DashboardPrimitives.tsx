import React from "react";

export type MetricTone = "neutral" | "positive" | "negative" | "gold" | "caution";
export type MetricEvidence = "direct" | "estimated" | "historical" | "unverified";
const EVIDENCE:Record<MetricEvidence,string> = {
  direct:"Dato sincronizado",estimated:"Estimación",historical:"Dato histórico",unverified:"Sin verificar"
};
/** Semantic metric: label, accessible numeric value, provenance and context.
 * Monetary values must be preformatted by the calling page.
 */
export function MetricCard({label,value,detail,tone="neutral",evidence,compact=false}:{
  label:string;value:React.ReactNode;detail?:React.ReactNode;
  tone?:MetricTone;evidence?:MetricEvidence;compact?:boolean;
}){
 return <div className={`institutional-metric ${tone} ${compact?"compact":""}`}>
   <span className="institutional-metric-label">{label}</span>
   <strong className="institutional-metric-value">{value}</strong>
   {(detail||evidence)&&<div className="institutional-metric-footer">
    {detail&&<span className="institutional-metric-detail">{detail}</span>}
    {evidence&&<span className="institutional-metric-source" title={"Origen del dato: "+EVIDENCE[evidence]}>{EVIDENCE[evidence]}</span>}
   </div>}
 </div>;
}
export function SectionHeading({eyebrow,title,description,right}:{
 eyebrow?:string;title:string;description?:string;right?:React.ReactNode;
}){
 return <header className="institutional-section-heading">
   <div>{eyebrow&&<span className="institutional-section-eyebrow">{eyebrow}</span>}
     <h2>{title}</h2>{description&&<p>{description}</p>}</div>
   {right&&<div className="institutional-section-actions">{right}</div>}
 </header>;
}
