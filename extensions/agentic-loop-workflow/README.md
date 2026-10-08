# Agentic Loop workflow

A GitHub Copilot dynamic workflow that turns a brief into a verified Microsoft Foundry solution on Azure. It runs four phases in sequence:

1. **Specify**: EARS spec, frozen contract and deployment plan.
2. **Implement**: azd scaffold and provision, a hosted checkpoint, then parallel workstreams and integration.
3. **Verify**: local E2E, a hosted invocation, telemetry and evaluations.
4. **Deploy**: `azd up`, health checks and deployed E2E.

It ships with the `agentic-loop` plugin. The **SDD** mode of the `agentic-loop` skill starts it, and the Agentic Loop canvas shows its progress.

## How a phase runs

Each phase follows its skill (`agentic-loop-specify`, `-implement`, `-verify` or `-deploy`) in fresh-context subagents, using `microsoft-foundry` for platform operations. Subagents stay inside the workspace, read skills from the paths resolved at setup and delete only Azure resources the run created whose provisioning failed:

- **Lead**: does the phase work and records lessons in `LOOP.md`.
- **Review**: an independent reviewer reruns every check and reports all blocking issues at once, with evidence. Earlier reports count as claims, not evidence.
- **Fix**: a fixer resolves the issues, then a new review first confirms each one is resolved before finishing its checks. This repeats up to `maxFixLoops` times.
- **Implement**: the foundation step plans up to four workstreams. If they own disjoint files, they run in parallel before integration; otherwise the build runs in sequence.

The gate passes only on the reviewer's verdict.

## Checkpoints

| Checkpoint | When | Resume means |
| --- | --- | --- |
| `approve-spec-v1` | After Specify, when `autonomy` is `gated` | The spec and deployment plan are approved for provisioning |
| `approve-deploy-v1` | Before Deploy, always | Deployment to the planned target is approved |
| `blocked-<phase>-r<n>` | A gate failed after its fix loops, or needs a human decision | The issue is resolved; round n+1 re-checks it first |

Each pause posts a `Needs you:` line in Chat that names the decision. The flight record lists every gate issue, and the canvas shows them. Resume with `run_dynamic_workflow` and `resumeFromRunId`, or from the canvas. Completed steps replay from the journal, so resuming never repeats finished work.

## Arguments

| Arg | Default | Meaning |
| --- | --- | --- |
| `brief` | required | Self-contained brief covering users, agents, data, tools and UX (20–20,000 characters) |
| `subscriptionId` | current `az` default | Target subscription GUID |
| `location` | `auto` | Preferred region. A joint model, quota and service placement check decides |
| `environmentName` | derived | azd environment name, 2–20 characters |
| `scenarioId` | none | Canvas industry scenario that the run came from |
| `autonomy` | `gated` | `gated` pauses for spec approval; `auto` skips that pause |
| `maxFixLoops` | `2` | Fix rounds per phase gate, 0–5 |
| `skipDeploy` | `false` | End after Verify with status `verified` |

For an unattended run from Specify through Verify, use `autonomy: "auto"` and `skipDeploy: true`. The command is `copilot workflow run agentic-loop-workflow --args @args.json`.

## Outputs

- **Workspace:** `docs/spec.md`, `docs/implementation.md`, `docs/verify.md`, `docs/deploy.md`, `.azure/deployment-plan.md`, `LOOP.md`, plus the solution itself.
- **Flight record:** `.agentic-loop/runs/<runId>.json`. It holds status, gates, attempts, issues, lessons, checkpoints and endpoints. Improve mode in the `agentic-loop` skill learns from it.
- **Result:** `{ status, runId, phases, rounds, endpoints, flightRecord }`, where `status` is `deployed` or `verified`.

## Tests

```bash
node --test extensions/agentic-loop-workflow/tests/*.test.mjs
```
