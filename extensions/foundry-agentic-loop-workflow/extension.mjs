import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineWorkflow, joinSession } from "@github/copilot-sdk/extension";
import { META } from "./lib/args.mjs";
import { runLoop } from "./lib/loop.mjs";

const extensionDir = path.dirname(fileURLToPath(import.meta.url));

// stdout carries JSON-RPC: report progress with ctx.log, never console.log.
const workflow = defineWorkflow({
    meta: META,
    run: ctx => runLoop(ctx, { extensionDir }),
});

await joinSession({ workflows: [workflow] });
