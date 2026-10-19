import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { APPROVED_FILES, approvalChanges, fingerprint, takeWaivers, waiverFile } from "../lib/approval.mjs";
import { META, validateArgs } from "../lib/args.mjs";
import { ContainmentError, contained } from "../lib/fsguard.mjs";
import { LEASE } from "../lib/lease.mjs";
import { MAX_ROUNDS, checkpointLines } from "../lib/loop.mjs";
import { owner, ownershipCheck } from "../lib/ownership.mjs";
import { buildPrompt } from "../lib/prompts.mjs";
import { MAX_EVIDENCE, normalize, planWorkstreams, recordFile, runFile, writeRecord } from "../lib/record.mjs";
import { SKILLS, skillDrift, skillProvenance } from "../lib/skills.mjs";
import { createWorkflow } from "../lib/workflow.mjs";
import { BRIEF, WORKSTREAMS, defaultResponder, extensionDir, failed, harness, labels, logMatches, passed, workspace } from "./helpers.mjs";

const git = promisify(execFile);
const sha = text => createHash("sha256").update(text).digest("hex");
const exists = file => stat(file).then(() => true, () => false);
const AUTO = { brief: BRIEF, autonomy: "auto", maxFixLoops: 0 };
const SUB = "0000aaaa-bbbb-4ccc-8ddd-eeeeffff0000";

async function azure(cwd, { plan = "# Plan v1\n", location = "eastus2" } = {}) {
    await mkdir(path.join(cwd, ".azure", "claims-dev"), { recursive: true });
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    await writeFile(path.join(cwd, ".azure", "deployment-plan.md"), plan);
    await writeFile(path.join(cwd, "docs", "spec.md"), "# Spec\n");
    await writeFile(path.join(cwd, ".azure", "config.json"), JSON.stringify({ version: 1, defaultEnvironment: "claims-dev" }));
    await writeFile(path.join(cwd, ".azure", "claims-dev", ".env"), `AZURE_ENV_NAME="claims-dev"\nAZURE_SUBSCRIPTION_ID="${SUB}"\nAZURE_LOCATION="${location}"\nAZURE_RESOURCE_GROUP="rg-claims-dev"\nAZURE_OPENAI_KEY="s3cret"\n`);
}

async function routerSkill(dir, text = "# Router\n") {
    await mkdir(path.join(dir, "references"), { recursive: true });
    await writeFile(path.join(dir, "SKILL.md"), text);
    for (const file of ["sdd.md", "specify.md", "implement.md", "verify.md", "deploy.md"]) await writeFile(path.join(dir, "references", file), `# ${file}\n`);
}

const latest = (run, prefix) => run.state.calls.filter(call => call.attempt === run.state.attempts && call.label.startsWith(prefix)).map(call => call.label);
const promptOf = (run, label) => run.state.calls.find(call => call.label === label)?.prompt ?? "";

// 1 and 8: a pass is only a pass with no open issues, and Verify or Deploy passes need evidence.
test("normalize turns passes with open issues or without required evidence into failures, and bounds evidence", () => {
    const withIssues = normalize({ status: "passed", summary: "All good", issues: ["E2E still red"] }, "Specify · review");
    assert.equal(withIssues.status, "failed");
    assert.deepEqual(withIssues.issues, ["E2E still red"]);
    assert.equal(withIssues.summary, "Reported passed with 1 open issue, so it counts as failed: All good");

    const bare = normalize({ status: "passed", summary: "Looks fine", issues: [] }, "Verify · review", { requireEvidence: true });
    assert.equal(bare.status, "failed");
    assert.match(bare.issues[0], /^Verify · review reported passed without evidence items/);
    assert.equal(normalize({ status: "passed", summary: "ok", issues: [] }, "Specify · review").status, "passed", "Specify does not require evidence");

    const many = Array.from({ length: 20 }, (_, index) => ({ claim: `claim ${index} ${"x".repeat(300)}`, source: "s".repeat(400), result: "r\n".repeat(200) }));
    const proved = normalize({ status: "passed", summary: "ok", issues: [], evidence: [{ source: "no claim" }, ...many] }, "Deploy · review", { requireEvidence: true });
    assert.equal(proved.status, "passed");
    assert.equal(proved.evidence.length, MAX_EVIDENCE);
    assert.ok(proved.evidence.every(row => row.claim.length <= 200 && row.source.length <= 300 && row.result.length <= 200 && !row.result.includes("\n")));
    assert.deepEqual(normalize(null, "X").evidence, []);
});

