---
name: agentic-loop-verify
description: 'Verify phase of the Agentic Loop spec-driven workflow. Runs every component locally against the provisioned Azure resources, tests each EARS acceptance criterion end to end, checks hosted agent invocation and Application Insights telemetry, runs Foundry agent evaluations, fixes root causes and writes docs/verify.md. Use when agentic-loop-workflow runs Verify or to verify an implemented solution before deploying.'
---

# Agentic Loop · Verify

Prove that the implementation meets `docs/spec.md` before anything is exposed publicly. Apply the [agentic-loop](../agentic-loop/SKILL.md) defaults, and use `microsoft-foundry` for agent operations. On a rerun, re-read `docs/verify.md` and rerun only the checks that are not passed, plus anything their fixes touch.

Until Deploy is approved, run the frontend and backend locally and never deploy them, even with internal ingress. Redeploy a hosted agent, or an MCP server it calls, only when its code changed. Infra fixes may re-provision once app images come from `${SERVICE_<NAME>_IMAGE_NAME=}` ([image parameters](../agentic-loop-implement/references/azd-layout.md#container-app-settings)), but must not add public ingress.

Run every azd command from the workspace root, with `AZURE_DEV_USER_AGENT=microsoft_foundry_skill` set inline.

## 1. Preflight

- **azure.yaml:** every agent has `kind: hosted`, `protocols`, and a `codeConfiguration` whose `entryPoint` exists. Every Container Apps name is 32 characters or fewer.
- **Infra:** `az bicep build --file infra/app/main.bicep` succeeds.
- **Dependencies:** they are locked.
- **Local config:** wire `.env` and any local settings from `azd env get-values`. Show key names only, never values. Secrets resolve through managed identity, never as literals.

## 2. Run locally

1. Start each component in the background with telemetry on:
   - MCP servers
   - the backend
   - the frontend
   - `azd ai agent run --no-client` for each agent

   Poll readiness with a timeout. If a component fails to start, stop and report its exit code and the key log lines.
2. Run `azd ai agent invoke --local "<scenario>"` for each agent; it proves readiness and skill load only: toolbox calls using `AgenticIdentityToken` fail locally ("requires AgentInstanceClientId and AgentBlueprintClientId"). Check the backend health route, and check that the UI loads.
3. Upsert `LOCAL_FRONTEND` in `.env` once the UI works. Leave the app running for the user (detached when available) and document how to start it.

## 3. Test

| Check | Evidence |
| --- | --- |
| **Acceptance** | One automated test per EARS ID: contract tests for the frozen contract, and E2E through the frontend's `/api` proxy (Playwright when there is a UI). Run E2E cases in parallel at c = max(1, ⌊0.8 × TPM × minutes per case ÷ tokens per case⌋), measured from one case's Responses `usage` and duration (TPM = capacity × 1000), and record c and its inputs in `docs/verify.md`. A 429 after retries is a failure. |
| **Hosted** | `azd ai agent invoke <agent> "<scenario>"` against the deployed version. Run `azd deploy <agent>` first if the agent code changed. Retry 424 or 502 warm-up responses with backoff. |
| **Telemetry** | A trace from this run, including backend spans, reaches Application Insights (query `requests` or `dependencies` in the last 30 minutes). Local exporters sign in as the developer ([observability](../agentic-loop/references/observability.md)). |
| **Evaluation** | Write at least 10 rows from the spec scenarios to `tests/eval/dataset.jsonl`. Run `azd ai agent eval generate --agent <svc> --dataset tests/eval/dataset.jsonl --evaluator builtin.task_adherence --evaluator builtin.intent_resolution`, adding `builtin.groundedness` when the agent is grounded. Then run `azd env set LAST_EVAL_ID ""` and `azd ai agent eval run --agent <svc>`, and check that its `Agent: <name> v<N>` line names that agent. |
| **Review** | A fresh-context reviewer checks the code and evidence against each requirement, the contract and the RBAC rows. |

## 4. Fix

1. Fix the root cause in the smallest scope.
2. Rerun the failing checks after each fix, and the full suite once after the last fix.
3. Upsert the lesson in `LOOP.md`.

Contract or scope changes go to `docs/spec.md` first. Never weaken a test or a threshold to get a pass.

## 5. Record

Write `docs/verify.md` with:

- the environment and the local URLs;
- a table mapping each requirement ID to its test, result and evidence;
- the evaluation scores with a link to the run;
- telemetry evidence;
- manual test steps;
- checks deferred to Deploy, with the reason;
- open issues.

## Gate

Pass only when:

- every component started in this run;
- every acceptance criterion has a passing test, an approved waiver or, when only the deployed app can prove it (such as Easy Auth or public ingress), a check deferred to Deploy;
- each evaluator meets the spec's threshold (0.8 pass rate by default);
- a trace reached Application Insights;
- the review found no unresolved defects.

Report status, summary, artifacts, assumptions, issues and lessons.
