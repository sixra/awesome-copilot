import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyExternalPluginIntakeEvaluation,
  syncExternalPluginIntakeLabels,
} from "./external-plugin-intake-state.mjs";

function mockGitHub(currentLabels) {
  const labels = new Set(currentLabels);
  return {
    labels,
    async paginate() {
      return [...labels].map((name) => ({ name }));
    },
    rest: {
      issues: {
        listLabelsOnIssue() {},
        async addLabels({ labels: addedLabels }) {
          for (const name of addedLabels) labels.add(name);
        },
        async removeLabel({ name }) {
          labels.delete(name);
        },
        async listComments() {
          return { data: [] };
        },
        async createComment() {},
      },
    },
  };
}

for (const state of ["ready-for-review", "requires-submitter-fixes", "awaiting-review", "rejected"]) {
  for (const ownershipLabel of ["first party", "third party", null, undefined]) {
    test(`intake syncs ${ownershipLabel ?? "no ownership label"} in ${state} state`, async () => {
      const github = mockGitHub(["external-plugin", "first party", "third party", "unrelated"]);
      const { desiredLabels } = await applyExternalPluginIntakeEvaluation({
        github,
        owner: "github",
        repo: "awesome-copilot",
        issueNumber: 1,
        evaluation: {
          intakeState: state,
          isCanvasPlugin: true,
          reviewSignals: { repository: { ownershipLabel } },
          commentMarker: "<!-- external-plugin-intake -->",
          commentBody: "Intake result",
        },
      });

      const expected = ["external-plugin", state, "external-plugin-canvas"];
      if (ownershipLabel) expected.push(ownershipLabel);
      assert.deepEqual(desiredLabels, new Set(expected));
      assert.deepEqual(github.labels, new Set([...expected, "unrelated"]));
    });
  }
}

test("state-only label sync preserves ownership labels for maintainer overrides and PR checks", async () => {
  const github = mockGitHub(["external-plugin", "requires-submitter-fixes", "first party"]);
  await syncExternalPluginIntakeLabels({
    github,
    owner: "github",
    repo: "awesome-copilot",
    issueNumber: 1,
    desiredLabels: new Set(["external-plugin", "ready-for-review"]),
  });

  assert.deepEqual(github.labels, new Set(["external-plugin", "ready-for-review", "first party"]));
});
