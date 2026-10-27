import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";

const base = process.env.SITE_BASE_URL ?? "http://127.0.0.1:4321";
const readJson = (relative) => JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), "utf8"));
const plugins = readJson("../public/data/plugins.json").items;
const extensions = readJson("../public/data/extensions.json").items;
const marketplace = readJson("../../.github/plugin/marketplace.json");
const names = new Set(marketplace.plugins.map((plugin) => plugin.name));
const installUrl = (name) =>
  `vscode://chat-plugin/install?${new URLSearchParams({ source: "github/awesome-copilot", plugin: name })}`;

for (const [kind, items] of [["plugin", plugins], ["extension", extensions]]) {
  for (const item of items) {
    const name = kind === "plugin" ? item.name : item.pluginName;
    const html = fs.readFileSync(new URL(`../dist/${kind}/${item.id}/index.html`, import.meta.url), "utf8");
    if (name) {
      assert.ok(names.has(name), `${kind}/${item.id}: owning plugin exists in the marketplace`);
      assert.ok(html.includes(installUrl(name).replaceAll("&", "&amp;")),
        `${kind}/${item.id}: static detail includes the owning plugin install link`);
    } else {
      assert.ok(!html.includes("vscode://chat-plugin/install"),
        `${kind}/${item.id}: unregistered extension has no plugin install link`);
    }
  }
}
console.log("PASS all generated plugin and canvas detail links match marketplace identities");

const localPlugin = plugins.find((item) => !item.external);
const externalPlugin = plugins.find((item) => item.external);
const bundledCanvas = extensions.find((item) => item.pluginName && item.id !== item.pluginName && !item.external);
const externalCanvas = extensions.find((item) => item.external && item.pluginName);
const sourceOnlyCanvas = extensions.find((item) => !item.pluginName);
assert.ok(localPlugin && externalPlugin && bundledCanvas && externalCanvas && sourceOnlyCanvas,
  "fixtures cover local, curated external, bundled, and source-only entries");

const browser = await chromium.launch();
try {
  for (const colorScheme of ["light", "dark"]) {
    const page = await browser.newPage({ colorScheme });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ["/plugins/", "/extensions/"]) {
        await page.goto(new URL(route, base).href);
        await page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));
        const links = page.locator('#catalog a[href^="vscode://chat-plugin/install"]');
        assert.ok(await links.count() > 0, `${route}: visible VS Code actions`);
        for (const link of await links.all()) {
          const url = new URL(await link.getAttribute("href"));
          assert.equal(url.searchParams.get("source"), "github/awesome-copilot");
          assert.ok(names.has(url.searchParams.get("plugin")));
          assert.match(await link.getAttribute("aria-label"), /^Install .+ in VS Code$/);
          assert.equal(await link.evaluate((element) => element.parentElement.closest("a, button")), null,
            "install action is not nested inside the card link");
        }
        assert.ok(await page.locator('#catalog a[href^="https://github.com/"]').count() > 0,
          `${route}: source actions remain available`);
      }

      for (const [kind, item] of [
        ["plugin", localPlugin], ["plugin", externalPlugin],
        ["extension", bundledCanvas], ["extension", externalCanvas],
      ]) {
        const route = `/${kind}/${item.id}/`;
        await page.goto(new URL(route, base).href);
        await page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));
        const hero = page.locator("[data-hero-actions]");
        const link = hero.getByRole("link", { name: "Install in VS Code", exact: true });
        assert.equal(await link.getAttribute("href"), installUrl(kind === "plugin" ? item.name : item.pluginName));
        assert.equal(await hero.locator('a[href^="ghapp://plugins/install"]').count(), 1);
        const compact = page.locator("[data-reading-action] a");
        assert.equal(await compact.getAttribute("href"),
          await hero.locator('a[href^="ghapp://plugins/install"]').getAttribute("href"),
          "compact header preserves the primary app action");
        await page.evaluate(() => {
          document.addEventListener("click", (event) => {
            const anchor = event.target.closest('a[href^="vscode://"]');
            if (anchor) {
              event.preventDefault();
              anchor.dataset.activated = "true";
            }
          });
        });
        await link.focus();
        await page.keyboard.press("Enter");
        assert.equal(await link.getAttribute("data-activated"), "true", "keyboard activates the install link");
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${route}: no horizontal overflow`);
      }
      console.log(`PASS ${colorScheme} ${width}px: catalog and detail install actions`);
    }
    await page.goto(new URL(`/extension/${sourceOnlyCanvas.id}/`, base).href);
    await page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));
    assert.equal(await page.locator('a[href^="vscode://chat-plugin/install"]').count(), 0);
    assert.ok(await page.locator("[data-hero-actions] a").count() > 0);
    await page.close();
  }
} finally {
  await browser.close();
}
