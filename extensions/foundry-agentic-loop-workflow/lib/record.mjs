import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { WORKFLOW } from "./args.mjs";
import { MAX_ITEMS } from "./prompts.mjs";

const STATUSES = ["passed", "failed", "blocked"];
const SHARED = ["azure.yaml", "infra", "docs", ".env", ".azure", ".agentic-loop"];
const RESERVED = /^(?:lead|foundation|build|integration|review(?: \d+)?|fix(?: \d+)?)$/i;

export function clean(value, max = 500) {
    const line = String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function strings(value, max = 500, limit = MAX_ITEMS) {
    return Array.isArray(value) ? [...new Set(value.map(item => clean(item, max)).filter(Boolean))].slice(0, limit) : [];
}

export function endpoints(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.flatMap(row => {
        let url;
        try { url = new URL(clean(row?.url, 2048)); }
        catch { return []; }
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || seen.has(url.href)) return [];
        seen.add(url.href);
        return [{ name: clean(row?.name, 80) || url.host, url: url.href }];
    }).slice(0, MAX_ITEMS);
}

// Subagent output is untrusted: coerce it to a bounded, single-line report and fail closed.
export function normalize(result, who) {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
        return { status: "failed", summary: `${who} returned no report.`, issues: [`${who} returned no usable report; rerun the step and inspect its subagent log.`], lessons: [], artifacts: [], assumptions: [], endpoints: [], workstreams: [] };
    }
    const status = STATUSES.includes(result.status) ? result.status : "failed";
    const issues = strings(result.issues);
    if (status !== "passed" && !issues.length) issues.push(`${who} reported ${status} without listing issues; re-check the gate and record the evidence.`);
    return {
        status,
        summary: clean(result.summary, 300) || `${who} ${status}.`,
        issues,
        lessons: strings(result.lessons),
        artifacts: strings(result.artifacts, 300),
        assumptions: strings(result.assumptions),
        endpoints: endpoints(result.endpoints),
        workstreams: Array.isArray(result.workstreams) ? result.workstreams : [],
    };
}

// A step that ended twice without a report most likely hit a provider error. A workstream worker fails, so integration finishes
// its work; any other step blocks, so a human checks the session log before fix loops spend more.
export function missing(who, role) {
    const report = { ...normalize(null, who), summary: "No report after one retry, likely a provider error." };
    if (role === "worker") return { ...report, issues: [`${who} ended twice without a report, likely a provider error: finish this workstream from the current workspace.`] };
    return { ...report, status: "blocked", issues: [`${who} ended twice without a report, likely a provider error: check the session log, then resume.`] };
}

// Static path prefix of a file or glob, relative to the workspace; null when it escapes the workspace.
export function scope(file) {
    const parts = [];
    for (const part of String(file ?? "").trim().replace(/\\/g, "/").split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") return null;
        if (/[*?[\]{}]/.test(part)) break;
        parts.push(part);
    }
    return parts.join("/");
}

const overlaps = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
const single = reason => ({ mode: "single", items: [], reason });

// Parallel workers need two to four workstreams with disjoint, non-shared file ownership; otherwise build in sequence.
export function planWorkstreams(list) {
    if (!Array.isArray(list) || list.length < 2) return single(list?.length === 1 ? "one workstream" : "no workstreams planned");
    if (list.length > 4) return single(`${list.length} workstreams exceed the limit of four`);
    const items = [];
    for (const raw of list) {
        let name = clean(raw?.name, 40).replace(/·/g, "-");
        if (!name) return single("a workstream has no name");
        if (RESERVED.test(name)) name = `ws ${name}`;
        if (items.some(item => item.name.toLowerCase() === name.toLowerCase())) return single(`duplicate workstream "${name}"`);
        const files = strings(raw?.files, 300, 30);
        if (!files.length) return single(`workstream "${name}" owns no files`);
        const scopes = files.map(scope);
        if (scopes.some(value => !value)) return single(`workstream "${name}" claims the whole workspace or a path outside it`);
        const shared = scopes.find(value => SHARED.some(path => overlaps(value, path)));
        if (shared) return single(`workstream "${name}" claims shared path ${shared}`);
        for (const other of items) {
            const clash = scopes.find(value => other.scopes.some(owned => overlaps(value, owned)));
            if (clash) return single(`workstreams "${other.name}" and "${name}" both claim ${clash}`);
        }
        items.push({ name, goal: clean(raw?.goal, 500) || `Build ${name}.`, files, checks: strings(raw?.checks, 300, 10), scopes });
    }
    return { mode: "parallel", items: items.map(({ scopes, ...item }) => item), reason: null };
}

export function recordFile(runId) {
    return path.posix.join(".agentic-loop", "runs", `${String(runId).replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
}

export function union(lists, max = 500) {
    return strings(lists.flat(), max);
}

export function createRecord({ runId, args, setup }) {
    return {
        schema: 1,
        workflow: WORKFLOW,
        runId,
        status: "running",
        pending: null,
        startedAt: setup.startedAt,
        updatedAt: setup.startedAt,
        completedAt: null,
        brief: args.brief,
        scenarioId: args.scenarioId,
        target: { subscriptionId: args.subscriptionId, location: args.location ?? "auto", environmentName: args.environmentName },
        autonomy: args.autonomy,
        maxFixLoops: args.maxFixLoops,
        skipDeploy: args.skipDeploy,
        skills: Object.fromEntries(Object.values(setup.skills).map(skill => [skill.name, skill.source])),
        phases: [],
        checkpoints: [],
        endpoints: [],
        outcome: null,
        error: null,
    };
}

// Pure fold over journaled events: a resumed attempt replays the same events and rebuilds the same record.
export function reduce(record, event) {
    const next = { ...record, updatedAt: event.at };
    switch (event.type) {
        case "gate":
            next.phases = [...record.phases, event.entry];
            next.endpoints = endpoints([...event.entry.endpoints, ...record.endpoints]);
            break;
        case "skipped":
            next.phases = [...record.phases, { phase: event.phase, round: 0, status: "skipped", summary: event.summary, at: event.at }];
            break;
        case "pending":
            next.status = event.kind === "approve" ? "awaiting-approval" : "blocked";
            next.pending = event.key;
            break;
        case "resumed":
            next.status = "running";
            next.pending = null;
            next.checkpoints = [...record.checkpoints, { key: event.key, kind: event.kind, pausedAt: event.pausedAt, resumedAt: event.at }];
            break;
        case "done":
            next.status = event.status;
            next.completedAt = event.at;
            next.outcome = event.outcome;
            break;
        case "error":
            next.status = "error";
            next.error = event.message;
            break;
        default:
            throw new Error(`Unknown flight record event: ${event.type}`);
    }
    return next;
}

export async function writeRecord(cwd, record) {
    const file = path.join(cwd, ...recordFile(record.runId).split("/"));
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await rename(temp, file);
    return file;
}
