import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const website = fileURLToPath(new URL("..", import.meta.url));
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
const { renderResourceMarkdown, readResourceMarkdown } = await server.ssrLoadModule("/src/lib/detail-page.ts");
const urls = {
  linkBaseUrl: "https://github.com/owner/repo/blob/v1/plugins/example/README.md",
  imageBaseUrl: "https://raw.githubusercontent.com/owner/repo/v1/plugins/example/README.md",
};

test("remote README uses the existing sanitizer, including raw HTML", () => {
  const { markdownHtml } = renderResourceMarkdown(`# Plugin

## Documentation

<script>readmeAttack()</script>
<img src="image.png" onerror="readmeAttack()">
<a href="javascript:readmeAttack()">Unsafe</a>
<a href="https://example.com/docs" target="_blank">Safe</a>
`, urls);
  assert.match(markdownHtml, /Documentation/);
  assert.doesNotMatch(markdownHtml, /<h1\b|<script\b|onerror|javascript:|readmeAttack/);
  assert.match(markdownHtml, /rel="noopener noreferrer"/);
  assert.match(markdownHtml, /src="https:\/\/raw.githubusercontent.com\/owner\/repo\/v1\/plugins\/example\/image.png"/);
});

test("resolves relative Markdown links, reference images, and raw HTML links upstream", () => {
  const { markdownHtml } = renderResourceMarkdown(`[Guide](../../docs/guide.md)
[Section](#install)
![Image][image]

[image]: ./assets/preview.png

<a href="./LICENSE">License</a>
<img src="/assets/logo.png">
`, urls);
  assert.match(markdownHtml, /href="https:\/\/github.com\/owner\/repo\/blob\/v1\/docs\/guide.md"/);
  assert.match(markdownHtml, /href="#install"/);
  assert.match(markdownHtml, /src="https:\/\/raw.githubusercontent.com\/owner\/repo\/v1\/plugins\/example\/assets\/preview.png"/);
  assert.match(markdownHtml, /href="https:\/\/github.com\/owner\/repo\/blob\/v1\/plugins\/example\/LICENSE"/);
});

test("relative URL rewriting does not leak into local rendering", () => {
  renderResourceMarkdown("[Remote](./guide.md)", urls);
  assert.throws(() => renderResourceMarkdown("[Remote](./guide.md)", {
    ...urls,
    linkBaseUrl: "invalid URL",
  }));
  assert.match(renderResourceMarkdown("[Local](./guide.md)").markdownHtml, /href="\.\/guide.md"/);
  assert.match(renderResourceMarkdown("---\ntitle: Plugin\n---\n## Body", urls).markdownHtml, /Body/);
  assert.throws(() => renderResourceMarkdown("---\ntitle: [\n---\n# Broken", urls));
});

test("local README loading still uses the same renderer", () => {
  const data = JSON.parse(fs.readFileSync(path.join(website, "public", "data", "plugins.json"), "utf8"));
  const item = data.items.find((entry) => !entry.external && entry.readmeFile);
  assert.ok(readResourceMarkdown(item.readmeFile).markdownHtml);
});

test("generated external pages render remote READMEs or the source fallback", () => {
  const data = JSON.parse(fs.readFileSync(path.join(website, "public", "data", "plugins.json"), "utf8"));
  const remote = data.items.filter((item) => item.external && item.readme);
  assert.ok(remote.length > 1, "README support must cover more than Excel MCP");
  for (const item of data.items.filter((item) => item.external)) {
    const html = fs.readFileSync(path.join(website, "dist", "plugin", item.id, "index.html"), "utf8");
    assert.match(html, /Review the source before installing/);
    if (item.readme) {
      assert.match(item.readme.rawUrl, /^https:\/\/raw\.githubusercontent\.com\//);
      const { markdownHtml } = renderResourceMarkdown(item.readme.markdown, {
        linkBaseUrl: item.readme.sourceUrl,
        imageBaseUrl: item.readme.rawUrl,
      });
      if (markdownHtml.trim()) {
        assert.ok(!html.includes("A README could not be loaded."), item.id);
        const paragraph = markdownHtml.match(/<p(?:\s[^>]*)?>[\s\S]*?<\/p>/)?.[0];
        if (paragraph) assert.ok(html.includes(paragraph), `${item.id}: upstream README content missing`);
      }
    } else {
      assert.ok(html.includes("A README could not be loaded."), item.id);
    }
  }
});
