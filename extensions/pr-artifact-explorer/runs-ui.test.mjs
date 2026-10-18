import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const sharedHome = await mkdtemp(join(tmpdir(), "pae-runs-ui-"));
process.env.COPILOT_HOME = sharedHome;

const run = (id, overrides = {}) => ({
  id,
  name: "Nightly",
  title: `Nightly build ${id}`,
  number: id - 100,
  attempt: 1,
  event: "schedule",
  status: "completed",
  conclusion: "success",
  branch: "main",
  headSha: "b".repeat(40),
  actor: "octo",
  createdAt: new Date().toISOString(),
  url: `https://github.com/o/r/actions/runs/${id}`,
  pullRequests: [],
  ...overrides,
});

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

test("workflow runs list, filter, artifact badges and run detail work without a pull request", async (t) => {
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
  const instanceId = `runs-ui-${Date.now()}`;
  const server = await startInstance(instanceId, null, () => {});
  t.after(async () => {
    await browser.close();
    await stopInstance(instanceId);
    await rm(sharedHome, { recursive: true, force: true });
  });

  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const listRequests = [];
  await page.route("**/api/runs?*", (route) => {
    const url = new URL(route.request().url());
    listRequests.push(url.searchParams);
    return json(route, {
      repository: "o/r",
      runs: [run(101), run(102, { event: "workflow_dispatch", pullRequests: [7] })],
      totalCount: 2,
      page: 1,
      perPage: 30,
      hasPrevious: false,
      hasMore: false,
      capped: false,
    });
  });
  await page.route("**/api/workflows?*", (route) =>
    json(route, { repository: "o/r", workflows: [{ id: 1, name: "Nightly", path: ".github/workflows/nightly.yml", ref: "nightly.yml", state: "active" }] }),
  );
  await page.route("**/api/runs/artifact-counts?*", (route) => json(route, { repository: "o/r", counts: { 101: 2, 102: 0 } }));
  await page.route("**/api/runs/101?*", (route) =>
    json(route, {
      repository: "o/r",
      run: run(101),
      runs: [run(101)],
      runCount: 1,
      runsTruncated: false,
      artifacts: [
        {
          id: 5,
          name: "coverage-report",
          sizeInBytes: 2048,
          expired: false,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          run: run(101),
        },
      ],
      artifactCount: 1,
      artifactsTruncated: false,
    }),
  );
  await page.route("**/api/artifacts/5", (route) => json(route, { error: "stubbed" }, 502));

  const base = server.url ?? `${server.origin}/`;
  await page.goto(`${base}#/runs/o%2Fr?event=schedule`);
  await page.waitForSelector("[data-run-row]");
  assert.equal(await page.locator("[data-run-row]").count(), 2);
  assert.equal(listRequests[0].get("event"), "schedule");
  assert.equal(await page.locator(".repo-tab[aria-current='page']").textContent().then((s) => s.trim()), "Workflow runs");
  assert.match(await page.locator("[data-run-row]").first().textContent(), /Scheduled/);
  assert.match(await page.locator("[data-run-row]").nth(1).textContent(), /#7/);

  await page.waitForFunction(() => document.querySelector('[data-run-artifacts="101"]')?.textContent.includes("2 artifacts"));
  assert.match(await page.locator('[data-run-artifacts="102"]').textContent(), /No artifacts/);
  await page.waitForFunction(() => document.querySelectorAll("#runs-workflow option").length === 2);

  await page.check("#runs-has-artifacts");
  assert.equal(await page.locator("[data-run-row]:visible").count(), 1);
  assert.match(await page.locator("#run-list-artifact-note").textContent(), /1 run without artifacts hidden/);
  await page.uncheck("#runs-has-artifacts");
  assert.equal(await page.locator("[data-run-row]:visible").count(), 2);

  await page.check("#runs-nopr");
  await page.waitForFunction(() => location.hash.includes("nopr=1"));
  for (let attempt = 0; attempt < 50 && !listRequests.some((params) => params.get("nopr") === "1"); attempt++) {
    await page.waitForTimeout(100);
  }
  const filtered = listRequests.find((params) => params.get("nopr") === "1");
  assert.ok(filtered, "the nopr filter reaches the API");
  assert.equal(filtered.get("event"), "schedule");
  await page.waitForSelector("[data-run-row]");

  await page.click('[data-run-row="101"] a.Box-row-title');
  await page.waitForSelector(".artifact-row");
  assert.match(await page.locator("h1.page-title").textContent(), /Nightly build 101/);
  assert.equal(await page.locator("[data-rerun-run='101']").count(), 2, "header and artifact row both offer a re-run");
  const inspect = page.locator("button[data-inspect-artifact='5']").first();
  assert.equal(await inspect.getAttribute("data-run-id"), "101");
  assert.equal(await inspect.getAttribute("data-pull-number"), "0");
  const crumbs = await page.locator("#breadcrumb-trail").textContent();
  assert.match(crumbs, /Workflow runs/);

  await page.goto(`${base}#/artifact/o%2Fr/0/5?run=101`);
  await page.waitForSelector("#view .flash-error");
  const artifactCrumbs = await page.locator("#breadcrumb-trail").textContent();
  assert.match(artifactCrumbs, /Workflow runs/);
  assert.match(artifactCrumbs, /Run 101/);
  assert.doesNotMatch(artifactCrumbs, /Pull requests/);

  assert.deepEqual(errors, []);
});
