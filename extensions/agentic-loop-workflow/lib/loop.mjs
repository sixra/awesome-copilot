import os from "node:os";
import path from "node:path";
import { PHASES, firstLine, validateArgs } from "./args.mjs";
import { FOUNDATION_SCHEMA, REPORT_SCHEMA, TASKS, buildPrompt, label } from "./prompts.mjs";
import { clean, createRecord, endpoints, normalize, planWorkstreams, recordFile, reduce, union, writeRecord } from "./record.mjs";
import { missingSkills, resolveSkills } from "./skills.mjs";

export const MAX_ROUNDS = 20;

export async function workspace(session) {
    const snapshot = await session?.rpc?.metadata?.snapshot?.();
    if (!snapshot?.workingDirectory) throw new Error("The session has no working directory. Open a folder or repository in the session, then start a new run.");
    return path.resolve(snapshot.workingDirectory);
}

const count = (n, noun, plural = `${noun}s`) => `${n} ${n === 1 ? noun : plural}`;
const sentence = text => (/[.!?…]$/.test(text) ? text : `${text}.`);
const withNext = (head, next, max = 300) => (next ? `${sentence(clean(head, max - next.length - 2))} ${next}` : clean(head, max));

// Failed and blocked gates lead with their issues, because summaries often open with what passed.
export function gateLine({ phase, status, summary, issues }) {
    const detail = status === "passed" || !issues.length ? summary : `${count(issues.length, "issue")}: ${issues[0]} · ${summary}`;
    return clean(`${phase} gate: ${status} — ${detail}`, 300);
}

// One Chat line per report, ending with what runs next so a quiet chat never reads as stuck.
export function noteLine({ role, who, report }, next = "") {
    const { status, summary, issues } = report;
    const head = status === "passed" ? `${who} passed: ${summary}`
        : status === "blocked" ? `${who} blocked: ${summary}`
            : role === "review" ? `${who} found ${count(issues.length, "issue")}: ${issues[0] ?? summary}`
                : `${who} failed: ${summary}`;
    return withNext(head, next);
}

// After a worker the caller's next step always follows; otherwise a pass follows it and a failure gets an automatic fix while any remain.
export function nextStep({ role, report }, { onPass = "", fixes = 0, maxFixLoops = 0 } = {}) {
    if (role === "worker" || report.status === "passed") return onPass;
    return report.status === "failed" && fixes < maxFixLoops ? `Next: automatic fix ${fixes + 1} of ${maxFixLoops}.` : "";
}

// Chat lines for a checkpoint: what the run waits for and how to continue, then what resuming does.
export function checkpointLines(key, { phase, round, status, issues = [], fixes = 0 } = {}) {
    if (key === "approve-spec-v1") {
        return {
            wait: 'Needs you: approve the spec. Review docs/spec.md and .azure/deployment-plan.md, then choose "Approve spec and continue" in the Agentic Loop canvas (Workflow tab) or tell Copilot "approve the spec". Nothing is provisioned until you approve.',
            resume: "Spec approved. Continuing with Implement.",
        };
    }
    if (key === "approve-deploy-v1") {
        return {
            wait: 'Needs you: approve deployment. Review docs/verify.md and .azure/deployment-plan.md, then choose "Approve deployment" in the Agentic Loop canvas (Workflow tab) or tell Copilot "approve deployment". azd up adds billable Azure resources.',
            resume: "Deployment approved. Running Deploy.",
        };
    }
    const why = status === "blocked" ? `${phase} is blocked` : `${phase} still fails its gate${fixes ? ` after ${count(fixes, "automatic fix", "automatic fixes")}` : ""}`;
    const first = issues.length ? clean(issues[0], 140) : "";
    const cause = issues.length > 1 ? ` (${issues.length} issues; first: ${first})` : first ? ` (${first})` : "";
    return {
        wait: `Needs you: ${why}${cause}. Ask Copilot to fix ${issues.length > 1 ? "them" : "it"}, or use "Fix in Chat" on the Workflow tab of the Agentic Loop canvas, then resume to retry ${phase}.`,
        resume: `Resumed: retrying ${phase} as round ${round + 1}.`,
    };
}

async function save(ctx, cwd, record) {
    try { await writeRecord(cwd, record); }
    catch (error) { ctx.log(`Flight record not saved: ${clean(error?.message ?? error, 200)}`); }
}