test("Verify and Deploy gates fail a pass without evidence and persist the evidence of a real pass", async t => {
    const { cwd, home } = await workspace(t);
    const run = harness({
        cwd, home, args: { ...AUTO, skipDeploy: true },
        responder: who => (who === "Verify · review" ? { status: "passed", summary: "trust me", issues: [], lessons: [] } : defaultResponder(who)),
    });
    assert.deepEqual(await run.attempt(), { status: "paused", key: "blocked-verify-r1" });
    let record = await run.record();
    const gate = record.phases.find(entry => entry.phase === "Verify");
    assert.equal(gate.status, "failed");
    assert.match(gate.issues[0], /without evidence items/);
    assert.deepEqual(record.phases.find(entry => entry.phase === "Specify").evidence, [{ claim: "Specify · review gate checks", source: "test", result: "ok" }]);

    run.state.responder = defaultResponder;
    assert.equal((await run.attempt()).status, "completed");
    record = await run.record();
    assert.deepEqual(record.phases.at(-2).evidence, [{ claim: "Verify · review · r2 gate checks", source: "test", result: "ok" }]);
});

// 2: the final round never promises a retry it cannot run.
test("the final round's blocked checkpoint says rounds are exhausted instead of promising a retry", async t => {
    const early = checkpointLines("blocked-verify-r3", { phase: "Verify", round: 3, status: "failed", issues: ["E2E red"] });
    assert.match(early.resume, /retrying Verify as round 4/);
    const last = checkpointLines(`blocked-verify-r${MAX_ROUNDS}`, { phase: "Verify", round: MAX_ROUNDS, status: "failed", issues: ["E2E red"], waivers: "x" });
    assert.match(last.wait, new RegExp(`round ${MAX_ROUNDS} of ${MAX_ROUNDS}, so this run cannot retry Verify`));
    assert.match(last.wait, /start a new run, or rerun only this phase with from: "Verify"/);
    assert.doesNotMatch(`${last.wait} ${last.resume}`, /retrying|round \d+ ?\+|resume to retry|waivers/);
    assert.match(last.resume, /no rounds left/);

    const { cwd, home } = await workspace(t);
    const blocked = { status: "blocked", summary: "Owner role needed", issues: ["Grant Foundry User"], lessons: [] };
    const run = harness({ cwd, home, args: AUTO, responder: who => (who.startsWith("Specify · lead") ? blocked : defaultResponder(who)) });
    for (let round = 1; round <= MAX_ROUNDS; round += 1) assert.deepEqual(await run.attempt(), { status: "paused", key: `blocked-specify-r${round}` });
    const wait = run.state.logs.at(-1);
    assert.match(wait, /^Needs you: Specify is blocked \(Grant Foundry User\)\. That was round 20 of 20/);
    assert.match(wait, /then start a new run\.$/);
    const outcome = await run.attempt();
    assert.equal(outcome.status, "error");
    assert.match(outcome.error.message, /did not pass its gate in 20 rounds/);
    assert.ok(!run.state.logs.some(line => /round 21/.test(line)));
    assert.equal((await run.record()).status, "error");
});

// 3: the record is mandatory at boundaries.
test("a flight record that cannot be written pauses the run, and resuming saves it before continuing", async t => {
    const { cwd, home } = await workspace(t);
    const run = harness({ cwd, home, args: { brief: BRIEF } });
    assert.deepEqual(await run.attempt(), { status: "paused", key: "approve-spec-v1" });
    const file = path.join(cwd, ...recordFile("run-1").split("/"));
    await rm(file);
    await mkdir(file);

    assert.deepEqual(await run.attempt(), { status: "paused", key: "blocked-record-resume-approve-spec-v1" });
    assert.match(run.state.logs.at(-1), new RegExp(`^Needs you: the flight record could not be written to ${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(`));
    assert.equal(labels(run.state, "Implement").length, 0, "nothing runs without a record");

    const failedAgain = await run.attempt();
    assert.equal(failedAgain.status, "error");
    assert.match(failedAgain.error.message, /still cannot be written/);

    await rm(file, { recursive: true });
    const outcome = await run.attempt();
    assert.deepEqual(outcome, { status: "paused", key: "approve-deploy-v1" });
    assert.ok(run.state.logs.includes("Flight record saved. Continuing."));
    const record = await run.record();
    assert.equal(record.pending, "approve-deploy-v1");
    assert.ok(record.checkpoints.some(row => row.key === "approve-spec-v1"));
});

