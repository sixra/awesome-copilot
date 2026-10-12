import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { BoardStore, effectiveColumn } from "../.github/extensions/external-plugin-review-board/lib/state.mjs";

function issue(number, labels = []) {
  return {
    number,
    title: `[External Plugin]: Example ${number}`,
    author: "contributor",
    url: `https://github.com/github/awesome-copilot/issues/${number}`,
    labels: ["external-plugin", "ready-for-review", ...labels],
  };
}

async function createStore(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "epr-board-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return new BoardStore(path.join(dir, "board.json"), "github/awesome-copilot");
}

test("first-party submissions are fast-tracked to accept on refresh", async (t) => {
  const store = await createStore(t);
  const result = await store.syncIssues([issue(1, ["first party"]), issue(2, ["third party"]), issue(3)]);

  assert.deepEqual(result.fastTracked, [1]);
  const first = store.getItem(1);
  assert.equal(effectiveColumn(first), "accept");
  assert.equal(first.reviewStatus, "reviewed");
  assert.equal(first.review.fastTracked, true);
  assert.equal(first.review.suggestedComment, "/approve");
  assert.equal(effectiveColumn(store.getItem(2)), "unreviewed");
  assert.equal(effectiveColumn(store.getItem(3)), "unreviewed");
  assert.deepEqual(store.pendingReview().map((item) => item.number).sort(), [2, 3]);
});

test("fast-track applies when an existing card gains the first party label", async (t) => {
  const store = await createStore(t);
  await store.syncIssues([issue(1)]);
  const result = await store.syncIssues([issue(1, ["first party"])]);

  assert.deepEqual(result.fastTracked, [1]);
  assert.equal(effectiveColumn(store.getItem(1)), "accept");
});

test("fast-track does not override an existing review or manual bucket", async (t) => {
  const store = await createStore(t);
  await store.syncIssues([issue(1), issue(2)]);
  store.getItem(1).review = { recommendation: "needs-review", reviewedAt: new Date().toISOString() };
  store.getItem(1).reviewStatus = "reviewed";
  await store.moveItem(2, "probably-reject");

  const result = await store.syncIssues([issue(1, ["first party"]), issue(2, ["first party"])]);

  assert.deepEqual(result.fastTracked, []);
  assert.equal(effectiveColumn(store.getItem(1)), "needs-review");
  assert.equal(effectiveColumn(store.getItem(2)), "probably-reject");
});

test("moving a fast-tracked card to unreviewed opts it out of fast-track", async (t) => {
  const store = await createStore(t);
  await store.syncIssues([issue(1, ["first party"])]);
  await store.moveItem(1, "unreviewed");

  const result = await store.syncIssues([issue(1, ["first party"])]);

  assert.deepEqual(result.fastTracked, []);
  assert.equal(effectiveColumn(store.getItem(1)), "unreviewed");
  assert.deepEqual(store.pendingReview().map((item) => item.number), [1]);
});
