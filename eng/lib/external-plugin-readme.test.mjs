import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { externalPluginReadme } from "./external-plugin-readme.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "external-readme-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const folder = path.join(root, "docs", "external-plugins", "example-plugin");
  fs.mkdirSync(folder, { recursive: true });
  return { root, folder, readme: path.join(folder, "README.md") };
}

test("associates a reviewed README without altering the source listing", (t) => {
  const { root, readme } = fixture(t);
  fs.writeFileSync(readme, "# Example\n\nReviewed documentation.");
  assert.equal(externalPluginReadme(root, "example-plugin"),
    "docs/external-plugins/example-plugin/README.md");
});

test("missing documentation retains the fallback, including missing parent folders", (t) => {
  const { root } = fixture(t);
  assert.equal(externalPluginReadme(root, "example-plugin"), null);
  assert.equal(externalPluginReadme(root, "another-plugin"), null);
  assert.equal(externalPluginReadme(path.join(root, "missing"), "example-plugin"), null);
});

test("does not discover a built-in plugin README as external documentation", (t) => {
  const { root } = fixture(t);
  const local = path.join(root, "plugins", "example-plugin");
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(local, "README.md"), "# Built-in");
  assert.equal(externalPluginReadme(root, "example-plugin"), null);
});

test("rejects names that could escape or ambiguously map into the documentation folder", (t) => {
  const { root } = fixture(t);
  for (const name of ["../example", "..", "/example", "a\\b", "a/b", "", "UPPER", "a..b", "a--b", "a".repeat(65), null]) {
    assert.throws(() => externalPluginReadme(root, name), /Invalid external plugin name/);
  }
});

test("supports permitted dots and single-character plugin names", (t) => {
  const { root } = fixture(t);
  for (const name of ["a", "a.b"]) {
    const folder = path.join(root, "docs", "external-plugins", name);
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "README.md"), "# Documentation");
    assert.equal(externalPluginReadme(root, name), `docs/external-plugins/${name}/README.md`);
  }
});

test("rejects directories masquerading as a README", (t) => {
  const { root, readme } = fixture(t);
  fs.mkdirSync(readme);
  assert.throws(() => externalPluginReadme(root, "example-plugin"), /regular file/);
});

test("rejects empty bodies and invalid YAML frontmatter", (t) => {
  const { root, readme } = fixture(t);
  for (const content of [" \n", "---\ntitle: Example\n---\n", "---\ntitle: [\n---\n# Example"]) {
    fs.writeFileSync(readme, content);
    assert.throws(() => externalPluginReadme(root, "example-plugin"));
  }
  fs.writeFileSync(readme, "---\ntitle: Example\n---\n# Example");
  assert.ok(externalPluginReadme(root, "example-plugin"));
});

test("rejects symlinked documentation directories, even when the target exists", (t) => {
  const { root, folder } = fixture(t);
  const target = path.join(root, "outside");
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, "README.md"), "# Outside");
  fs.rmdirSync(folder);
  fs.symlinkSync(target, folder, "junction");
  assert.throws(() => externalPluginReadme(root, "example-plugin"), /regular file/);
});

test("rejects broken symlinked documentation directories", (t) => {
  const { root, folder } = fixture(t);
  fs.rmdirSync(folder);
  fs.symlinkSync(path.join(root, "missing-target"), folder, "junction");
  assert.throws(() => externalPluginReadme(root, "example-plugin"), /regular file/);
});

test("reports unreadable files instead of treating them as missing", (t) => {
  const { root, readme } = fixture(t);
  fs.writeFileSync(readme, "# Example");
  t.mock.method(fs, "readFileSync", () => {
    throw Object.assign(new Error("Access denied"), { code: "EACCES" });
  });
  assert.throws(() => externalPluginReadme(root, "example-plugin"), /Access denied/);
});

test("rejects symlinked README files without following the target", (t) => {
  const { root, readme } = fixture(t);
  const originalStat = fs.lstatSync;
  t.mock.method(fs, "lstatSync", (file, ...args) => {
    if (file === readme) return { isSymbolicLink: () => true };
    return originalStat(file, ...args);
  });
  assert.throws(() => externalPluginReadme(root, "example-plugin"), /regular file/);
});

test("reports directory access errors instead of treating them as missing", (t) => {
  const { root } = fixture(t);
  t.mock.method(fs, "lstatSync", () => {
    throw Object.assign(new Error("Directory access denied"), { code: "EACCES" });
  });
  assert.throws(() => externalPluginReadme(root, "example-plugin"), /Directory access denied/);
});
