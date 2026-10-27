import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { test } from "node:test";
import vm from "node:vm";
import { createErrorHandoffRuntime, installErrorHandoff, redactError } from "./canvas-error-handoff/runtime.mjs";

async function fixture(t, { send = async () => {}, policy = "script-src 'self'", streamed = false } = {}) {
    let options;
    const runtime = createErrorHandoffRuntime({
        createCanvas(value) { options = value; return value; },
        async joinSession() { return { send, log() {} }; },
    }, ".github/extensions/open-pr-board", ".error, [data-agent-error]");
    await runtime.joinSession({});
    const server = runtime.createServer((req, res) => {
        if (req.url.startsWith("/api/fail")) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Could not load detail." }));
            return;
        }
        if (req.url.startsWith("/events")) {
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            res.write("data: live\n\n");
            res.end();
            return;
        }
        const html = "<html><body><p class='error'>Original error</p><button>Retry</button></body></html>";
        res.writeHead(200, {
            "Content-Type": "text/html", "Content-Security-Policy": policy,
            "Content-Length": Buffer.byteLength(html),
        });
        if (streamed) {
            res.write(html.slice(0, 20));
            res.end(html.slice(20));
        } else res.end(html);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise(resolve => {
        server.close(resolve);
        server.closeAllConnections();
    }));
    const origin = `http://127.0.0.1:${server.address().port}`;
    runtime.createCanvas({
        id: "board", displayName: "Board", actions: [{ name: "retry", handler() {} }],
        open: async () => ({ title: "Board", url: `${origin}/?token=original-secret` }),
        onClose: async () => {},
    });
    const open = await options.open({ instanceId: "panel-one", input: { repo: "github/awesome-copilot", token: "never-send", number: 42 } });
    const action = options.actions.find(item => item.name === "record_error_handoff");
    const token = new URLSearchParams(new URL(open.url).hash.slice(1)).get("canvas-error-handoff");
    const post = async (route, body, extraHeaders = {}) => {
        const response = await fetch(`${origin}/.canvas-error-handoff/${route}`, {
            method: "POST",
            headers: {
                Origin: origin, "Content-Type": "application/json", "X-Canvas-Error-Handoff": "1",
                "X-Canvas-Error-Handoff-Token": token,
                ...extraHeaders,
            },
            body: JSON.stringify(body),
        });
        return { status: response.status, value: await response.json() };
    };
    const body = () => ({
        id: randomUUID(), instanceId: "panel-one", page: "/",
        error: "GitHub API failed; token=secret", operation: "Load PR detail",
    });
    return { runtime, options, open, origin, post, body, action, token };
}

test("registered documents gain opt-in UI without changing recovery, API, SSE or other HTML", async t => {
    const f = await fixture(t);
    const response = await fetch(f.open.url);
    const html = await response.text();
    assert.match(html, /Original error/);
    assert.match(html, /<button>Retry<\/button>/);
    assert.match(html, /src="\/\.canvas-error-handoff\/client.js\?instanceId=panel-one"/);
    assert.ok(!html.includes(f.token));
    assert.equal(response.headers.get("content-security-policy"), "script-src 'self'");
    assert.equal(response.headers.get("content-length"), null);
    assert.doesNotMatch(await (await fetch(`${f.origin}/preview`)).text(), /canvas-error-handoff/);
    assert.equal(await (await fetch(`${f.origin}/events`)).text(), "data: live\n\n");
    assert.equal((await fetch(`${f.origin}/api/fail`)).status, 400);
    assert.equal(new URL(f.open.url).searchParams.get("token"), "original-secret");
    assert.ok(f.options.actions.some(item => item.name === "retry"));
});

