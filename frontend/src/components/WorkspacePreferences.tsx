import React,{useEffect,useState} from "react";
import { Icon } from "../icons";
import { useUI } from "../uiState";
type Density = "comfortable" | "compact";
const KEY = "xauai.workspace.density";
const getDensity = ():Density => {
  try{return localStorage.getItem(KEY)==="compact"?"compact":"comfortable";}
  catch{return "comfortable";}
};
export function useWorkspacePreferences(){
 const ui=useUI();
 const [density,setDensityState]=useState<Density>(getDensity);
 const [helpOpen,setHelpOpen]=useState(false);
 const setDensity=(next:Density)=>{
   setDensityState(next);
   try{localStorage.setItem(KEY,next);}catch{/* optional */}
 };
 useEffect(()=>{
   const onKey=(e:KeyboardEvent)=>{
     if(e.key==="Escape"){setHelpOpen(false);return;}
     const t=e.target;
     if(t instanceof HTMLElement && (t.matches("input,textarea,select") || t.isContentEditable))return;
     if(e.key==="?" && !e.altKey && !e.ctrlKey && !e.metaKey){e.preventDefault();setHelpOpen(x=>!x);return;}
     if(!(e.altKey && e.shiftKey) || e.ctrlKey || e.metaKey)return;
     const target:Record<string,string>={Digit1:"centro",Digit2:"operar",Digit3:"flujo",Digit4:"ciencia",Digit5:"portafolio"};
     const next=target[e.code];
     if(next){e.preventDefault();ui.setTab(next);setHelpOpen(false);}
   };
   window.addEventListener("keydown",onKey);
   return ()=>window.removeEventListener("keydown",onKey);
 },[ui.setTab]);
 return {density,setDensity,helpOpen,setHelpOpen};
}
export function WorkspaceControls({density,onDensity,onHelp}:{
 density:Density;onDensity:(next:Density)=>void;onHelp:()=>void
}){
 return <div className="workspace-controls" aria-label="Preferencias de visualización">
   <button type="button" className="workspace-control" aria-pressed={density==="compact"}
     onClick={()=>onDensity(density==="compact"?"comfortable":"compact")}
     title="Cambiar densidad visual">
     <Icon name="settings" size={15}/><span>{density==="compact"?"Vista compacta":"Vista cómoda"}</span>
   </button>
   <button type="button" className="workspace-control" onClick={onHelp} aria-label="Ver atajos de teclado" title="Atajos de teclado">
     <Icon name="info" size={16}/><span>Atajos</span>
   </button>
 </div>;
}
const KEYS:[string,string][]=[
 ["Alt + Mayús + 1","Vista general"],["Alt + Mayús + 2","Trading Desk"],
 ["Alt + Mayús + 3","Order Flow"],["Alt + Mayús + 4","Investigación de mercado"],
 ["Alt + Mayús + 5","Portafolio"],["?","Mostrar u ocultar ayuda"],
 ["Esc","Cerrar ayuda"]
];
export function ShortcutHelp({open,onClose}:{open:boolean;onClose:()=>void}){
 const closeRef=React.useRef<HTMLButtonElement>(null);
 useEffect(()=>{
   if(open)closeRef.current?.focus();
 },[open]);
 if(!open)return null;
 return <div className="shortcut-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
   <section role="dialog" aria-modal="true" aria-labelledby="shortcut-title" className="shortcut-dialog">
     <div className="shortcut-header">
       <div><span className="desk-eyebrow">ACCESIBILIDAD / WORKSPACE</span><h2 id="shortcut-title">Atajos de teclado</h2></div>
       <button ref={closeRef} type="button" aria-label="Cerrar ayuda" className="btn sm" onClick={onClose}>Cerrar</button>
     </div>
     <p>Navega entre tus herramientas principales sin apartarte del análisis de mercado.</p>
     <div className="shortcut-keys">{KEYS.map(([key,label])=><div key={key}><span>{label}</span><kbd>{key}</kbd></div>)}</div>
     <p className="premium-note">Los atajos se desactivan mientras escribes en campos de texto. Si tu navegador reserva una combinación, utiliza la navegación normal.</p>
   </section>
 </div>;
}