test("a setup that cannot write the flight record fails instead of running without one", async t => {
    const { cwd, home } = await workspace(t);
    await mkdir(path.join(cwd, ...recordFile("run-1").split("/")), { recursive: true });
    const outcome = await harness({ cwd, home, args: { brief: BRIEF } }).attempt();
    assert.equal(outcome.status, "error");
    assert.match(outcome.error.message, /^The flight record could not be written to .*run-1\.json/);
});

// 4: one active run per workspace.
test("the workspace lease refuses a second active run, takes over a stale one and is released on pause", async t => {
    const { cwd, home } = await workspace(t);
    const lease = path.join(cwd, ...LEASE.split("/"));
    await mkdir(path.dirname(lease), { recursive: true });
    await writeFile(lease, JSON.stringify({ runId: "other-run", startedAt: "2026-01-01T00:00:00.000Z", heartbeatAt: "2026-01-01T00:00:00.000Z" }));
    const refused = await harness({ cwd, home, args: { brief: BRIEF } }).attempt();
    assert.equal(refused.status, "error");
    assert.match(refused.error.message, /Another Agentic Loop run, other-run, is active in this workspace/);
    assert.match(refused.error.message, /delete \.agentic-loop\/active-run\.json/);
    assert.equal(await exists(path.join(cwd, ...recordFile("run-1").split("/"))), false);

    await writeFile(lease, JSON.stringify({ runId: "other-run", startedAt: "2025-12-31T00:00:00.000Z", heartbeatAt: "2025-12-31T23:00:00.000Z" }));
    const held = [];
    const run = harness({
        cwd, home, args: { brief: BRIEF },
        responder: async who => {
            held.push(JSON.parse(await readFile(lease, "utf8")).runId);
            return defaultResponder(who);
        },
    });
    assert.deepEqual(await run.attempt(), { status: "paused", key: "approve-spec-v1" });
    assert.equal(logMatches(run.state, /^Workspace lease: took over the stale lease of run other-run/).length, 1);
    assert.deepEqual([...new Set(held)], ["run-1"]);
    assert.equal(await exists(lease), false, "a paused run releases the lease");

    await writeFile(lease, JSON.stringify({ runId: "run-2", startedAt: "2026-01-01T00:00:30.000Z", heartbeatAt: "2026-01-01T00:00:30.000Z" }));
    const blocked = await run.attempt();
    assert.equal(blocked.status, "error");
    assert.match(blocked.error.message, /run-2, is active/);
    await rm(lease);
    assert.deepEqual(await run.attempt(), { status: "paused", key: "approve-deploy-v1" }, "a resume of the same run takes the lease back");
    assert.equal(await exists(lease), false);
});

test("a run that loses its lease to another run stops writing", async t => {
    const { cwd, home } = await workspace(t);
    const lease = path.join(cwd, ...LEASE.split("/"));
    const run = harness({
        cwd, home, args: { brief: BRIEF },
        responder: async who => {
            if (who === "Specify · review") await writeFile(lease, JSON.stringify({ runId: "intruder", startedAt: "2026-01-01T00:00:00.000Z", heartbeatAt: "2026-01-01T00:00:00.000Z" }));
            return defaultResponder(who);
        },
    });
    const outcome = await run.attempt();
    assert.equal(outcome.status, "error");
    assert.match(outcome.error.message, /now held by run intruder/);
    assert.equal(JSON.parse(await readFile(lease, "utf8")).runId, "intruder", "the other run's lease is left alone");
});