test("streamed canvas HTML is enhanced and nonce/inline-only CSPs remain intact", async t => {
    for (const policy of [
        "script-src 'nonce-abc123'",
        "style-src 'nonce-style123'; script-src 'nonce-abc123'",
        "script-src 'nonce-other123'; script-src-elem 'nonce-abc123'",
        "script-src 'unsafe-inline'",
    ]) {
        await t.test(policy, async t => {
            const f = await fixture(t, { policy, streamed: true });
            const response = await fetch(f.open.url);
            const html = await response.text();
            assert.equal(response.headers.get("content-security-policy"), policy);
            assert.match(html, /canvas-error-handoff/);
            if (policy.includes("nonce")) assert.match(html, /nonce="abc123"/);
            else assert.match(html, /<script>\(function installErrorHandoff/);
        });
    }
});

test("handoff dispatch is opt-in and deduplicated; success requires the real child ID", async t => {
    const prompts = [];
    const f = await fixture(t, { send: async value => prompts.push(value.prompt) });
    await fetch(f.open.url);
    assert.equal(prompts.length, 0);
    const body = f.body();
    const results = await Promise.all([f.post("start", body), f.post("start", body)]);
    assert.equal(prompts.length, 1);
    assert.ok(results.every(result => result.value.status === "pending"));
    assert.match(prompts[0], /create_session/);
    assert.match(prompts[0], /github\/awesome-copilot/);
    assert.match(prompts[0], /Load PR detail/);
    assert.match(prompts[0], /"number":42/);
    assert.doesNotMatch(prompts[0], /never-send|original-secret|token=secret/);
    assert.ok(!prompts[0].includes(f.token));
    assert.throws(() => f.action.handler({
        instanceId: "other-panel", input: { requestId: body.id, status: "created", sessionId: "child" },
    }), /Unknown/);
    assert.throws(() => f.action.handler({
        instanceId: "panel-one", input: { requestId: body.id, status: "created" },
    }), /actual child-session ID/);
    f.action.handler({ instanceId: "panel-one", input: { requestId: body.id, status: "created", sessionId: "real-child" } });
    assert.deepEqual((await f.post("status", { id: body.id })).value, { status: "created", sessionId: "real-child" });
    await f.post("start", body);
    assert.equal(prompts.length, 1);
    assert.throws(() => f.action.handler({
        instanceId: "panel-one", input: { requestId: body.id, status: "failed", error: "late" },
    }), /already settled/);
});

test("dispatch and child-creation failures are visible, never success-shaped", async t => {
    const f = await fixture(t, { send: async () => { throw new Error("dispatch failed; password=secret"); } });
    const result = await f.post("start", f.body());
    assert.equal(result.value.status, "failed");
    assert.match(result.value.error, /dispatch failed/);
    assert.doesNotMatch(result.value.error, /password=secret/);
    const g = await fixture(t);
    const body = g.body();
    await g.post("start", body);
    g.action.handler({ instanceId: "panel-one", input: { requestId: body.id, status: "failed", error: "Project session creation failed." } });
    assert.deepEqual((await g.post("status", { id: body.id })).value, {
        status: "failed", error: "Project session creation failed.",
    });
});

test("reject cross-origin, wrong host, malformed, oversized and closed-instance requests", async t => {
    let sent = 0;
    const f = await fixture(t, { send: async () => sent++ });
    assert.equal((await f.post("start", f.body(), { Origin: "https://evil.example" })).status, 403);
    const wrongHost = await new Promise((resolve, reject) => {
        const request = httpRequest(`${f.origin}/.canvas-error-handoff/start`, {
            method: "POST", headers: { Host: "evil.example" },
        }, response => { response.resume(); resolve(response.statusCode); });
        request.on("error", reject);
        request.end("{}");
    });
    assert.equal(wrongHost, 403);
    assert.equal((await f.post("start", f.body(), { "X-Canvas-Error-Handoff": "" })).status, 403);
    assert.equal((await f.post("start", { ...f.body(), id: "wrong" })).status, 400);
    assert.equal((await f.post("start", { ...f.body(), error: "x".repeat(13000) })).status, 400);
    await f.options.onClose({ instanceId: "panel-one" });
    assert.equal((await f.post("start", f.body())).status, 403);
    assert.equal(sent, 0);
});

test("URL-fragment tokens protect dispatch and status without exposing secrets in HTTP bootstrap", async t => {
    let sent = 0;
    const f = await fixture(t, { send: async () => sent++ });
    const client = `${f.origin}/.canvas-error-handoff/client.js?instanceId=panel-one`;
    const bootstrap = await fetch(client);
    assert.equal(bootstrap.status, 200);
    assert.ok(!(await bootstrap.text()).includes(f.token));
    assert.equal((await fetch(`${f.origin}/.canvas-error-handoff/client.js?instanceId=unknown`)).status, 403);
    for (const token of ["", "wrong"]) {
        assert.equal((await f.post("start", f.body(), { "X-Canvas-Error-Handoff-Token": token })).status, 403);
        assert.equal((await f.post("status", { id: randomUUID() }, { "X-Canvas-Error-Handoff-Token": token })).status, 403);
    }
    assert.equal(sent, 0);
    const body = f.body();
    await f.post("start", body);
    assert.equal(sent, 1);
    const other = await f.options.open({ instanceId: "panel-two", input: {} });
    const otherToken = new URLSearchParams(new URL(other.url).hash.slice(1)).get("canvas-error-handoff");
    assert.notEqual(otherToken, f.token);
    const otherHeaders = { "X-Canvas-Error-Handoff-Token": otherToken };
    assert.equal((await f.post("start", f.body(), otherHeaders)).status, 400);
    assert.equal((await f.post("status", { id: body.id }, otherHeaders)).status, 400);
    assert.equal(sent, 1);
    await f.options.onClose({ instanceId: "panel-one" });
    assert.equal((await fetch(client)).status, 403);
});

test("redaction removes common credentials, URL userinfo, queries and fragments", () => {
    const raw = 'Authorization: Bearer abcdef password="hello world" cookie=session-secret ' +
        "https://user:pass@example.com/api?sig=private#token ghp_1234567890abcdefghijklmnopqrstuvwxyz " +
        "-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----";
    const safe = redactError(raw);
    for (const secret of ["abcdef", "hello world", "session-secret", "user:pass", "sig=private", "#token", "ghp_", "\nprivate\n"]) assert.ok(!safe.includes(secret), secret);
    assert.match(safe, /https:\/\/example.com\/api/);
    assert.ok(redactError("x".repeat(5000)).length <= 3000);
});

test("redaction covers compound credential field names", () => {
    const raw = 'aws_secret_access_key=example-sensitive-value accessKey="another-sensitive-value"';
    const safe = redactError(raw);
    assert.doesNotMatch(safe, /example-sensitive-value|another-sensitive-value/);
    assert.match(safe, /aws_secret_access_key=\[redacted\]/);
});

function browserFixture(outcomes = [{ status: "created", sessionId: "child-one" }]) {
    const calls = [];
    class Element {
        constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.style = {}; this.attrs = {}; this.textContent = ""; }
        append(...nodes) { this.children.push(...nodes); for (const node of nodes) node.parent = this; }
        setAttribute(key, value) { this.attrs[key] = value; }
        getAttribute(key) { return this.attrs[key]; }
        getClientRects() { return [1]; }
        closest(selector) { return selector === "[data-canvas-error-handoff]" && (this.dataset.canvasErrorHandoff !== undefined || this.parent?.closest(selector)) ? this : null; }
        remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); }
        get firstElementChild() { return this.children[0]; }
    }
    const body = new Element("body");
    const document = { body, createElement: tag => new Element(tag), querySelectorAll: () => [], addEventListener() {} };
    const window = {
        fetch: async (url, options) => {
            calls.push({ url, options });
            const value = outcomes.shift() || { status: "created", sessionId: "child-one" };
            if (value instanceof Error) throw value;
            return { ok: true, json: async () => value };
        },
    };
    const sandbox = vm.createContext({
        window, document, URL, URLSearchParams, crypto: { randomUUID },
        location: { pathname: "/", hash: "#canvas-error-handoff=browser-token", href: "http://127.0.0.1/", origin: "http://127.0.0.1" },
        MutationObserver: class { observe() {} },
        requestAnimationFrame: fn => fn(), setTimeout: fn => { fn(); },
    });
    vm.runInContext(`(${installErrorHandoff.toString()})({endpoint:"/.canvas-error-handoff",selectors:".error"}, ${redactError.toString()})`, sandbox);
    return { window, body, calls };
}

