import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { test } from "node:test";
import { BoardStore } from "../.github/extensions/resource-staleness-board/lib/state.mjs";
import { body, classify, fingerprint, git, groupResources, lastMeaningfulChange, scanInventory } from "../.github/extensions/resource-staleness-board/lib/inventory.mjs";
import { buildWorkPrompt, childName } from "../.github/extensions/resource-staleness-board/lib/work.mjs";
import { MAX_PREVIEW_BYTES, readResourceFile } from "../.github/extensions/resource-staleness-board/lib/preview.mjs";

const exec = promisify(execFile);
const extensionDir = fileURLToPath(new URL("../.github/extensions/resource-staleness-board/", import.meta.url));
const resource = {
    id: "agents/example.agent.md", type: "agents", files: ["agents/example.agent.md"],
    fingerprint: "source", age: 100, ageBand: "stale", lastChange: null,
};
const review = {
    recommendation: "refresh", rationale: "Old tool names need replacing.",
    improvements: "Replace the named deprecated tool and validate its current schema.",
    capabilityEvidence: "Native planning exists, but this resource still adds repository-specific constraints.",
};
const diffHash = "d".repeat(64);
const baseSha = "b".repeat(40);

async function directory(t) {
    const root = await mkdtemp(path.join(os.tmpdir(), "resource-staleness-"));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    return root;
}

async function fixture(t) {
    const root = await directory(t);
    await git(root, ["init", "--quiet", "--initial-branch=main"]);
    await git(root, ["config", "user.name", "Fixture"]);
    await git(root, ["config", "user.email", "fixture@example.invalid"]);
    await git(root, ["config", "commit.gpgsign", "false"]);
    await git(root, ["config", "core.autocrlf", "false"]);
    async function write(file, contents) {
        const absolute = path.join(root, ...file.split("/"));
        await mkdir(path.dirname(absolute), { recursive: true });
        await writeFile(absolute, contents);
    }
    async function commit(date, message) {
        await git(root, ["add", "--all"]);
        await exec("git", ["-c", "core.hooksPath=", "commit", "--quiet", "-m", message,
            "-m", "Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>"], {
            cwd: root, windowsHide: true,
            env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
        });
    }
    return { root, write, commit };
}

async function storeFixture(t) {
    const root = await directory(t);
    const store = await new BoardStore(path.join(root, "state.json"), root).load();
    await store.sync({ items: [resource], warning: null });
    return store;
}

async function queue(store, kind = "review", confirmed, hash) {
    const item = await store.queue(resource.id, kind, confirmed, hash);
    if (!item.childSessionId) await store.recordSession(item.id, item.pending.token, "child-1");
    return { id: item.id, token: item.pending.token };
}

test("age thresholds use whole days and include unknown history explicitly", () => {
    const now = Date.parse("2026-10-22T00:00:00Z");
    const at = (days) => new Date(now - days * 86400000).toISOString();
    for (const [days, band] of [[0, "fresh"], [13, "fresh"], [14, "aging"], [30, "aging"], [31, "stale"]]) {
        assert.deepEqual(classify(at(days), now), { age: days, ageBand: band });
    }
    assert.deepEqual(classify(null, now), { age: null, ageBand: "unknown" });
    assert.throws(() => classify("not a date", now), /Invalid resource date/);
    assert.equal(body("---\ndescription: changed\n---\nKeep  this.\r\n", "example.md"), "Keepthis.");
    assert.equal(body("---\nnot frontmatter\n---\n", "example.txt"), "---notfrontmatter---");
});

test("resource groups cover all five types and bundle hook/skill assets once", () => {
    const groups = groupResources([
        "agents/a.agent.md", "agents/not-an-agent.md", "prompts/a.prompt.md", "instructions/a.instructions.md",
        "hooks/one/README.md", "hooks/one/hooks.json", "skills/two/SKILL.md", "skills/two/scripts/run.js",
        "skills/README.md", "extensions/other/extension.mjs",
    ]);
    assert.equal(groups.length, 5);
    assert.deepEqual(groups.find((item) => item.id === "hooks/one").files, ["hooks/one/README.md", "hooks/one/hooks.json"]);
    assert.equal(groups.find((item) => item.id === "skills/two").files.length, 2);
});

