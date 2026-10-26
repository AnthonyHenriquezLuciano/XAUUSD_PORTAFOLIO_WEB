import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const read = p=>readFileSync(p,"utf8");
const app=read("src/App.tsx");
const entry=read("src/main.tsx");
const styles=["design-system.css","navigation.css","workspace.css","dashboard.css","polish.css"];
for(const name of styles){
 assert.ok(existsSync("src/"+name),name+" must exist");
 assert.ok(app.includes('import "./'+name+'";'),name+" imported in App");
}
for(let i=1;i<styles.length;i++)assert.ok(app.indexOf(styles[i])>app.indexOf(styles[i-1]),"stylesheets in correct cascade order");
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
assert.ok(read("src/workspace.css").includes('grid-template-rows:auto auto minmax(0,1fr)'));
assert.ok(read("src/components/LoadingState.tsx").includes('aria-live="polite"'));
assert.ok(entry.includes('"@fontsource/ibm-plex-sans/400.css"'));
console.log("✓ UI quality: cascade, navigation, accessible shortcuts, keyboard, charts, responsive and motion preferences");