// 5: no symbolic link can move the workflow's reads or writes outside the workspace.
test("containment rejects symbolic links for AGENTS.md, .agentic-loop and its runs folder", async t => {
    for (const [name, link] of [["AGENTS.md", "file"], [".agentic-loop", "dir"], [".agentic-loop/runs", "dir"]]) {
        const { root, cwd, home } = await workspace(t);
        const outside = path.join(root, "outside");
        if (link === "file") await writeFile(outside, "# Outside\n");
        else await mkdir(outside, { recursive: true });
        await mkdir(path.dirname(path.join(cwd, name)), { recursive: true });
        await symlink(outside, path.join(cwd, name));
        const outcome = await harness({ cwd, home, args: { brief: BRIEF } }).attempt();
        assert.equal(outcome.status, "error", name);
        assert.match(outcome.error.message, new RegExp(`${name.replace(/\./g, "\\.")} is a symbolic link`), name);
        if (link === "file") assert.equal(await readFile(outside, "utf8"), "# Outside\n");
        else assert.deepEqual(await (await import("node:fs/promises")).readdir(outside), [], `${name}: nothing written outside the workspace`);
    }
});

test("contained resolves plain workspace paths and refuses escapes and linked record files", async t => {
    const { root, cwd } = await workspace(t);
    assert.equal(await contained(cwd, "docs/spec.md"), path.join(await (await import("node:fs/promises")).realpath(cwd), "docs", "spec.md"));
    for (const bad of ["../x", "a/../../x", "./x", "", "a\\b"]) await assert.rejects(contained(cwd, bad), ContainmentError, bad);
    const runs = path.join(cwd, ".agentic-loop", "runs");
    await mkdir(runs, { recursive: true });
    await writeFile(path.join(root, "target.json"), "{}");
    await symlink(path.join(root, "target.json"), path.join(runs, "run-x.json"));
    await assert.rejects(writeRecord(cwd, { runId: "run-x" }), /runs\/run-x\.json is a symbolic link/);
    assert.equal(await readFile(path.join(root, "target.json"), "utf8"), "{}");
});

// 6: deployment runs only on what was approved.
test("approval fingerprints hash the reviewed files and the azd target without reading secrets", async t => {
    const { cwd } = await workspace(t);
    await azure(cwd);
    const args = validateArgs({ brief: BRIEF });
    const approved = await fingerprint(cwd, args);
    assert.deepEqual(Object.keys(approved.files), [...APPROVED_FILES]);
    assert.equal(approved.files[".azure/deployment-plan.md"], sha("# Plan v1\n"));
    assert.equal(approved.files["docs/verify.md"], null);
    assert.deepEqual(approved.target, { environmentName: "claims-dev", subscriptionId: SUB, location: "eastus2", resourceGroup: "rg-claims-dev" });
    assert.doesNotMatch(JSON.stringify(approved), /s3cret/);
    assert.deepEqual(approvalChanges(approved, await fingerprint(cwd, args)), []);
    await azure(cwd, { plan: "# Plan v2\n", location: "westus3" });
    assert.deepEqual(approvalChanges(approved, await fingerprint(cwd, args)), [".azure/deployment-plan.md", "AZURE_LOCATION (eastus2 → westus3)"]);
    assert.deepEqual(approvalChanges(null, approved), ["no approval fingerprint is recorded"]);
});

