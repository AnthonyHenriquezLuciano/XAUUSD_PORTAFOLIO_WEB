/** Saved visual workspace presets (client-only; never trading commands).
 * Avoid storing credentials, data history or private account details.
 */
const STORAGE="xauai.workspaces.v4";
export type VisualWorkspace={id:string;name:string;tf:string;theme:string;
  layers:Record<string,boolean>;flow:{mode:string;scope:string;focus:string;bins:number};
  forecast:boolean;createdAt:number;};
export function readWorkspaces():VisualWorkspace[]{
 try{
  const a=JSON.parse(localStorage.getItem(STORAGE)||"[]");
  if(!Array.isArray(a))return [];
  return a.filter((x:any)=>x&&typeof x.name==="string"&&x.name.length<=32&&typeof x.id==="string"
     &&typeof x.tf==="string"&&typeof x.theme==="string"&&x.layers&&typeof x.layers==="object").slice(0,8);
 }catch{return [];}
}
export function writeWorkspace(ws:VisualWorkspace):VisualWorkspace[]{
 const rest=readWorkspaces().filter(x=>x.id!==ws.id);
 const all=[ws,...rest].slice(0,8);
 try{localStorage.setItem(STORAGE,JSON.stringify(all));}catch{/* optional */}
 return all;
}
export function removeWorkspace(id:string):VisualWorkspace[]{
 const rest=readWorkspaces().filter(x=>x.id!==id);
 try{localStorage.setItem(STORAGE,JSON.stringify(rest));}catch{/* optional */}
 return rest;
}
export function readViewport(key:string):{from:number;to:number}|null{
 try{const p=JSON.parse(sessionStorage.getItem("xauai.view.v4:"+key)||"null");
   return p&&Number.isFinite(p.from)&&Number.isFinite(p.to)&&p.to>p.from?{from:p.from,to:p.to}:null;
 }catch{return null;}
}
export function writeViewport(key:string,view:{from:number;to:number}|null){
 try{if(view)sessionStorage.setItem("xauai.view.v4:"+key,JSON.stringify(view));}catch{/* optional */}
}
