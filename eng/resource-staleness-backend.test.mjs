import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { test } from "node:test";
import { safeErrorSummary } from "../.github/extensions/resource-staleness-board/lib/diagnostics.mjs";
import { scanInventory } from "../.github/extensions/resource-staleness-board/lib/inventory.mjs";
import { BoardStore } from "../.github/extensions/resource-staleness-board/lib/state.mjs";

const exec = promisify(execFile);
const extensionDir = fileURLToPath(new URL("../.github/extensions/resource-staleness-board/", import.meta.url));

async function makeRepository(t) {
    const root = await mkdtemp(path.join(process.cwd(), ".resource-staleness-backend-"));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    const runGit = async (args) => exec("git", args, { cwd: root, windowsHide: true });
    await runGit(["init", "--quiet", "--initial-branch=main"]);
    await runGit(["config", "user.name", "Fixture"]);
    await runGit(["config", "user.email", "fixture@example.invalid"]);
    const resourceId = "agents/example.agent.md";
    await mkdir(path.dirname(path.join(root, ...resourceId.split("/"))), { recursive: true });
    await writeFile(path.join(root, ...resourceId.split("/")), "A current tracked resource.\n");
    await runGit(["add", "--", resourceId]);
    await exec("git", ["-c", "core.hooksPath=", "commit", "--quiet", "-m", "Add resource"], {
        cwd: root, windowsHide: true,
        env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" },
    });
    const gitRoot = (await exec("git", ["rev-parse", "--show-toplevel"], { cwd: root, windowsHide: true })).stdout.trim();
    return { root, gitRoot, resourceId };
}

async function loadCanvas(t, root, { scanInventoryOverride } = {}) {
    let canvas;
    const logs = [];
    const home = path.join(root, "home");
    const context = vm.createContext({ process: { env: { COPILOT_HOME: home }, platform: process.platform } });
    const sdk = {
        createCanvas: (definition) => definition,
        joinSession: async ({ canvases }) => {
            [canvas] = canvases;
            return { send: async () => {}, log: (message) => logs.push(message) };
        },
        CanvasError: class extends Error {
            constructor(code, message) { super(message); this.code = code; }
        },
    };
    const filename = path.join(extensionDir, "extension.mjs");
    const module = new vm.SourceTextModule(await readFile(filename, "utf8"), {
        context,
        initializeImportMeta(meta) { meta.url = pathToFileURL(filename).href; },
    });
    await module.link(async (specifier) => {
        let exports;
        if (specifier === "@github/copilot-sdk/extension") {
            exports = sdk;
        } else {
            exports = await import(specifier.startsWith(".")
                ? pathToFileURL(path.resolve(extensionDir, specifier)).href : specifier);
            if (specifier === "./lib/inventory.mjs") {
                exports = {
                    ...exports,
                    git: (_checkout, args, encoding) => exec("git", args, { cwd: root, encoding: encoding ?? "utf8", windowsHide: true })
                        .then(({ stdout }) => stdout),
                    ...(scanInventoryOverride ? { scanInventory: scanInventoryOverride } : {}),
                };
            }
        }
        return new vm.SyntheticModule(Object.keys(exports), function () {
            for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
        }, { context });
    });
    await module.evaluate();
    const action = (name, input = {}) => canvas.actions.find((entry) => entry.name === name)
        .handler({ instanceId: "backend-test", input });
    t.after(() => canvas.onClose({ instanceId: "backend-test" }));
    return { canvas, action, logs, home };
}

