import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { buildVSCodePluginInstallUrl } from "../src/lib/plugin-install.ts";

test("matches the VS Code protocol reference exactly", () => {
  assert.equal(
    buildVSCodePluginInstallUrl("eval", "github/evals"),
    "vscode://chat-plugin/install?source=github%2Fevals&plugin=eval",
  );
});

test("uses awesome-copilot as the marketplace repository by default", () => {
  assert.equal(
    buildVSCodePluginInstallUrl("ai-ready"),
    "vscode://chat-plugin/install?source=github%2Fawesome-copilot&plugin=ai-ready",
  );
});

test("encodes query values once without introducing extra parameters", () => {
  const pluginName = "name&plugin=other +/%?#";
  const url = new URL(buildVSCodePluginInstallUrl(pluginName));
  assert.deepEqual([...url.searchParams], [
    ["source", "github/awesome-copilot"],
    ["plugin", pluginName],
  ]);
  assert.equal(url.hash, "");
  assert.match(url.search, /source=github%2Fawesome-copilot/);
});

test("rejects missing, qualified, or control-character plugin names", () => {
  for (const name of ["", " ", "name@marketplace", "name\n", "name\u0000", "name\u007f"]) {
    assert.throws(() => buildVSCodePluginInstallUrl(name), /Invalid marketplace plugin name/);
  }
});

test("rejects URLs and paths in place of a marketplace repository", () => {
  for (const source of ["", "github", "https://github.com/github/evals", "github/evals/path", "github/evals?x=y"]) {
    assert.throws(() => buildVSCodePluginInstallUrl("eval", source), /Invalid plugin marketplace repository/);
  }
});

test("all curated plugin names produce marketplace-qualified links", () => {
  const marketplace = JSON.parse(fs.readFileSync(
    new URL("../../.github/plugin/marketplace.json", import.meta.url), "utf8",
  ));
  for (const plugin of marketplace.plugins) {
    const url = new URL(buildVSCodePluginInstallUrl(plugin.name));
    assert.equal(url.searchParams.get("source"), "github/awesome-copilot");
    assert.equal(url.searchParams.get("plugin"), plugin.name);
  }
});