// Maker, independent checker and bounded fixer per phase; every side effect is journaled so pauses and resumes replay exactly.
class Run {
    constructor(ctx, args, setup, now) {
        this.ctx = ctx;
        this.args = args;
        this.now = now;
        this.cwd = setup.cwd;
        this.base = { runId: ctx.runId, cwd: setup.cwd, skills: setup.skills, args };
        this.record = createRecord({ runId: ctx.runId, args, setup });
    }

    async event(key, make) {
        const event = await this.ctx.step(key, async () => {
            const event = await make(this.now());
            await save(this.ctx, this.cwd, reduce(this.record, event));
            return event;
        });
        this.record = reduce(this.record, event);
        return event;
    }

    async checkpoint(key, kind, context) {
        const lines = checkpointLines(key, context);
        const pending = await this.event(`await-${key}`, at => {
            this.ctx.log(lines.wait);
            return { type: "pending", key, kind, at };
        });
        await this.ctx.pause(key);
        await this.event(`resume-${key}`, at => {
            this.ctx.log(lines.resume);
            return { type: "resumed", key, kind, pausedAt: pending.at, at };
        });
    }

    async call({ phase, round, role, name = role, schema = REPORT_SCHEMA, ...context }) {
        const who = label(phase, name, round);
        const prompt = buildPrompt({ base: this.base, phase, round, role, who, ...context });
        return { role, who, report: normalize(await this.ctx.agent(prompt, { label: who, schema }), who) };
    }

    async phase(phase) {
        let previous = null;
        for (let round = 1; round <= MAX_ROUNDS; round += 1) {
            const entry = await this.gate(phase, round, await this.round(phase, round, previous));
            if (entry.status === "passed") return entry;
            const fixes = entry.attempts.filter(attempt => attempt.role === "fix").length;
            await this.checkpoint(`blocked-${phase.toLowerCase()}-r${round}`, "blocked", { phase, round, status: entry.status, issues: entry.issues, fixes });
            previous = { status: entry.status, summary: entry.summary, issues: entry.issues };
        }
        throw new Error(`${phase} did not pass its gate in ${MAX_ROUNDS} rounds. Fix the root cause from the gate issues, then start a new run.`);
    }

    async round(phase, round, previous) {
        const attempts = [];
        const { maxFixLoops } = this.args;
        let fixes = 0;
        const track = async (attempt, onPass = "") => {
            attempts.push(attempt);
            await this.ctx.step(`note-${phase.toLowerCase()}-r${round}-${attempts.length}-v1`, () => {
                this.ctx.log(noteLine(attempt, nextStep(attempt, { onPass, fixes, maxFixLoops })));
                return true;
            });
            return attempt.report;
        };
        const tasks = TASKS[phase];
        // Each review first re-checks the issues that were just addressed, so reviews converge instead of resampling.
        const review = (name, recheck) => this.call({ phase, round, role: "review", name, task: tasks.review, recheck });
        let verdict = await this.make(phase, round, previous, track);
        if (verdict.status === "passed") verdict = await track(await review("review", previous && { from: `the round ${round - 1} gate`, issues: previous.issues }));
        for (let fix = 1; verdict.status === "failed" && fix <= maxFixLoops; fix += 1) {
            fixes = fix;
            const { issues } = verdict;
            const fixed = await track(await this.call({ phase, round, role: "fix", name: `fix ${fix}`, task: tasks.fix, fix: { attempt: fix, max: maxFixLoops, issues } }), `Next: review ${fix + 1}.`);
            verdict = fixed.status === "passed" ? await track(await review(`review ${fix + 1}`, { from: `fix ${fix}`, issues })) : fixed;
        }
        return { verdict, attempts };
    }

    async make(phase, round, previous, track) {
        const tasks = TASKS[phase];
        const review = "Next: independent review.";
        if (phase !== "Implement" || round > 1) return track(await this.call({ phase, round, role: "lead", task: tasks.lead, previous }), review);
        const foundation = await track(await this.call({ phase, round, role: "lead", name: "foundation", task: tasks.foundation, schema: FOUNDATION_SCHEMA }), "Next: workstream plan.");
        if (foundation.status !== "passed") return foundation;
        const plan = await this.ctx.step(`plan-implement-r${round}-v1`, () => {
            const plan = planWorkstreams(foundation.workstreams);
            this.ctx.log(plan.mode === "parallel"
                ? clean(`Implement plan: ${plan.items.length} parallel workstreams (${plan.items.map(item => item.name).join(", ")})`, 300)
                : clean(`Implement plan: sequential build (${plan.reason})`, 300));
            return plan;
        });
        if (plan.mode !== "parallel") return track(await this.call({ phase, round, role: "lead", name: "build", task: tasks.build }), review);
        const workers = await this.ctx.parallel(plan.items.map(workstream => () =>
            this.call({ phase, round, role: "worker", name: workstream.name, task: tasks.worker, workstream })));
        const results = [];
        for (const [index, workstream] of plan.items.entries()) {
            const who = label(phase, workstream.name, round);
            const last = index === plan.items.length - 1;
            const report = await track(workers[index] ?? { role: "worker", who, report: normalize(null, who) }, last ? "Next: integration." : "");
            results.push({ name: workstream.name, status: report.status, summary: report.summary, issues: report.issues });
        }
        return track(await this.call({ phase, round, role: "lead", name: "integration", task: tasks.integration, results }), review);
    }

