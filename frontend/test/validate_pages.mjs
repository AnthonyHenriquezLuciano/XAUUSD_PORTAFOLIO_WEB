import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
const repo = process.env.GITHUB_REPOSITORY?.split("/")[1] || "XAUUSD_PORTAFOLIO_WEB";
const base = "/" + repo + "/";
const html = readFileSync("dist/index.html", "utf8");
assert.ok(html.includes(`src="${base}assets/`), "Vite JS entry must include repository base path");
assert.ok(html.includes(`href="${base}assets/`), "Vite stylesheet must include repository base path");
assert.ok(!html.includes('src="/assets/'), "JS should never point to root /assets");
assert.ok(!html.includes('href="/assets/'), "CSS should never point to root /assets");
for (const file of ["dist/demo/demo_data.json", "dist/ai/models.json", "dist/ea/XAU_Portfolio_Bridge_v6.mq5"]) {
  assert.ok(existsSync(file), "Required public asset must be copied: " + file);
}
for(const [file, needle] of [
  ["src/demo/sim.ts", "${import.meta.env.BASE_URL}demo/demo_data.json"],
  ["src/ai/model.ts", "${import.meta.env.BASE_URL}ai/models.json"],
  ["src/components/AccountDialog.tsx", "${import.meta.env.BASE_URL}ea/XAU_Portfolio_Bridge_v6.mq5"],
  ["src/auth.tsx", "import.meta.env.BASE_URL"],
]) {
  assert.ok(readFileSync(file,"utf8").includes(needle),file+" must use base-aware paths");
}
console.log("✓ GitHub Pages: repository base, asset locations and Supabase redirect paths valid");