for (const changed of [false, true]) {
    test(`deploy ${changed ? "re-asks for approval when the approved plan changed" : "continues without a new approval when nothing changed"}`, async t => {
        const { cwd, home } = await workspace(t);
        await azure(cwd);
        const run = harness({ cwd, home, args: AUTO, responder: who => (who === "Deploy · lead" ? failed(who, "azd up failed: quota") : defaultResponder(who)) });
        assert.deepEqual(await run.attempt(), { status: "paused", key: "approve-deploy-v1" });
        assert.deepEqual(await run.attempt(), { status: "paused", key: "blocked-deploy-r1" });
        let record = await run.record();
        assert.equal(record.deployApproval.key, "approve-deploy-v1");
        assert.equal(record.deployApproval.files[".azure/deployment-plan.md"], sha("# Plan v1\n"));
        assert.equal(record.checkpoints.find(row => row.key === "approve-deploy-v1").fingerprint.target.environmentName, "claims-dev");
        const prompt = promptOf(run, "Deploy · lead");
        assert.match(prompt, /Approved deployment \(approved [^)]+\): AZURE_ENV_NAME=claims-dev, AZURE_SUBSCRIPTION_ID=0000aaaa-bbbb-4ccc-8ddd-eeeeffff0000, AZURE_LOCATION=eastus2, AZURE_RESOURCE_GROUP=rg-claims-dev/);
        assert.match(prompt, /confirm that azd env get-values and az account show report these values; if any differs, change nothing and return blocked/);

        if (changed) await writeFile(path.join(cwd, ".azure", "deployment-plan.md"), "# Plan v2: bigger SKU\n");
        if (!changed) {
            assert.equal((await run.attempt()).status, "completed");
            assert.ok(!run.journal.pauses.has("approve-deploy-r2-v1"));
            assert.deepEqual(latest(run, "Deploy · lead"), ["Deploy · lead · r2"]);
            return;
        }
        assert.deepEqual(await run.attempt(), { status: "paused", key: "approve-deploy-r2-v1" });
        assert.deepEqual(latest(run, "Deploy"), [], "Deploy does not run on a changed plan");
        assert.match(run.state.logs.at(-1), /^Needs you: approve deployment again\. Since you approved it, these changed: \.azure\/deployment-plan\.md\./);
        record = await run.record();
        assert.equal(record.status, "awaiting-approval");
        assert.equal(record.pending, "approve-deploy-r2-v1");
        assert.equal((await run.attempt()).status, "completed");
        record = await run.record();
        assert.equal(record.deployApproval.key, "approve-deploy-r2-v1");
        assert.equal(record.deployApproval.files[".azure/deployment-plan.md"], sha("# Plan v2: bigger SKU\n"));
        assert.ok(run.state.logs.includes("Deployment approved again. Running Deploy."));
    });
}

