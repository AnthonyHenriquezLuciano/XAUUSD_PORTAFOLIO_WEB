import React from "react";
/** Accessible loading indicator with no placeholder market numbers. */
export default function LoadingState({label="Actualizando información…"}:{label?:string}){
 return <div className="workspace-loading" role="status" aria-live="polite" aria-label={label}>
   <div className="workspace-loading-icon" aria-hidden="true"><span/><span/><span/></div>
   <span>{label}</span>
 </div>;
}