test("meaningful history ignores metadata, whitespace, renames and bulk changes, following old paths", async (t) => {
    const f = await fixture(t);
    const original = "agents/old.agent.md";
    await f.write(original, "---\ndescription: initial\n---\nInitial guidance.\n");
    await f.commit("2025-01-01T00:00:00Z", "Add resource");
    await f.write(original, "---\ndescription: initial\n---\nSubstantive guidance.\n");
    await f.commit("2025-02-01T00:00:00Z", "Improve guidance");
    await f.write(original, "---\ndescription: initial\n---\nSubstantive   guidance. \r\n");
    await f.commit("2025-03-01T00:00:00Z", "Formatting");
    await f.write(original, "---\ndescription: changed\nname: example\n---\nSubstantive   guidance. \n");
    await f.commit("2025-04-01T00:00:00Z", "Update metadata");
    await git(f.root, ["mv", original, resource.id]);
    await f.commit("2025-05-01T00:00:00Z", "Rename file");
    await f.write(resource.id, "---\ndescription: changed\nname: example\n---\nBulk generated content.\n");
    await f.commit("2025-06-01T00:00:00Z", "bulk formatting across repository");
    const change = await lastMeaningfulChange(f.root, resource.id);
    assert.equal(change.date.slice(0, 10), "2025-02-01");
});

test("inventory uses addition fallback, folder assets, binary changes, and unknown staged files", async (t) => {
    const f = await fixture(t);
    await f.write(resource.id, "Keep this.\n");
    await f.write("skills/example/SKILL.md", "---\nname: example\n---\nGuidance.\n");
    await f.write("skills/example/asset.bin", Buffer.from([0, 128, 3]));
    await f.commit("2025-01-01T00:00:00Z", "Add resources");
    await f.write("skills/example/asset.bin", Buffer.from([0, 129, 3]));
    await f.commit("2025-02-01T00:00:00Z", "Improve bundled asset");
    await f.write("prompts/new.prompt.md", "Not committed yet.\n");
    await git(f.root, ["add", "--", "prompts/new.prompt.md"]);
    const result = await scanInventory(f.root, { now: Date.parse("2025-03-01T00:00:00Z") });
    assert.equal(result.items.length, 3);
    assert.equal(result.items.find((item) => item.id === resource.id).lastChange.date.slice(0, 10), "2025-01-01");
    assert.equal(result.items.find((item) => item.id === "skills/example").lastChange.date.slice(0, 10), "2025-02-01");
    assert.equal(result.items.find((item) => item.id === "prompts/new.prompt.md").ageBand, "unknown");
    assert.equal(result.warning, null);
    const first = await fingerprint(f.root, [resource.id]);
    await f.write(resource.id, "Working tree change.\n");
    assert.notEqual(await fingerprint(f.root, [resource.id]), first);
    await rm(path.join(f.root, ...resource.id.split("/")));
    await assert.rejects(scanInventory(f.root), /ENOENT/);
});

test("shallow inventory reports incomplete history without fetching", async (t) => {
    const f = await fixture(t);
    await f.write(resource.id, "Original.\n");
    await f.commit("2025-01-01T00:00:00Z", "Add resource");
    const parent = await directory(t);
    const clone = path.join(parent, "shallow");
    await git(parent, ["clone", "--quiet", "--depth=1", pathToFileURL(f.root).href, clone]);
    assert.match((await scanInventory(clone)).warning, /Shallow Git history/);
});