// 7: only waivers a human records during a blocked checkpoint count.
test("waivers count only when recorded during the blocked checkpoint for one of its issues", async t => {
    const { cwd, home } = await workspace(t);
    const issue = "Evaluation intent_resolution 3.9 is below the 4.0 threshold";
    const run = harness({ cwd, home, args: { ...AUTO, skipDeploy: true }, responder: who => (who.startsWith("Verify · review") ? failed(who, issue) : defaultResponder(who)) });
    const file = path.join(cwd, ...waiverFile("run-1").split("/"));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify([{ issue, reason: "pre-written by a subagent" }]));
    await utimes(file, new Date("2025-06-01"), new Date("2025-06-01"));
    assert.deepEqual(await run.attempt(), { status: "paused", key: "blocked-verify-r1" });
    assert.match(run.state.logs.at(-1), /write it with your reason to \.agentic-loop\/waivers\/run-1\.json/);

    assert.deepEqual(await run.attempt(), { status: "paused", key: "blocked-verify-r2" });
    assert.equal(logMatches(run.state, /^Waivers ignored .*was written before blocked-verify-r1 paused/).length, 1);
    assert.deepEqual((await run.record()).waivers, []);
    assert.doesNotMatch(promptOf(run, "Verify · lead · r2"), /Human-approved waivers \(/);
    assert.equal(await exists(file), false, "a read waiver file is removed");

    await writeFile(file, JSON.stringify({ waivers: [{ issue, reason: "Product owner accepts 3.9 for the pilot" }, { issue: "made-up issue", reason: "x" }, { issue, reason: "" }] }));
    await utimes(file, new Date("2026-06-01"), new Date("2026-06-01"));
    run.state.responder = who => (who.startsWith("Verify · review") && run.state.calls.some(call => call.label === "Verify · lead · r3") ? passed(who) : who.startsWith("Verify · review") ? failed(who, issue) : defaultResponder(who));
    assert.equal((await run.attempt()).status, "completed");
    const record = await run.record();
    assert.equal(record.waivers.length, 1);
    assert.deepEqual({ ...record.waivers[0], approvedAt: "t" }, { issue, reason: "Product owner accepts 3.9 for the pilot", approvedAt: "t", checkpoint: "blocked-verify-r2" });
    assert.match(logMatches(run.state, /^Waivers ignored/).at(-1), /made-up issue/);
    const prompt = promptOf(run, "Verify · lead · r3");
    assert.match(prompt, /Human-approved waivers \(recorded by the workflow at a checkpoint/);
    assert.ok(prompt.includes(`${issue} (reason: Product owner accepts 3.9 for the pilot`));
    assert.match(prompt, /never waive, defer or downgrade an issue yourself/);
    assert.doesNotMatch(promptOf(run, "Specify · lead"), /Human-approved waivers \(/);
});

test("takeWaivers ignores unreadable or malformed files", async t => {
    const { cwd } = await workspace(t);
    const file = path.join(cwd, ...waiverFile("run/x").split("/"));
    assert.match(waiverFile("run/x"), /^\.agentic-loop\/waivers\/run-x-[0-9a-f]{8}\.json$/);
    const context = { runId: "run/x", key: "blocked-verify-r1", pausedAt: "2020-01-01T00:00:00.000Z", issues: ["a"], at: "2026-01-01T00:00:00.000Z" };
    assert.deepEqual(await takeWaivers(cwd, context), { waivers: [], ignored: [] });
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "not json");
    assert.match((await takeWaivers(cwd, context)).ignored[0], /is not a JSON list/);
});

// 9 and 10: evaluator list, azd eval contract, explicit poll deadlines and default ceilings.
test("prompts name the exact evaluators, the azd eval contract and explicit poll deadlines", () => {
    const skills = { router: { name: SKILLS.router, dir: "/skills/router" }, foundry: { name: SKILLS.foundry, dir: "/skills/foundry" } };
    const base = { runId: "run-1", cwd: "/work", record: recordFile("run-1"), skills, args: validateArgs({ brief: BRIEF }) };
    const verify = buildPrompt({ base, phase: "Verify", round: 1, role: "lead", task: "x" });
    for (const text of ["builtin.task_adherence", "builtin.intent_resolution", "builtin.groundedness when the agent is grounded", "content safety is enforced by guardrails",
        "azd ai agent eval generate --agent <service> --dataset tests/eval/dataset.jsonl --out-file tests/eval/<service>.eval.yaml",
        "azd ai agent eval run --agent <service> --config tests/eval/<service>.eval.yaml"]) assert.ok(verify.includes(text), text);
    assert.doesNotMatch(verify, /LAST_EVAL_ID|builtin\.(?:violence|hate|sexual|self_harm|content_safety|coherence|fluency)/);
    assert.match(verify, /evidence as up to 12 \{claim, source, result\} items/);
    assert.match(verify, /poll their status every 30-60 seconds with an explicit deadline \(20 minutes unless the guide sets another\); at the deadline stop and report blocked/);
    assert.doesNotMatch(buildPrompt({ base, phase: "Implement", round: 1, role: "lead", task: "x" }), /builtin\.task_adherence/);
});

test("META declares default ceilings that cover a multi-round run", () => {
    assert.deepEqual(META.limits, { maxTotalSubagents: 250, maxConcurrentSubagents: 4, timeoutSeconds: 43_200 });
    // Calls per run: Implement round 1 is foundation + up to 4 workers + integration + review, other rounds lead + review; each fix adds fix + review.
    const calls = (fixes, rounds) => 4 * rounds * (2 + 2 * fixes) + 5;
    assert.ok(calls(2, 3) <= META.limits.maxTotalSubagents / 3, "default fix loops, three rounds per phase, with room for retries");
    assert.ok(calls(5, 3) <= META.limits.maxTotalSubagents, "maximum fix loops, three rounds per phase");
    assert.ok(META.limits.maxConcurrentSubagents >= 4, "four parallel workstreams");
});

// 11: provenance and drift of the skills the subagents follow.
test("skill provenance records source, version and hashes, and a resume logs drift", async t => {
    const { root, cwd, home } = await workspace(t);
    const plugin = path.join(root, "plugin");
    await routerSkill(path.join(plugin, "skills", SKILLS.router));
    await writeFile(path.join(plugin, "plugin.json"), JSON.stringify({ name: "x", version: "9.9.9" }));
    const provenance = await skillProvenance({ router: { name: SKILLS.router, dir: path.join(plugin, "skills", SKILLS.router), source: "plugin" }, foundry: { name: SKILLS.foundry, dir: null, source: "skill-tool" } });
    assert.deepEqual(provenance[SKILLS.foundry], { source: "skill-tool", kind: "other", path: null, version: null, files: {} });
    const router = provenance[SKILLS.router];
    assert.equal(router.kind, "plugin");
    assert.equal(router.version, "9.9.9");
    assert.deepEqual(Object.keys(router.files), ["SKILL.md", "references/sdd.md", "references/specify.md", "references/implement.md", "references/verify.md", "references/deploy.md"]);
    assert.equal(router.files["SKILL.md"], sha("# Router\n"));
    assert.deepEqual(skillDrift(provenance, provenance), []);

    const override = path.join(cwd, ".github", "skills", SKILLS.router);
    await routerSkill(override);
    const run = harness({ cwd, home, args: { brief: BRIEF } });
    assert.deepEqual(await run.attempt(), { status: "paused", key: "approve-spec-v1" });
    let record = await run.record();
    assert.equal(record.skillProvenance[SKILLS.router].kind, "project-override");
    assert.equal(record.skillProvenance[SKILLS.router].path, override);
    assert.deepEqual(record.skillDrift, []);
    await writeFile(path.join(override, "references", "verify.md"), "# changed\n");
    assert.deepEqual(await run.attempt(), { status: "paused", key: "approve-deploy-v1" });
    assert.equal(logMatches(run.state, /^Skill drift since this run started: foundry-agentic-loop\/references\/verify\.md sha256 /).length, 1);
    record = await run.record();
    assert.equal(record.skillDrift.length, 1);
    assert.equal(record.skillDrift[0].file, "references/verify.md");
    assert.equal(record.skillProvenance[SKILLS.router].files["references/verify.md"], sha("# verify.md\n"), "the original provenance is kept");
});

// 12: a single-phase rerun inherits earlier phases only from a record that passed them.
test("from reruns a phase only when the latest flight record passed every earlier phase", async t => {
    assert.throws(() => validateArgs({ brief: BRIEF, from: "verify" }), /args.from must be one of Specify, Implement, Verify, Deploy/);
    assert.throws(() => validateArgs({ brief: BRIEF, from: "Deploy", skipDeploy: true }), /cannot be Deploy when skipDeploy/);

    const { cwd, home } = await workspace(t);
    const none = await harness({ cwd, home, runId: "run-0", args: { ...AUTO, from: "Verify" } }).attempt();
    assert.equal(none.status, "error");
    assert.match(none.error.message, /^Cannot start at Verify: this workspace has no earlier Agentic Loop flight record/);

    const first = harness({ cwd, home, runId: "run-1", args: { ...AUTO, skipDeploy: true }, responder: who => (who === "Implement · review" ? failed(who) : defaultResponder(who)) });
    assert.deepEqual(await first.attempt(), { status: "paused", key: "blocked-implement-r1" });
    const refused = await harness({ cwd, home, runId: "run-2", args: { ...AUTO, from: "Verify" } }).attempt();
    assert.equal(refused.status, "error");
    assert.match(refused.error.message, /^Cannot start at Verify: the latest run, run-1, has no passed Implement gate\./);
    assert.equal(await exists(path.join(cwd, ...recordFile("run-2").split("/"))), false, "a refused rerun writes no record");

    assert.equal((await first.attempt()).status, "completed");
    const rerun = harness({ cwd, home, runId: "run-3", args: { ...AUTO, from: "Verify", skipDeploy: true } });
    const outcome = await rerun.attempt();
    assert.equal(outcome.status, "completed");
    assert.deepEqual(rerun.state.phases, ["Verify"]);
    assert.deepEqual(labels(rerun.state), ["Verify · lead", "Verify · review"]);
    assert.deepEqual(outcome.result.phases, { Specify: "passed", Implement: "passed", Verify: "passed", Deploy: "skipped" });
    assert.match(logMatches(rerun.state, /^Implement gate: passed — Inherited from run run-1/)[0], /Implement · review · r2 done/);
    const record = await rerun.record();
    assert.deepEqual(record.rerun, { from: "Verify", runId: "run-1" });
    assert.deepEqual(record.phases.slice(0, 2).map(row => [row.phase, row.round, row.status, row.inheritedFrom]), [["Specify", 0, "passed", "run-1"], ["Implement", 0, "passed", "run-1"]]);
});

// 13: ownership is checked against git after the workers, never trusted from their reports.
test("workstream ownership: overlapping claims are rejected and unowned changes go to integration", async t => {
    assert.match(planWorkstreams([{ name: "a", files: ["src/**"] }, { name: "b", files: ["src/api/x.py"] }]).reason, /both claim src/);
    assert.equal(owner("src/web/app/page.tsx", WORKSTREAMS), "web");
    assert.equal(owner("SRC/API/main.py", WORKSTREAMS), "api");
    assert.equal(owner("src/apiary/x.py", WORKSTREAMS), null);
    assert.equal(owner("README.md", WORKSTREAMS), null);
    assert.equal(ownershipCheck(null, null, WORKSTREAMS).checked, false);

    const { cwd, home } = await workspace(t);
    await git("git", ["init", "-q"], { cwd });
    await writeFile(path.join(cwd, "notes.txt"), "dirty before the fan-out\n");
    const write = async (file, text) => {
        await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
        await writeFile(path.join(cwd, file), text);
    };
    const run = harness({
        cwd, home, args: { ...AUTO, skipDeploy: true },
        responder: async who => {
            if (who === "Implement · api") await write("src/api/main.py", "app = 1\n");
            if (who === "Implement · web") {
                await write("src/web/index.html", "<html></html>\n");
                await write("README.md", "# edited by a worker\n");
            }
            return defaultResponder(who);
        },
    });
    assert.equal((await run.attempt()).status, "completed");
    assert.ok(run.state.logs.includes("Workstream ownership: 1 changed path outside every workstream: README.md. Integration resolves them."));
    assert.match(promptOf(run, "Implement · integration"), /no workstream owns \(integration issues; nothing was reverted\)[^\n]*\n- README\.md$/m);
    const record = await run.record();
    assert.deepEqual(record.ownership.map(row => [row.phase, row.round, row.checked, row.unowned]), [["Implement", 1, true, ["README.md"]]]);
    assert.equal(await readFile(path.join(cwd, "README.md"), "utf8"), "# edited by a worker\n", "nothing is reverted");
});

test("workstream ownership is skipped gracefully outside a git repository", async t => {
    const { cwd, home } = await workspace(t);
    const run = harness({ cwd, home, args: { ...AUTO, skipDeploy: true } });
    assert.equal((await run.attempt()).status, "completed");
    assert.equal(logMatches(run.state, /^Workstream ownership not checked: git is not available or the workspace is not a repository\.$/).length, 1);
    assert.deepEqual((await run.record()).ownership.map(row => row.checked), [false]);
});

// 14: distinct run IDs never share a flight record.
test("runFile keeps safe IDs and hashes any other ID so distinct IDs never collide", () => {
    assert.equal(runFile("run-1"), "run-1.json");
    assert.equal(runFile("a".repeat(120)), `${"a".repeat(120)}.json`);
    const long = "a".repeat(121);
    assert.equal(runFile(long), `${"a".repeat(100)}-${sha(long).slice(0, 8)}.json`);
    const ids = ["a/b", "a:b", "a b", "a-b", "a_b", "../a", "é", "", "a\u0000b"];
    const files = ids.map(runFile);
    assert.equal(new Set(files).size, ids.length);
    assert.ok(files.every(file => /^[A-Za-z0-9._-]{1,120}\.json$/.test(file) && !file.startsWith("..json")));
    assert.equal(runFile("a/b"), `a-b-${sha("a/b").slice(0, 8)}.json`);
});

// 16: the entry point's wiring, without the runtime SDK.
test("createWorkflow defines the workflow with META and a run function bound to runLoop", async () => {
    const calls = [];
    const workflow = createWorkflow({ defineWorkflow: definition => (calls.push(definition), { defined: definition }), extensionDir });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].meta, META);
    assert.equal(typeof calls[0].run, "function");
    assert.equal(workflow.defined, calls[0]);
    await assert.rejects(calls[0].run({ args: {} }), /args.brief is required/);
});
