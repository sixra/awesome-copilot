import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeColorScheme } from "./capture.mjs";

const asset = (name) => readFile(new URL(`./assets/${name}`, import.meta.url), "utf8");

test("color scheme is validated", () => {
  assert.equal(normalizeColorScheme("dark"), "dark");
  assert.equal(normalizeColorScheme("light"), "light");
  assert.throws(() => normalizeColorScheme("neon"));
});

test("preview toolbar wires a single Preview/Raw toggle before Download", async () => {
  const app = await asset("app.js");
  assert.ok(app.indexOf('class="preview-mode"') < app.indexOf('id="preview-download"'));
  assert.match(app, /view=raw/);
  assert.match(app, /renderRawPreview/);
  assert.equal((app.match(/class="preview-mode"/g) ?? []).length, 1);
});

test("browser view syncs theme on load/change and exposes native open", async () => {
  const browser = await asset("browser.js");
  assert.match(browser, /data-theme-aware-preview/);
  assert.match(browser, /\/api\/browser\/owned/);
  assert.match(browser, /id="br-open-external"/);
  assert.match(browser, /\/api\/browser\/open-external/);
  assert.match(browser, /observeCanvasTheme\(/);
  assert.match(browser, /stopThemeObserver\(\)/);
  assert.match(browser, /theme: resolvedCanvasTheme\(\)/);
});

test("theme observer covers root+body attributes, color-scheme and media changes without silent failures", async () => {
  const app = await asset("app.js");
  assert.match(app, /THEME_ATTRIBUTES/);
  assert.match(app, /observe\(document\.body/);
  assert.match(app, /previewThemeMedia\.addEventListener\("change"/);
  assert.match(app, /color-scheme|colorScheme/);
  assert.match(app, /theme === last/);
  const themeBlock = app.slice(app.indexOf("function resolvedCanvasTheme"), app.indexOf("function installPreviewThemeSync"));
  assert.doesNotMatch(themeBlock, /catch\(\(\)\s*=>\s*\{\s*\}\)/);
});

test("raw styles exist", async () => {
  const css = await asset("app.css");
  for (const selector of [".preview-mode", ".raw-view", ".raw-note", ".raw-content"]) {
    assert.ok(css.includes(selector), selector);
  }
});

test("in-report XML source button routes into the global Raw mode", async () => {
  const app = await readFile(new URL("./assets/app.js", import.meta.url), "utf8");
  assert.match(app, /viewName === "raw" && currentArtifact\?\.selectedPath[\s\S]{0,60}setPreviewMode\("raw"\)/);
});