    async gate(phase, round, { verdict, attempts }) {
        const reports = attempts.map(attempt => attempt.report);
        const { entry } = await this.event(`gate-${phase.toLowerCase()}-r${round}-v1`, at => {
            const entry = {
                phase,
                round,
                status: verdict.status,
                summary: verdict.summary,
                at,
                attempts: attempts.map(({ role, who, report }) => ({ role, label: who, status: report.status, summary: report.summary, issues: report.issues })),
                issues: verdict.issues,
                lessons: union(reports.map(report => report.lessons)),
                assumptions: union(reports.map(report => report.assumptions)),
                artifacts: union(reports.map(report => report.artifacts), 300),
                endpoints: endpoints(reports.flatMap(report => report.endpoints).reverse()),
            };
            this.ctx.log(gateLine(entry));
            return { type: "gate", at, entry };
        });
        return entry;
    }

    async skip(phase) {
        await this.event(`skip-${phase.toLowerCase()}-v1`, at => {
            this.ctx.log(`${phase} skipped: skipDeploy is set, so the run ends after Verify.`);
            return { type: "skipped", phase, summary: "skipDeploy was set.", at };
        });
    }

    async finish() {
        const status = this.args.skipDeploy ? "verified" : "deployed";
        const passed = this.record.phases.filter(entry => entry.status === "passed");
        const outcome = {
            status,
            runId: this.ctx.runId,
            phases: Object.fromEntries(PHASES.map(phase => [phase, passed.some(entry => entry.phase === phase) ? "passed" : "skipped"])),
            rounds: Object.fromEntries(PHASES.map(phase => [phase, this.record.phases.filter(entry => entry.phase === phase && entry.round > 0).length])),
            endpoints: this.record.endpoints,
            flightRecord: recordFile(this.ctx.runId),
        };
        await this.event("result-v1", at => {
            const links = outcome.endpoints.length ? ` Endpoints: ${outcome.endpoints.map(row => `${row.name} ${row.url}`).join(", ")}.` : "";
            this.ctx.log(clean(`Agentic Loop ${status}.${links} Flight record: ${outcome.flightRecord}`, 600));
            return { type: "done", status, outcome, at };
        });
        return outcome;
    }

    async fail(error) {
        const message = clean(error?.message ?? error, 500) || "Unknown error";
        await save(this.ctx, this.cwd, reduce(this.record, { type: "error", message, at: this.now() }));
    }
}

export async function runLoop(ctx, { extensionDir, home = os.homedir(), now = () => new Date().toISOString() }) {
    const args = validateArgs(ctx.args);
    const setup = await ctx.step("setup-v1", async () => {
        const cwd = await workspace(ctx.session);
        const skills = await resolveSkills({ cwd, extensionDir, home });
        const startedAt = now();
        ctx.log(`Brief: ${firstLine(args.brief)}`);
        const missing = missingSkills(skills);
        if (missing.length) ctx.log(`Skills not found on disk, so subagents load them with the skill tool: ${missing.join(", ")}`);
        await save(ctx, cwd, createRecord({ runId: ctx.runId, args, setup: { skills, startedAt } }));
        return { cwd, skills, startedAt };
    });
    const run = new Run(ctx, args, setup, now);
    try {
        for (const phase of PHASES) {
            if (phase === "Deploy" && args.skipDeploy) {
                await run.skip(phase);
                break;
            }
            ctx.phase(phase);
            if (phase === "Deploy") await run.checkpoint("approve-deploy-v1", "approve");
            await run.phase(phase);
            if (phase === "Specify" && args.autonomy === "gated") await run.checkpoint("approve-spec-v1", "approve");
        }
        return await run.finish();
    } catch (error) {
        // Pauses and cancellation abort cooperatively; record only genuine failures, and always rethrow.
        if (error?.name !== "AbortError") await run.fail(error);
        throw error;
    }
}
