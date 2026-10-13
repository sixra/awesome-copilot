import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { crc32 } from "node:zlib";

const sharedHome = await mkdtemp(join(tmpdir(), "pae-nav-history-"));
process.env.COPILOT_HOME = sharedHome;

const u16 = (v) => Buffer.from(Uint16Array.of(v).buffer);
const u32 = (v) => Buffer.from(Uint32Array.of(v).buffer);

function zipOf(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, raw] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const crc = crc32(raw);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(raw.length), u32(raw.length), u16(nameBuf.length), u16(0), nameBuf, raw]);
    centrals.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(raw.length), u32(raw.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf]));
    locals.push(local);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  return Buffer.concat([...locals, central, u32(0x06054b50), u16(0), u16(0), u16(centrals.length), u16(centrals.length), u32(central.length), u32(offset), u16(0)]);
}

test("breadcrumb Back/Forward keeps independent in-canvas route history", async (t) => {
  const { loadPlaywright } = await import("./capture.mjs");
  let chromium;
  try {
    chromium = await loadPlaywright();
  } catch (error) {
    return t.skip(error.message.split("\n")[0]);
  }
  let browser;
  for (const options of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try {
      browser = await chromium.launch({ headless: true, ...options });
      break;
    } catch {
      // try the next channel
    }
  }
  if (!browser) return t.skip("Chromium is not available");

  const { startInstance, stopInstance } = await import("./server.mjs");
  const instanceId = `nav-history-${Date.now()}`;
  const server = await startInstance(instanceId, null, () => {});
  t.after(async () => {
    await browser.close();
    await stopInstance(instanceId);
    await rm(sharedHome, { recursive: true, force: true });
  });
  const cache = join(sharedHome, "extensions", "pr-artifact-explorer", "artifacts", "cache");
  await mkdir(cache, { recursive: true });
  const files = { "a.txt": Buffer.from("alpha"), "b.txt": Buffer.from("bravo") };
  await writeFile(join(cache, "4004.zip"), zipOf(files));
  const entry = (name, raw) => ({ path: name, name, size: raw.length, compressedSize: raw.length, kind: "text", mime: "text/plain", supported: true });
  await writeFile(join(cache, "4004.json"), JSON.stringify({
    repository: "o/r",
    artifact: { id: 4004, name: "a" },
    downloadedAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    compressedBytes: 0,
    analysis: {
      primary: { kind: "text", path: "a.txt", label: "Text" },
      entries: [entry("a.txt", files["a.txt"]), entry("b.txt", files["b.txt"])],
      counts: { text: 2 },
      fileCount: 2,
      totalUncompressedBytes: 10,
      zipBacked: true,
    },
  }));

  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const base = server.url ?? `${server.origin}/`;
  const state = () =>
    page.evaluate(() => ({
      back: document.querySelector("#route-back").disabled,
      forward: document.querySelector("#route-forward").disabled,
      hash: location.hash,
      stack: JSON.parse(sessionStorage.getItem("pae.routeHistory") ?? "{}").stack ?? [],
    }));

  await page.goto(`${base}#/artifact/o%2Fr/1/4004?file=a.txt`);
  await page.waitForSelector('[data-preview-mode="raw"]', { timeout: 40_000 });
  let s = await state();
  assert.equal(s.back, true, "Back starts disabled");
  assert.equal(s.forward, true, "Forward starts disabled");

  // Controls are right-aligned and do not overlap the breadcrumb trail.
  for (const width of [320, 420, 882, 1600]) {
    await page.setViewportSize({ width, height: 800 });
    const geo = await page.evaluate(() => {
      const trail = document.querySelector("#breadcrumb-trail").getBoundingClientRect();
      const nav = document.querySelector(".route-history").getBoundingClientRect();
      return { trailRight: trail.right, navLeft: nav.left, navRight: nav.right, width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(geo.navLeft >= geo.trailRight - 0.5, `no overlap at ${width}`);
    assert.ok(geo.navRight <= geo.width, `controls on screen at ${width}`);
    assert.equal(geo.overflow, false, `no horizontal overflow at ${width}`);
  }
  await page.setViewportSize({ width: 1200, height: 800 });
  s = await state();
  assert.equal(s.stack.length, 1, "resize does not add entries");

  // File selection and Raw each create a history entry.
  await page.click('[data-artifact-file="b.txt"]');
  await page.waitForFunction(() => location.hash.includes("file=b.txt"));
  await page.click('[data-preview-mode="raw"]');
  await page.waitForSelector(".raw-view", { timeout: 40_000 });
  s = await state();
  assert.equal(s.stack.length, 3);
  assert.equal(s.back, false);

  // Back restores Raw -> Preview of b.txt, then a.txt, without appending.
  await page.click("#route-back");
  await page.waitForSelector(".raw-view", { state: "detached", timeout: 40_000 });
  s = await state();
  assert.equal(s.stack.length, 3, "traversal does not append");
  assert.match(s.hash, /file=b\.txt/);
  assert.doesNotMatch(s.hash, /view=raw/);
  assert.equal(s.forward, false);
  await page.click("#route-back");
  await page.waitForFunction(() => location.hash.includes("file=a.txt"));
  s = await state();
  assert.equal(s.back, true);

  // Reload keeps the stack (session scoped) and does not duplicate.
  await page.reload();
  await page.waitForSelector('[data-preview-mode="raw"]', { timeout: 40_000 });
  s = await state();
  assert.equal(s.stack.length, 3);
  assert.equal(s.forward, false);

  // A new destination after Back clears the forward branch.
  await page.click('[data-artifact-file="b.txt"]');
  await page.waitForFunction(() => location.hash.includes("file=b.txt"));
  s = await state();
  assert.equal(s.forward, true, "forward branch cleared");
  assert.equal(s.stack.length, 2);

  // Invalid routes are not recorded.
  await page.evaluate(() => (location.hash = "#nonsense"));
  await page.waitForTimeout(300);
  s = await state();
  assert.ok(!s.stack.includes("#nonsense"));
  assert.deepEqual(errors, []);
});
