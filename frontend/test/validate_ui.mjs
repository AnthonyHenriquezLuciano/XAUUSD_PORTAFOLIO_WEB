import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const read = p=>readFileSync(p,"utf8");
const app=read("src/App.tsx");
const entry=read("src/main.tsx");
// All stylesheets must be imported by the same entrypoint: nested App imports
// previously got overridden by a late styles.css import, collapsing the chart.
const styles=["styles.css","premium.css","flow/flow.css","design-system.css","navigation.css","workspace.css","dashboard.css","polish.css"];
for(const name of styles){
 assert.ok(existsSync("src/"+name),name+" must exist");
 assert.ok(entry.includes('import "./'+name+'";'),name+" imported from main.tsx");
 assert.ok(!app.includes('import "./'+name+'";'),name+" must not be re-imported by App");
}
for(let i=1;i<styles.length;i++)assert.ok(entry.indexOf('import "./'+styles[i]+'";')>entry.indexOf('import "./'+styles[i-1]+'";'),"stylesheets must follow the intended cascade order");
for(const route of ["centro","operar","mercado","flujo","sesiones","estrategias","lab","stats","diario","ciencia","portafolio","seguridad","ajustes"])
 assert.ok(app.includes('key: "'+route+'"'),"navigation "+route);
assert.ok(app.includes('aria-label="Más secciones"'));
assert.ok(app.includes('aria-controls="mobile-navigation"'));
assert.ok(app.includes('id="workspace-main"'));
assert.ok(app.includes('className="skip-to-content"'));
assert.ok(app.includes('<ShortcutHelp open={prefs.helpOpen}'));
assert.ok(app.includes('prefs.density==="compact"'));
assert.ok(read("src/components/WorkspacePreferences.tsx").includes('Alt + Mayús + 1'));
assert.ok(read("src/components/WorkspacePreferences.tsx").includes('localStorage.setItem(KEY,next)'));
assert.ok(read("src/components/WorkspacePreferences.tsx").includes('aria-modal="true"'));
assert.ok(read("src/components/WorkspacePreferences.tsx").includes('e.key==="Tab"'));
assert.ok(read("src/ui.tsx").includes('role="radiogroup"'));
assert.ok(read("src/ui.tsx").includes('ArrowRight'));
assert.ok(read("src/polish.css").includes('prefers-reduced-motion:reduce'));
assert.ok(read("src/polish.css").includes('prefers-reduced-motion:no-preference'));
assert.ok(read("src/workspace.css").includes('grid-template-areas:"instrument" "controls" "canvas"'),"workspace reserves header / tools / canvas independently");
assert.ok(read("src/styles.css").includes('grid-template-rows: auto auto minmax(0, 1fr)'),"base stylesheet protects third chart row");
assert.ok(read("src/components/Chart.tsx").includes('new ResizeObserver('),"chart resizes after layout changes");
assert.ok(read("src/components/Chart.tsx").includes('chart-data-state'),"chart displays failure and missing-bars states");
assert.ok(read("src/components/Chart.tsx").includes('Reintentar carga'),"chart can reload its historical data");
// Inspect actual Vite CSS output to catch a regression hidden by successful TS builds.
import { readdirSync } from "node:fs";
const compiled = readdirSync("dist/assets").filter(x=>x.endsWith(".css"))
  .map(x=>read("dist/assets/"+x)).join("\n");
assert.ok(compiled.length>1000,"compiled CSS must exist");
const gridRules = [...compiled.matchAll(/\\.chartwrap\\s*\\{([^}]*grid-template-rows:[^}]*)\\}/g)]
 .map(x=>x[1]);
assert.ok(gridRules.length>0,"compiled CSS contains explicit chart grid tracks");
const lastGrid=gridRules[gridRules.length-1];
assert.ok(!/grid-template-rows:\\s*auto\\s+1fr/.test(lastGrid),
 "regression: compiled CSS leaves toolbar in full-height second row");
assert.ok(/grid-template-rows:\\s*(?:auto|min-content)\\s+(?:auto|min-content)\\s+minmax\\(0,\\s*1fr\\)/.test(lastGrid),
 "compiled CSS must contain three tracks and a flexible plot");
assert.ok(read("src/components/LoadingState.tsx").includes('aria-live="polite"'));
assert.ok(entry.includes('"@fontsource/ibm-plex-sans/400.css"'));
console.log("✓ UI quality: cascade, navigation, accessible shortcuts, keyboard, charts, responsive and motion preferences");
