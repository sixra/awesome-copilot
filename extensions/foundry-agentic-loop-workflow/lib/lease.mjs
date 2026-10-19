import { link, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { contained, readContained } from "./fsguard.mjs";
import { atomicWrite, clean } from "./record.mjs";

export const LEASE = ".agentic-loop/active-run.json";
export const LEASE_TTL_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 5 * 60 * 1000;

async function readLease(cwd) {
    const current = await readContained(cwd, LEASE, 65_536);
    if (!current) return null;
    try {
        const value = JSON.parse(current.text);
        return typeof value?.runId === "string" && value.runId ? value : { invalid: true };
    } catch { return { invalid: true }; }
}

const fresh = (lease, at) => Date.parse(at) - Date.parse(lease.heartbeatAt) < LEASE_TTL_MS;

// Creates the lease only when no file exists: link() fails on an existing target, so two starting runs cannot both win.
async function create(file, text) {
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, text, "utf8");
    try { await link(temp, file); }
    finally { await rm(temp, { force: true }).catch(() => {}); }
}

// One active run per workspace. A paused run releases its lease, and a resume of the same run takes it back.
export async function acquireLease(cwd, runId, { now, log }, tries = 3) {
    const at = now();
    const current = await readLease(cwd);
    if (current?.runId && current.runId !== runId && fresh(current, at)) {
        throw new Error(`Another Agentic Loop run, ${clean(current.runId, 120)}, is active in this workspace (last heartbeat ${clean(current.heartbeatAt, 40)}). `
            + `Wait for it or resume it instead of starting a second run. If it is no longer running, delete ${LEASE} (it also expires 30 minutes after its last heartbeat), then start again.`);
    }
    if (current?.invalid) log(`Workspace lease: replaced an unreadable ${LEASE}.`);
    else if (current && current.runId !== runId) log(clean(`Workspace lease: took over the stale lease of run ${current.runId} (last heartbeat ${current.heartbeatAt}).`, 300));
    const lease = { runId, startedAt: current?.runId === runId && current.startedAt ? current.startedAt : at, heartbeatAt: at };
    const text = `${JSON.stringify(lease, null, 2)}\n`;
    await mkdir(path.dirname(await contained(cwd, LEASE)), { recursive: true });
    const file = await contained(cwd, LEASE);
    if (current) await atomicWrite(file, text);
    else {
        try { await create(file, text); }
        catch (error) {
            if (error?.code !== "EEXIST" || tries <= 1) throw error;
            return acquireLease(cwd, runId, { now, log }, tries - 1);
        }
    }
    // Two runs taking over the same stale lease both write it; only the one that reads its own ID back proceeds.
    const holder = await readLease(cwd);
    if (holder?.runId !== runId) throw new Error(`Another Agentic Loop run, ${clean(holder?.runId ?? "unknown", 120)}, took the workspace lease ${LEASE} at the same time. Resume this run after it finishes.`);
    return new Lease(cwd, lease, now);
}

export class Lease {
    constructor(cwd, lease, now) {
        this.cwd = cwd;
        this.lease = lease;
        this.now = now;
        this.timer = setInterval(() => this.refresh().catch(() => {}), HEARTBEAT_MS);
        this.timer.unref?.();
    }

    // Called with every flight record write and on a timer, so a long subagent step keeps the lease fresh.
    async refresh() {
        const current = await readLease(this.cwd);
        if (current?.runId && current.runId !== this.lease.runId) {
            throw Object.assign(new Error(`the workspace lease ${LEASE} is now held by run ${clean(current.runId, 120)}, so this run stopped writing to avoid two runs in one workspace`), { code: "LEASE_LOST" });
        }
        this.lease = { ...this.lease, heartbeatAt: this.now() };
        await atomicWrite(await contained(this.cwd, LEASE), `${JSON.stringify(this.lease, null, 2)}\n`);
    }

    async release() {
        clearInterval(this.timer);
        try {
            const current = await readLease(this.cwd);
            if (current?.runId === this.lease.runId) await rm(await contained(this.cwd, LEASE), { force: true });
        } catch {
            // A lease that cannot be removed expires after LEASE_TTL_MS.
        }
    }
}