test("single-item work reloads another provider's newly scanned item before content validation", async (t) => {
    const { root, gitRoot, resourceId } = await makeRepository(t);
    const { action, home } = await loadCanvas(t, root);
    assert.equal((await action("get_board")).items.length, 0);

    const canonicalRoot = process.platform === "win32" ? path.resolve(root).toLowerCase() : path.resolve(root);
    const key = createHash("sha256").update(canonicalRoot).digest("hex");
    const stateFile = path.join(home, "extensions", "resource-staleness-board", "artifacts", `${key}.json`);
    const secondProvider = await new BoardStore(stateFile, gitRoot).load();
    await secondProvider.sync(await scanInventory(gitRoot));

    const queued = await action("request_work", { id: resourceId, kind: "review" });
    assert.match(queued.instructions, /Resource Staleness Board/);
    assert.ok(queued.token);
});

test("single and batch prompts receive completeness from the completed scan warning", async (t) => {
    const { root, resourceId } = await makeRepository(t);
    const { action } = await loadCanvas(t, root, {
        scanInventoryOverride: async (checkout, options) => ({
            ...(await scanInventory(checkout, options)),
            warning: "Shallow Git history is incomplete.",
        }),
    });
    await action("scan");
    const single = await action("request_work", { id: resourceId, kind: "review" });
    assert.match(single.instructions, /"historyCompleteness": "incomplete"/);
    await action("cancel_work", { id: resourceId, token: single.token });

    const batch = await action("request_reviews", { ids: [resourceId] });
    assert.match(batch.instructions, /"historyCompleteness": "incomplete"/);
});

test("safe HTTP error summaries redact paths and credentials while preserving next steps", () => {
    const message = safeErrorSummary(new Error(
        "State is locked by another writer: C:\\Users\\Aaron Powell\\private\\state file.json.lock. token=secret-value. Inspect that process before removing a stale lock.",
    ));
    assert.doesNotMatch(message, /C:\\Users\\Aaron Powell|state file\.json|secret-value/);
    assert.match(message, /State is locked by another writer: \[path\](?:\.lock)?/);
    assert.match(message, /Inspect that process before removing a stale lock/);
    assert.doesNotMatch(safeErrorSummary(new Error("Cannot read \\\\private-server\\share\\private file.json. Try again.")), /private-server|share|private file/);
    assert.doesNotMatch(safeErrorSummary(new Error("Cannot read C:/Users/private-user/file.json. Try again.")), /private-user|file\.json/);
    assert.equal(safeErrorSummary(new Error("x".repeat(500))).length, 240);
});

test("HTTP work and preview failures expose safe summaries without raw stacks", async (t) => {
    const { root, resourceId } = await makeRepository(t);
    const { canvas, action, logs } = await loadCanvas(t, root);
    await action("scan");
    const opened = await canvas.open({ instanceId: "backend-test", input: {} });
    const html = await (await fetch(opened.url)).text();
    const token = html.match(/name="board-token" content="([^"]+)"/)[1];
    const headers = { "X-Board-Token": token, "Content-Type": "application/json" };
    const initialSnapshotResponse = await fetch(`${opened.url}api/get_board`, {
        headers: { "X-Board-Token": token },
    });
    const initialSnapshot = await initialSnapshotResponse.json();
    assert.ok(Number.isSafeInteger(initialSnapshot.scanGeneration));
    const scanResponse = await fetch(`${opened.url}api/scan`, { method: "POST", headers, body: "{}" });
    const completedScan = await scanResponse.json();
    assert.ok(completedScan.scanGeneration > initialSnapshot.scanGeneration);

    const workResponse = await fetch(`${opened.url}api/request_work`, {
        method: "POST", headers, body: JSON.stringify({ id: "agents/missing.agent.md", kind: "review" }),
    });
    assert.equal(workResponse.status, 400);
    assert.match((await workResponse.json()).error, /Resource not on this board/);

    const previewResponse = await fetch(`${opened.url}api/read_file`, {
        method: "POST", headers, body: JSON.stringify({ id: resourceId, file: "outside.txt" }),
    });
    assert.equal(previewResponse.status, 400);
    assert.match((await previewResponse.json()).error, /File is not part of this resource/);
    assert.equal(logs.some((message) => /Error:|\\n\s+at /.test(message)), false);
});
