import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const website = fileURLToPath(new URL("..", import.meta.url));
const root = path.dirname(website);
const originalCwd = process.cwd();
process.chdir(website);

const server = await createServer({
  root: website,
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
});
after(async () => {
  await server.close();
  process.chdir(originalCwd);
});
const { readResourceMarkdown } = await server.ssrLoadModule("/src/lib/detail-page.ts");

test("external README uses the existing renderer and strips executable HTML", (t) => {
  const relative = "docs/external-plugins/example-plugin/README.md";
  const target = path.join(root, relative);
  const originalRead = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (file, ...args) => {
    if (file === target) {
      return `# Example plugin

## Reviewed documentation

<script>readmeAttack()</script>
<img src="https://example.com/image.png" onerror="readmeAttack()">
<a href="javascript:readmeAttack()">Unsafe link</a>
<a href="https://example.com/docs" target="_blank">Safe link</a>
`;
    }
    return originalRead(file, ...args);
  });
  const { markdownHtml } = readResourceMarkdown(relative);
  assert.match(markdownHtml, /Reviewed documentation/);
  assert.doesNotMatch(markdownHtml, /<h1\b|<script\b|onerror|javascript:|readmeAttack/);
  assert.match(markdownHtml, /href="https:\/\/example.com\/docs"/);
  assert.match(markdownHtml, /rel="noopener noreferrer"/);
});

const data = JSON.parse(fs.readFileSync(path.join(website, "public", "data", "plugins.json"), "utf8"));
const readPage = (id) => fs.readFileSync(path.join(website, "dist", "plugin", id, "index.html"), "utf8");
const fallback = "This plugin does not ship a README in this repository.";

test("built Excel MCP page displays the included README and keeps external provenance", () => {
  const item = data.items.find((entry) => entry.id === "excel-mcp");
  assert.equal(item.readmeFile, "docs/external-plugins/excel-mcp/README.md");
  assert.equal(item.external, true);
  assert.equal(item.source.repo, "sbroenne/mcp-server-excel-plugins");
  const html = readPage(item.id);
  assert.match(html, /What you can ask your assistant to do/);
  assert.match(html, /This is one measured result, not a promise/);
  assert.match(html, /External plugin/);
  assert.match(html, /Review the source before installing/);
  assert.match(html, /0057e645ff3620206e440bd313b8b26f0be943c0/);
  assert.ok(!html.includes(fallback));
});

test("external listings without a README retain their documentation fallback", () => {
  const external = data.items.filter((entry) => entry.external && !entry.readmeFile);
  assert.ok(external.length > 0);
  for (const item of external) {
    assert.equal(item.readmeFile, null, item.id);
    assert.ok(readPage(item.id).includes(fallback), item.id);
  }
});

test("built-in plugins still use their existing README", () => {
  const item = data.items.find((entry) => !entry.external && entry.readmeFile);
  assert.ok(item);
  assert.match(item.readmeFile, /^plugins\/[^/]+\/README\.md$/);
  assert.ok(!readPage(item.id).includes(fallback));
});
