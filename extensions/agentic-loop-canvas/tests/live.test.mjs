import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Live, PHASES, WORKFLOW, blockerOf, briefOf, checkpointInfo, checkpointOf, flightRecordPath, outcomeOf, parseGates, planOf, shapeRun, shapeSummary } from "../lib/live.mjs";

const log = (seq, text) => ({ seq, kind: "log", text, recordedAt: seq * 1000 });
const summary = (runId, overrides = {}) => ({
    runId, workflowName: WORKFLOW, status: "running", createdAt: 1, updatedAt: 2, completedAt: null,
    currentPhase: { ordinal: 1 }, canResume: false, ...overrides,
});
const detail = (runId, overrides = {}) => ({
    ...summary(runId),
    phases: [
        { id: "p0", ordinal: 0, title: "Specify", status: "completed", startedAt: 10, completedAt: 20, accumulatedActiveMs: 1000 },
        { id: "p1", ordinal: 1, title: "Implement", status: "active", startedAt: 21, accumulatedActiveMs: 500, currentActiveMs: 250 },
    ],
    agents: [
        { agentId: "a1", phaseId: "p0", label: "specify", displayName: "Specify · spec writer", status: "completed", resolvedModel: "claude-sonnet-5", activeMs: 900 },
        { agentId: "a2", phaseId: "p1", label: "implement", status: "running", requestedModel: "gpt-5.5", activity: "Running unit tests", startedAt: 22 },
    ],
    progress: { records: [log(1, "Brief: Claims triage for a regional insurer"), log(2, "Specify gate: passed — 14 requirements, 3 agents"), { seq: 3, kind: "phase", text: "Implement" }] },
    consumed: { activeMs: 1750, subagents: 2, nanoAiu: 2_500_000_000 },
    liveAgentCount: 1,
    ...overrides,
});

function fakeSession({ runs = [], details = {}, older = [], processing = false } = {}) {
    const handlers = new Map();
    const calls = { listRuns: 0, getRunDetail: [], getRunProgress: [] };
    return {
        calls, handlers, runs, details,
        on(type, handler) {
            handlers.set(type, [...(handlers.get(type) ?? []), handler]);
            return () => handlers.set(type, (handlers.get(type) ?? []).filter(row => row !== handler));
        },
        emit(type, event = {}) { for (const handler of handlers.get(type) ?? []) handler({ type, ...event }); },
        rpc: { metadata: { isProcessing: async () => ({ processing }) } },
        workflow: {
            listRuns: async () => { calls.listRuns += 1; return runs; },
            getRunDetail: async runId => { calls.getRunDetail.push(runId); return details[runId] ?? detail(runId); },
            getRunProgress: async (runId, options) => {
                calls.getRunProgress.push(options);
                const rows = older.filter(row => row.seq < options.beforeSeq).slice(-options.limit);
                return { records: rows, hasMoreOlder: rows.length > 0 && rows[0].seq > older[0].seq };
            },
        },
    };
}

