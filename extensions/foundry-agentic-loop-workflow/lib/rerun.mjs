import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PHASES, WORKFLOW } from "./args.mjs";
import { contained } from "./fsguard.mjs";
import { clean } from "./record.mjs";

const MAX_FILES = 500;
const MAX_BYTES = 2 * 1024 * 1024;

// The newest flight record of this workflow in the workspace, other than the current run; links and oversized files are skipped.
export async function latestRecord(cwd, excludeRunId) {
    const folder = await contained(cwd, ".agentic-loop/runs");
    let names;
    try { names = (await readdir(folder)).filter(name => name.endsWith(".json")).sort().slice(-MAX_FILES); }
    catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
    }
    let latest = null;
    for (const name of names) {
        const file = path.join(folder, name);
        try {
            const info = await lstat(file);
            if (!info.isFile() || info.size > MAX_BYTES) continue;
            const record = JSON.parse(await readFile(file, "utf8"));
            if (record?.workflow !== WORKFLOW || record.runId === excludeRunId || !Array.isArray(record.phases)) continue;
            const at = Date.parse(record.startedAt ?? record.updatedAt) || 0;
            if (!latest || at > latest.at) latest = { at, record, file: `.agentic-loop/runs/${name}` };
        } catch {
            // Unreadable or partial records cannot vouch for a phase.
        }
    }
    return latest;
}

// A rerun from a phase inherits the earlier phases only when the latest run passed every one of them.
// specApproved says whether a human approved that spec, in the latest run or in the run it inherited Specify from; reviewer acceptance does not count.
export function rerunPlan(latest, from) {
    const index = PHASES.indexOf(from);
    if (index <= 0) return null;
    const earlier = PHASES.slice(0, index);
    const refuse = reason => new Error(`Cannot start at ${from}: ${reason} Run the full loop, or fix the earlier phases first.`);
    if (!latest) throw refuse("this workspace has no earlier Agentic Loop flight record in .agentic-loop/runs.");
    const { record } = latest;
    const runId = clean(record.runId, 120);
    const phases = [];
    for (const phase of earlier) {
        const pass = [...record.phases].reverse().find(entry => entry?.phase === phase && entry.status === "passed");
        if (!pass) throw refuse(`the latest run, ${runId}, has no passed ${phase} gate.`);
        phases.push({ phase, summary: clean(pass.summary, 300), at: clean(pass.at, 40), ...(pass.inheritedFrom && { originalRun: clean(pass.inheritedFrom, 120) }) });
    }
    const specApproved = Boolean(record.checkpoints?.some?.(row => row?.key === "approve-spec-v1"))
        || [...record.phases].reverse().find(entry => entry?.phase === "Specify" && entry.status === "passed")?.specApproved === true;
    phases[0] = { ...phases[0], specApproved };
    return { from, runId, file: latest.file, phases, specApproved };
}