test("browser error handling preserves original errors and only sends on one explicit click", async () => {
    const f = browserFixture([{ status: "pending" }, { status: "created", sessionId: "child-one" }]);
    f.window.canvasErrorHandoff.report("password=private API failed", "Refresh");
    f.window.canvasErrorHandoff.report("password=private API failed", "Refresh");
    assert.equal(f.calls.length, 0);
    assert.equal(f.body.children[0].children.length, 1);
    const row = f.body.children[0].children[0];
    assert.doesNotMatch(row.children[0].textContent, /private/);
    const button = row.children[1];
    const first = button.onclick();
    await button.onclick();
    await first;
    assert.equal(f.calls.filter(call => call.url.endsWith("/start")).length, 1);
    assert.equal(button.textContent, "Sent to agent");
    assert.match(row.children[3].textContent, /Child session created: child-one/);
});

test("browser surfaces failed handoff rather than claiming success or automatically retrying", async () => {
    for (const outcome of [{ status: "failed", error: "Child creation refused." }, new Error("Connection lost")]) {
        const f = browserFixture([outcome]);
        f.window.canvasErrorHandoff.report("Operation failed");
        const row = f.body.children[0].children[0];
        await row.children[1].onclick();
        assert.equal(row.children[1].textContent, "Send to agent");
        assert.match(row.children[3].textContent, /Could not confirm a child session/);
        assert.equal(row.children[3].attrs.role, "alert");
        assert.equal(f.calls.length, 1);
        assert.equal(row.children[1].disabled, true);
    }
});

test("repository-local canvases have synchronized helpers; public canvases are excluded", async () => {
    const root = new URL("../", import.meta.url);
    const template = (await readFile(new URL("canvas-error-handoff/runtime.mjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
    let canvases = 0;
    for (const parent of [".github/extensions"]) {
        for (const item of await readdir(new URL(`${parent}/`, root), { withFileTypes: true })) {
            if (!item.isDirectory()) continue;
            const dir = new URL(`${parent}/${item.name}/`, root);
            try { await readFile(new URL("extension.mjs", dir)); }
            catch (error) { if (error.code === "ENOENT") continue; throw error; }
            const helper = (await readFile(new URL("error-handoff.mjs", dir), "utf8")).replace(/\r\n/g, "\n");
            assert.ok(helper.includes(template), `${parent}/${item.name} is stale`);
            new vm.Script(installErrorHandoff.toString());
            canvases++;
        }
    }
    assert.ok(canvases > 0);
    for (const item of await readdir(new URL("extensions/", root), { withFileTypes: true })) {
        if (!item.isDirectory()) continue;
        await assert.rejects(readFile(new URL(`extensions/${item.name}/error-handoff.mjs`, root)), { code: "ENOENT" });
    }
});