async function workspace(t, files = []) {
    const directory = await mkdtemp(path.join(tmpdir(), "agentic-loop-live-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    for (const file of files) {
        await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
        await writeFile(path.join(directory, file), "# artifact\n");
    }
    return () => directory;
}

test("gate and brief lines parse from main-flow logs only", () => {
    const records = [
        { seq: 1, kind: "phase", text: "Specify gate: passed" },
        log(2, "Brief: " + "x".repeat(200)),
        log(3, "Specify gate: passed — spec approved"),
        log(4, "Verify gate: failed - 2 acceptance criteria unmet"),
        log(5, "Verify gate: passed"),
        log(6, "Deploy gate: maybe"),
        log(7, "Brief: second brief is ignored"),
    ];
    assert.deepEqual(parseGates(records), {
        Specify: { status: "passed", summary: "spec approved", seq: 3 },
        Verify: { status: "passed", summary: "", seq: 5 },
    });
    assert.equal(briefOf(records).length, 160);
    assert.equal(briefOf([]), null);
    assert.deepEqual(parseGates(), {});
});

test("checkpoints surface only for paused checkpoint runs", () => {
    assert.equal(checkpointOf({ status: "paused", terminal: { pauseInfo: { type: "checkpoint", key: "approve-spec-v1" } } }), "approve-spec-v1");
    assert.equal(checkpointOf({ status: "paused", terminal: { pauseInfo: { type: "manual" } } }), null);
    assert.equal(checkpointOf({ status: "running", terminal: { pauseInfo: { type: "checkpoint", key: "approve-spec-v1" } } }), null);
});

test("checkpoint keys normalize to kind, phase and round", () => {
    assert.deepEqual(checkpointInfo("approve-spec-v1"), { key: "approve-spec-v1", kind: "approve", phase: "Specify", round: 1 });
    assert.deepEqual(checkpointInfo("approve-deploy-v1"), { key: "approve-deploy-v1", kind: "approve", phase: "Deploy", round: 1 });
    assert.deepEqual(checkpointInfo("blocked-verify-r3"), { key: "blocked-verify-r3", kind: "blocked", phase: "Verify", round: 3 });
    assert.equal(checkpointInfo("blocked-plan-r1").kind, "other");
    assert.equal(checkpointInfo("blocked-verify-r0").kind, "other");
    assert.equal(checkpointInfo("toString").kind, "other");
    assert.equal(checkpointInfo(null), null);
    const paused = shapeSummary(summary("r", { status: "paused", canResume: true, terminal: { pauseInfo: { type: "checkpoint", key: "blocked-deploy-r1" } } }));
    assert.deepEqual(paused.pause, { key: "blocked-deploy-r1", kind: "blocked", phase: "Deploy", round: 1 });
    assert.equal(paused.checkpoint, "blocked-deploy-r1");
    assert.equal(shapeSummary(summary("r1", { currentPhase: { ordinal: 3 } })).phase, "Deploy");
    assert.equal(shapeSummary(summary("r1", { currentPhase: null })).phase, null);
});

test("run detail maps the four phases, agents, gates, artifacts and metrics", () => {
    const run = shapeRun(detail("r1"), new Set(["docs/spec.md", "LOOP.md"]));
    assert.deepEqual(run.phases.map(row => [row.title, row.status]), [["Specify", "completed"], ["Implement", "active"], ["Verify", "pending"], ["Deploy", "pending"]]);
    assert.deepEqual(run.phases[0].gate, { status: "passed", summary: "14 requirements, 3 agents", seq: 2 });
    assert.equal(run.phases[1].activeMs, 750);
    assert.deepEqual(run.phases[0].agents[0], { id: "a1", label: "Specify · spec writer", status: "completed", model: "claude-sonnet-5", startedAt: null, activeMs: 900, activity: null });
    assert.equal(run.phases[1].agents[0].model, "gpt-5.5");
    assert.equal(run.phases[1].agents[0].startedAt, 22);
    assert.equal(run.plan, null);
    assert.equal(run.blocker, null);
    assert.deepEqual(run.phases[0].artifacts, [{ path: "docs/spec.md", exists: true }, { path: ".azure/deployment-plan.md", exists: false }]);
    assert.equal(run.brief, "Claims triage for a regional insurer");
    assert.equal(run.metrics.credits, 2.5);
    assert.equal(run.loop, true);
    assert.equal(run.phase, "Implement");
    assert.equal(PHASES.length, 4);
});

test("completed runs read their outcome and safe endpoints from the flight record", async t => {
    const session = fakeSession({ runs: [summary("run:1", { status: "completed" })], details: { "run:1": detail("run:1", { status: "completed" }) } });
    const root = await workspace(t);
    const endpoints = [
        { name: "web", url: "https://app.example.com/" },
        { name: "script", url: "javascript:alert(1)" },
        { name: "credentials", url: "https://user:secret@api.example.com" },
        { url: "http://localhost:3000" },
    ];
    await mkdir(path.join(root(), ".agentic-loop", "runs"), { recursive: true });
    await writeFile(path.join(root(), flightRecordPath("run:1")), JSON.stringify({ status: "verified", endpoints }));
    const live = new Live({ session, workspace: root });
    t.after(() => live.stop());
    await live.start();
    assert.equal(flightRecordPath("run:1"), ".agentic-loop/runs/run_1.json");
    assert.deepEqual(live.snapshot().run.outcome, { status: "verified", endpoints: [{ name: "web", url: "https://app.example.com/" }, { name: "localhost", url: "http://localhost:3000/" }] });
    assert.equal(outcomeOf({ status: "running" }), null);
    assert.equal(outcomeOf(null), null);
    assert.equal(shapeRun(detail("r2"), new Set(), undefined, { status: "deployed", endpoints: [] }).outcome, null, "only completed runs carry an outcome");
});

test("running runs read their plan from the flight record so the canvas can name the next decision", async t => {
    const session = fakeSession({ runs: [summary("run-2")] });
    const root = await workspace(t);
    await mkdir(path.join(root(), ".agentic-loop", "runs"), { recursive: true });
    await writeFile(path.join(root(), flightRecordPath("run-2")), JSON.stringify({ status: "running", autonomy: "auto", skipDeploy: true, maxFixLoops: 2, endpoints: [{ name: "web", url: "https://x.example.com" }] }));
    const live = new Live({ session, workspace: root });
    t.after(() => live.stop());
    await live.start();
    assert.deepEqual(live.snapshot().run.plan, { autonomy: "auto", skipDeploy: true, maxFixLoops: 2 });
    assert.equal(live.snapshot().run.outcome, null, "a running run has no outcome yet");
    assert.deepEqual(planOf({ autonomy: "sideways", skipDeploy: "yes", maxFixLoops: 1.5 }), { autonomy: "gated", skipDeploy: false, maxFixLoops: null });
    for (const value of [null, [], "x"]) assert.equal(planOf(value), null);
});

test("blocked runs list every gate issue of the paused round from the flight record", async t => {
    const key = "blocked-specify-r1";
    const paused = { status: "paused", canResume: true, terminal: { pauseInfo: { type: "checkpoint", key } } };
    const session = fakeSession({ runs: [summary("run-3", paused)], details: { "run-3": detail("run-3", paused) } });
    const root = await workspace(t);
    const issues = ["Fraud agent cannot read coverage limits", "Section 9.2 has no loss_date per scenario", "FR-010 priority is undefined when the decision is null"];
    const attempts = ["lead", "review", "fix", "review", "fix", "review"].map(role => ({ role }));
    await mkdir(path.join(root(), ".agentic-loop", "runs"), { recursive: true });
    await writeFile(path.join(root(), flightRecordPath("run-3")), JSON.stringify({
        status: "blocked", autonomy: "gated", maxFixLoops: 2,
        phases: [{ phase: "Specify", round: 1, status: "failed", summary: "Placement passes;\n3 gaps remain", issues: [...issues, " "], attempts }],
    }));
    const live = new Live({ session, workspace: root });
    t.after(() => live.stop());
    await live.start();
    assert.deepEqual(live.snapshot().run.blocker, { status: "failed", summary: "Placement passes; 3 gaps remain", issues, fixes: 2 });
    const record = { phases: [{ phase: "Specify", round: 1, status: "failed", issues }, { phase: "Specify", round: 2, status: "passed", issues: [] }] };
    assert.equal(blockerOf(record, checkpointInfo("blocked-specify-r2")), null, "only a failed or blocked entry for the paused round counts");
    assert.equal(blockerOf(record, checkpointInfo("approve-spec-v1")), null);
    assert.equal(blockerOf(null, checkpointInfo(key)), null);
    assert.equal(blockerOf({ phases: "x" }, checkpointInfo(key)), null);
});

test("busy follows main-agent turns and active runs, ignoring sub-agent events", async t => {
    const session = fakeSession({ runs: [summary("other", { workflowName: "something-else" })] });
    const live = new Live({ session, workspace: await workspace(t) });
    t.after(() => live.stop());
    await live.start();
    const first = live.snapshot();
    assert.deepEqual(Object.keys(first).sort(), ["busy", "busySince", "error", "run", "runs", "selectedRunId", "version"]);
    assert.equal(first.busy, false);
    assert.deepEqual(first.runs, [], "other workflows are not shown");
    session.emit("assistant.turn_start", { agentId: "sub-1" });
    assert.equal(live.snapshot().busy, false);
    session.emit("user.message");
    assert.equal(live.snapshot().busy, true);
    assert(live.snapshot().busySince > 0);
    session.emit("session.idle");
    assert.equal(live.snapshot().busy, false);
    session.runs.push(summary("r1"));
    await live.refresh();
    assert.equal(live.snapshot().busy, true, "a running workflow keeps the enablement dock alive");
});

test("new runs are selected automatically and reported once", async t => {
    const session = fakeSession({ runs: [summary("r1", { status: "completed", createdAt: 1 })] });
    const live = new Live({ session, workspace: await workspace(t, ["docs/spec.md"]) });
    t.after(() => live.stop());
    const seen = [];
    live.onNewRun = run => seen.push(run.runId);
    await live.start();
    assert.equal(live.snapshot().selectedRunId, "r1");
    assert.deepEqual(seen, [], "runs present at start are not new");
    assert.equal(live.snapshot().run.phases[0].artifacts[0].exists, true);
    session.runs.push(summary("r2", { createdAt: 5 }));
    await live.refresh();
    assert.deepEqual(seen, ["r2"]);
    assert.equal(live.snapshot().selectedRunId, "r2");
    assert.deepEqual(live.snapshot().runs.map(row => row.runId), ["r2", "r1"]);
    await live.select("r1");
    assert.equal(live.snapshot().selectedRunId, "r1");
    await live.refresh();
    assert.deepEqual(seen, ["r2"]);
    assert.throws(() => live.select("missing"), /no longer available/);
});

test("long-poll waiters wake on change, on abort and immediately for stale versions", async t => {
    const live = new Live({ session: fakeSession(), workspace: await workspace(t) });
    t.after(() => live.stop());
    await live.start();
    const version = live.version;
    await live.wait(version - 1);
    const woken = live.wait(version);
    live.setBusy(true);
    await woken;
    assert.equal(live.version, version + 1);
    const controller = new AbortController();
    const aborted = live.wait(live.version, { signal: controller.signal });
    controller.abort();
    await aborted;
    const timed = Date.now();
    await live.wait(live.version, { timeoutMs: 20 });
    assert(Date.now() - timed >= 15);
    assert.equal(live.waiters.size, 0);
});

test("older gate records are fetched once and cached across refreshes", async t => {
    const older = Array.from({ length: 5 }, (_, index) => log(index + 1, index === 0 ? "Brief: From an older page" : index === 1 ? "Specify gate: passed — approved" : `line ${index + 1}`));
    const tail = [log(6, "Implement gate: passed — build green"), log(7, "working")];
    const session = fakeSession({
        runs: [summary("r1")],
        details: { r1: detail("r1", { progress: { records: tail, hasMoreOlder: true } }) },
        older,
    });
    const live = new Live({ session, workspace: await workspace(t) });
    t.after(() => live.stop());
    await live.start();
    const run = live.snapshot().run;
    assert.equal(run.brief, "From an older page");
    assert.equal(run.phases[0].gate.summary, "approved");
    assert.equal(run.phases[1].gate.summary, "build green");
    const fetched = session.calls.getRunProgress.length;
    assert(fetched >= 1);
    await live.refresh();
    assert.equal(session.calls.getRunProgress.length, fetched, "a cache that reaches the tail needs no request");
    older.push(...tail);
    session.details.r1 = detail("r1", { progress: { records: [log(8, "Verify gate: passed — 9/9 criteria"), log(9, "done")], hasMoreOlder: true } });
    await live.refresh();
    assert.equal(session.calls.getRunProgress.at(-1).beforeSeq, 8);
    const slid = live.snapshot().run;
    assert.equal(slid.brief, "From an older page");
    assert.deepEqual(PHASES.slice(0, 3).map(title => slid.phases.find(row => row.title === title).gate?.summary), ["approved", "build green", "9/9 criteria"]);
});

test("errors are reported without dropping the last good state, and stop releases listeners", async t => {
    const session = fakeSession({ runs: [summary("r1")] });
    const live = new Live({ session, workspace: await workspace(t) });
    await live.start();
    const listRuns = session.workflow.listRuns;
    session.workflow.listRuns = async () => { throw new Error("Workflow store unavailable"); };
    await live.refresh();
    assert.equal(live.snapshot().error, "Workflow store unavailable");
    assert.equal(live.snapshot().runs.length, 1);
    session.workflow.listRuns = listRuns;
    await live.refresh();
    assert.equal(live.snapshot().error, null);
    const pending = live.wait(live.version, { timeoutMs: 5_000 });
    live.stop();
    await pending;
    assert(["user.message", "session.idle", "workflow.run_updated"].every(type => !session.handlers.get(type)?.length));
});
