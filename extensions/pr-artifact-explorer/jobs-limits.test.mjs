import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JobRegistry } from "./jobs.mjs";
import { LimitError, LimitPolicy } from "./limits.mjs";

async function policy() {
  const dir = await mkdtemp(join(tmpdir(), "limits-"));
  return { dir, policy: new LimitPolicy(join(dir, "limits.json")) };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("crossing a soft limit prompts but never stops the job", async () => {
  const { dir, policy: p } = await policy();
  try {
    const registry = new JobRegistry(p);
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const job = registry.start("k", { repository: "o/r", artifactId: 1 }, async (j) => {
      registry.update(j, { live: { downloadBytes: p.get("downloadBytes") + 1 } });
      await gate;
      return "done";
    });
    await tick();
    const snap = registry.snapshot(job);
    assert.equal(snap.status, "running");
    assert.equal(snap.prompts.length, 1);
    assert.equal(snap.prompts[0].kind, "downloadBytes");
    release();
    assert.equal(await job.promise, "done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("submitted limits are checked against live progress atomically", async () => {
  const { dir, policy: p } = await policy();
  try {
    const registry = new JobRegistry(p);
    let live = 100;
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const job = registry.start("k", { repository: "o/r", artifactId: 2 }, async (j) => {
      registry.update(j, { live: { zipEntries: live } });
      await gate;
    });
    await tick();
    assert.throws(
      () => p.submit("zipEntries", 50),
      (error) => error instanceof LimitError && error.code === "below_current" && error.minimum === 100,
    );
    // Progress advances after the prompt: the new minimum is the live value at submit time.
    live = 5000;
    registry.update(job, { live: { zipEntries: live } });
    assert.throws(() => p.submit("zipEntries", 4999), /at least the current value/);
    assert.equal(p.submit("zipEntries", 5000).limit, 5000);
    assert.equal(registry.snapshot(job).prompts.length, 0);
    assert.throws(() => p.submit("zipEntries", 0), (e) => e.code === "invalid_limit");
    assert.throws(() => p.submit("nope", 5), (e) => e.code === "unknown_limit");
    release();
    await job.promise;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("jobs are idempotent per key, cancellable, and retry increments the attempt", async () => {
  const { dir, policy: p } = await policy();
  try {
    const registry = new JobRegistry(p);
    const first = registry.start("k", { repository: "o/r", artifactId: 3 }, (j) =>
      new Promise((_, reject) => j.controller.signal.addEventListener("abort", () => reject(j.controller.signal.reason))),
    );
    const again = registry.start("k", { repository: "o/r", artifactId: 3 }, async () => "x");
    assert.equal(first, again);
    assert.equal(registry.cancel(first.id), true);
    await assert.rejects(first.promise);
    assert.equal(registry.snapshot(first).status, "cancelled");
    const retry = registry.start("k", { repository: "o/r", artifactId: 3 }, async () => "ok");
    assert.equal(retry.attempt, 2);
    assert.equal(await retry.promise, "ok");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed job reports the error without being treated as cancelled", async () => {
  const { dir, policy: p } = await policy();
  try {
    const registry = new JobRegistry(p);
    const job = registry.start("k", { repository: "o/r", artifactId: 4 }, async () => {
      throw new Error("boom");
    });
    await assert.rejects(job.promise, /boom/);
    const snap = registry.snapshot(job);
    assert.equal(snap.status, "failed");
    assert.equal(snap.error, "boom");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("limits persist across policy instances", async () => {
  const { dir, policy: p } = await policy();
  try {
    p.submit("downloadBytes", 123456789);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const next = new LimitPolicy(join(dir, "limits.json"));
    await next.load();
    assert.equal(next.get("downloadBytes"), 123456789);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