test("state survives new stores and preserves child context while invalidating changed content", async (t) => {
    const store = await storeFixture(t);
    const request = await queue(store);
    await store.result({ ...request, review });
    const reloaded = await new BoardStore(store.file, store.root).load();
    assert.deepEqual(reloaded.item(resource.id).review.rationale, review.rationale);
    assert.equal(reloaded.item(resource.id).childSessionId, "child-1");
    await reloaded.sync({ items: [{ ...resource, fingerprint: "changed" }], warning: null });
    assert.equal(reloaded.item(resource.id).review, null);
    assert.equal(reloaded.item(resource.id).childSessionId, "child-1");
    assert.match(reloaded.item(resource.id).error, /Content changed/);
});

test("queue tokens reject duplicate work, replaced children and late/cancelled results", async (t) => {
    const store = await storeFixture(t);
    const request = await queue(store);
    await assert.rejects(store.queue(resource.id, "review"), /pending work/);
    await assert.rejects(store.recordSession(request.id, request.token, "child-2"), /Reuse the existing/);
    await store.cancel(request.id, request.token);
    await assert.rejects(store.result({ ...request, review }), /Stale work token/);
    const next = await queue(store);
    assert.notEqual(next.token, request.token);
    await assert.rejects(store.result({ ...next, review: { recommendation: "remove", rationale: "It is old" } }), /capability evidence/);
    await store.result({ ...next, error: "Child unavailable." });
    assert.equal(store.item(resource.id).pending, null);
    assert.equal(store.item(resource.id).error, "Child unavailable.");
});

test("failed child creation can release a queue before any session was recorded", async (t) => {
    const store = await storeFixture(t);
    const item = await store.queue(resource.id, "review");
    await store.result({ id: resource.id, token: item.pending.token, error: "Could not create child session." });
    assert.equal(store.item(resource.id).pending, null);
    assert.equal(store.item(resource.id).childSessionId, null);
    assert.match(store.item(resource.id).error, /Could not create/);
});

test("publication requires a child, prepared exact diff and explicit boolean confirmation", async (t) => {
    const store = await storeFixture(t);
    await assert.rejects(store.queue(resource.id, "publish", true, diffHash), /Publishing requires/);
    await assert.rejects(store.queue(resource.id, "prepare-refresh"), /Review this resource/);
    await store.result({ ...await queue(store), review });
    const prepare = await queue(store, "prepare-refresh");
    await assert.rejects(store.result({ ...prepare, summary: "Updated the tool name" }), /SHA-256/);
    await store.result({ ...prepare, summary: "Updated only the tool name", diffHash, baseSha });
    await assert.rejects(store.queue(resource.id, "publish", "true", diffHash), /Publishing requires/);
    await assert.rejects(store.queue(resource.id, "publish", true, "a".repeat(64)), /Publishing requires/);
    const publication = await queue(store, "publish", true, diffHash);
    await assert.rejects(store.result({ ...publication, url: "javascript:alert(1)" }), /HTTPS/);
    await store.result({ ...publication, url: "https://github.com/github/awesome-copilot/pull/123" });
    assert.match(store.item(resource.id).publication.url, /\/pull\/123$/);
    await assert.rejects(store.queue(resource.id, "publish", true, diffHash), /Publishing requires/);
});

test("independent writers serialize and reload state instead of overwriting each other", async (t) => {
    const first = await storeFixture(t);
    const second = await new BoardStore(first.file, first.root).load();
    const outcomes = await Promise.allSettled([first.queue(resource.id, "review"), second.queue(resource.id, "review")]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.match(outcomes.find((outcome) => outcome.status === "rejected").reason.message, /pending work/);
});

test("corrupt state is surfaced and failed writes do not report success", async (t) => {
    const store = await storeFixture(t);
    await writeFile(store.file, "{corrupt");
    await assert.rejects(store.load(), /JSON|Unexpected|Expected/);
    await assert.rejects(store.queue(resource.id, "review"), /JSON|Unexpected|Expected/);
    assert.equal(store.item(resource.id).pending, null);
    await assert.rejects(readFile(`${store.file}.lock`), /ENOENT/);
});

test("work instructions require child reuse, concrete improvements and capability evidence", () => {
    const item = { ...resource, pending: { kind: "review", token: "token-1" } };
    const prompt = buildWorkPrompt({ item, instanceId: "panel-1", root: "fixture" });
    assert.match(prompt, /list_sessions_and_chats/);
    assert.match(prompt, /create_session/);
    assert.match(prompt, /mode: "interactive"/);
    assert.match(prompt, /Do not set base_branch/);
    assert.match(prompt, /record_session/);
    assert.match(prompt, /Age or a claim that models are smarter is NOT evidence/);
    assert.match(prompt, /improvements: string, capabilityEvidence/);
    assert.match(prompt, /No external requests or remote Git operations are authorized/);
    assert.ok(childName(resource.id).length <= 40);
    const repeat = buildWorkPrompt({ item: { ...item, childSessionId: "existing-child" }, instanceId: "panel-1", root: "fixture" });
    assert.match(repeat, /Reuse child session "existing-child"/);
    assert.doesNotMatch(repeat, /call create_session/);
    const publish = buildWorkPrompt({
        item: { ...item, childSessionId: "existing-child", prepared: { diffHash, baseSha }, pending: { kind: "publish", token: "token-2" } },
        instanceId: "panel-1", root: "fixture",
    });
    assert.match(publish, /HEAD to equal prepared.baseSha/);
    assert.match(publish, /git diff --cached --binary/);
    assert.match(publish, /Do not merge it/);
});

async function loadCanvas(t, f, { send } = {}) {
    let canvas;
    const prompts = [];
    const context = vm.createContext({
        process: { env: { COPILOT_HOME: path.join(f.root, "home") }, platform: process.platform },
    });
    const sdk = {
        createCanvas: (definition) => definition,
        joinSession: async ({ canvases }) => {
            [canvas] = canvases;
            return { send: async ({ prompt }) => { prompts.push(prompt); if (send) await send(prompt); }, log() {} };
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
        if (specifier === "@github/copilot-sdk/extension") exports = sdk;
        else {
            exports = await import(specifier.startsWith(".")
                ? pathToFileURL(path.resolve(extensionDir, specifier)).href : specifier);
            if (specifier === "./lib/inventory.mjs") {
                exports = { ...exports, git: (_root, args, encoding) => git(f.root, args, encoding) };
            }
        }
        return new vm.SyntheticModule(Object.keys(exports), function () {
            for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
        }, { context });
    });
    await module.evaluate();
    const action = (name, input = {}) => canvas.actions.find((entry) => entry.name === name)
        .handler({ instanceId: "test-panel", input });
    t.after(() => canvas.onClose({ instanceId: "test-panel" }));
    return { canvas, action, prompts };
}

test("canvas routes use local history, protected loopback HTTP and reusable persistent state", async (t) => {
    const f = await fixture(t);
    await f.write(resource.id, "A resource.\n");
    await f.commit("2025-01-01T00:00:00Z", "Add resource");
    const { canvas, action, prompts } = await loadCanvas(t, f);
    const [opened, initial] = await Promise.all([
        canvas.open({ instanceId: "test-panel", input: {} }), action("get_board"),
    ]);
    assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(initial.items.length, 0);
    assert.equal((await canvas.open({ instanceId: "test-panel", input: {} })).url, opened.url);
    const html = await (await fetch(opened.url)).text();
    const token = html.match(/name="board-token" content="([^"]+)"/)[1];
    assert.notEqual(token, "__BOARD_TOKEN__");
    assert.equal((await fetch(`${opened.url}api/get_board`)).status, 403);
    const headers = { "X-Board-Token": token, "Content-Type": "application/json" };
    assert.equal((await fetch(`${opened.url}api/scan`, { method: "POST", headers, body: "{}" })).status, 200);
    assert.equal(prompts.length, 0);
    assert.equal((await action("get_board")).items.length, 1);
    const queued = await action("request_work", { id: resource.id, kind: "review" });
    assert.match(queued.instructions, /create_session/);
    assert.equal(prompts.length, 0, "RPC returns instructions without sending duplicate work");
    await action("record_session", { id: resource.id, token: queued.token, childSessionId: "retained-child" });
    await action("record_result", { id: resource.id, token: queued.token, review });
    const response = await fetch(`${opened.url}api/request_work`, {
        method: "POST", headers, body: JSON.stringify({ id: resource.id, kind: "prepare-refresh" }),
    });
    assert.equal(response.status, 200);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /Reuse child session "retained-child"/);
    assert.match(prompts[0], /Do NOT commit, push/);
    const pending = (await action("get_board")).items[0].pending;
    await action("record_result", {
        id: resource.id, token: pending.token, summary: "One focused edit", baseSha, diffHash,
    });
    const denied = await fetch(`${opened.url}api/request_work`, {
        method: "POST", headers, body: JSON.stringify({ id: resource.id, kind: "publish", confirmed: true, diffHash: "wrong" }),
    });
    assert.equal(denied.status, 400);
    assert.equal(prompts.length, 1);
    await f.write(resource.id, "Changed after scanning.\n");
    await assert.rejects(action("request_work", { id: resource.id, kind: "review" }), /resource changed/);
    const reloaded = await loadCanvas(t, f);
    assert.equal((await reloaded.action("get_board")).items[0].childSessionId, "retained-child");
    assert.equal((await reloaded.action("get_board")).items[0].prepared.diffHash, diffHash);
    assert.deepEqual((await git(f.root, ["status", "--porcelain", "--", "agents"])).trim(), "M agents/example.agent.md");
});

test("changed folder membership and content reject results before they can be persisted", async (t) => {
    const f = await fixture(t);
    await f.write("skills/example/SKILL.md", "Example skill.\n");
    await f.commit("2025-01-01T00:00:00Z", "Add skill");
    const { action } = await loadCanvas(t, f);
    await action("scan");
    const id = "skills/example";
    const { token } = await action("request_work", { id, kind: "review" });
    await action("record_session", { id, token, childSessionId: "child" });
    await f.write("skills/example/new.txt", "New behavior.\n");
    await git(f.root, ["add", "--", "skills/example/new.txt"]);
    await assert.rejects(action("record_result", { id, token, review }), /resource changed/);
    await action("scan");
    await assert.rejects(action("record_result", { id, token, review }), /Stale work token/);
});

test("dispatch failures are explicit, release the local queue and never retry automatically", async (t) => {
    const f = await fixture(t);
    await f.write(resource.id, "Example.\n");
    await f.commit("2025-01-01T00:00:00Z", "Add resource");
    const { canvas, action, prompts } = await loadCanvas(t, f, {
        send: async () => { throw new Error("Connection lost"); },
    });
    await action("scan");
    const opened = await canvas.open({ instanceId: "test-panel", input: {} });
    const html = await (await fetch(opened.url)).text();
    const token = html.match(/name="board-token" content="([^"]+)"/)[1];
    const response = await fetch(`${opened.url}api/request_work`, {
        method: "POST", headers: { "X-Board-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ id: resource.id, kind: "review" }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Connection lost/);
    const item = (await action("get_board")).items[0];
    assert.equal(item.pending, null);
    assert.match(item.error, /receipt is uncertain/);
    assert.equal(prompts.length, 1);
});

test("renderer confirmation sends the exact prepared hash and renders untrusted evidence as text", async () => {
    class Node {
        constructor(tag = "div") {
            this.tag = tag; this.children = []; this.handlers = {}; this.value = ""; this.hidden = false;
            this.content = "token"; this.textContent = ""; this.disabled = false;
        }
        append(...nodes) { this.children.push(...nodes); }
        replaceChildren(...nodes) { this.children = nodes; }
        setAttribute(name, value) { this[name] = value; }
        getAttribute(name) { return this[name]; }
        querySelector() { return null; }
        querySelectorAll() { return []; }
        contains() { return false; }
        addEventListener(name, handler) { this.handlers[name] = handler; }
        showModal() { this.open = true; }
        close() { this.open = false; }
        click() { return this.handlers.click?.(); }
    }
    const nodes = new Map();
    const node = (id) => {
        if (!nodes.has(id)) nodes.set(id, new Node());
        return nodes.get(id);
    };
    node("age").value = "all";
    node("type").value = "all";
    node("recommendation").value = "all";
    const state = {
        items: [{ ...resource, review: { ...review, improvements: "<img src=x onerror=alert(1)>" },
            childSessionId: "child-1", prepared: { summary: "Focused change", diffHash, baseSha } }],
        counts: { stale: 1 }, updatedAt: "2026-10-22T00:00:00Z",
    };
    const requests = [];
    const context = vm.createContext({
        URL,
        document: { querySelector: () => new Node(), getElementById: node, createElement: (tag) => new Node(tag) },
        EventSource: class { addEventListener() {} },
        fetch: async (url, options) => {
            requests.push({ url, options });
            const preview = { id: resource.id, file: resource.id, size: 9, binary: false, truncated: false, content: "<script>" };
            return { ok: true, json: async () => url.endsWith("read_file") ? preview : state };
        },
    });
    vm.runInContext(await readFile(path.join(extensionDir, "public", "app.js"), "utf8"), context);
    await new Promise((resolve) => setImmediate(resolve));
    node("resources").children[0].click();
    const evidence = node("detail").children.find((entry) => entry.textContent.includes("<img"));
    assert.equal(evidence.tag, "p");
    assert.equal(evidence.children.length, 0);
    await new Promise((resolve) => setImmediate(resolve));
    const read = requests.find((entry) => entry.url.endsWith("read_file"));
    assert.deepEqual(JSON.parse(read.options.body), { id: resource.id, file: resource.id });
    const contents = node("detail").children.find((entry) => entry.className === "file-contents");
    assert.equal(contents.tag, "pre");
    assert.equal(contents.textContent, "<script>");
    const actions = node("detail").children.find((entry) => entry.className === "actions");
    actions.children.find((entry) => entry.textContent === "Publish PR...").click();
    assert.equal(node("confirm").open, true);
    assert.equal(requests.filter((entry) => entry.url.endsWith("request_work")).length, 0);
    node("publish-confirm").click();
    await new Promise((resolve) => setImmediate(resolve));
    const publication = requests.find((entry) => entry.url.endsWith("request_work"));
    assert.deepEqual(JSON.parse(publication.options.body), {
        id: resource.id, kind: "publish", confirmed: true, diffHash,
    });
    assert.equal(node("confirm").open, false);
});

test("file preview reads only listed working-tree files, caps size, and flags binaries", async (t) => {
    const root = await directory(t);
    await mkdir(path.join(root, "skills", "demo"), { recursive: true });
    await writeFile(path.join(root, "skills", "demo", "SKILL.md"), "# Demo\n");
    await writeFile(path.join(root, "skills", "demo", "logo.png"), Buffer.from([137, 80, 0, 1]));
    await writeFile(path.join(root, "skills", "demo", "big.txt"), "x".repeat(MAX_PREVIEW_BYTES + 10));
    await writeFile(path.join(root, "secret.txt"), "nope");
    const item = { id: "skills/demo", files: ["skills/demo/SKILL.md", "skills/demo/logo.png", "skills/demo/big.txt", "../secret.txt"] };
    const text = await readResourceFile(root, item, "skills/demo/SKILL.md");
    assert.deepEqual([text.content, text.binary, text.truncated], ["# Demo\n", false, false]);
    assert.equal((await readResourceFile(root, item, "skills/demo/logo.png")).binary, true);
    const big = await readResourceFile(root, item, "skills/demo/big.txt");
    assert.equal(big.truncated, true);
    assert.equal(big.content.length, MAX_PREVIEW_BYTES);
    await assert.rejects(readResourceFile(root, item, "secret.txt"), /not part of this resource/);
    await assert.rejects(readResourceFile(root, item, "../secret.txt"), /outside the checkout/);
});