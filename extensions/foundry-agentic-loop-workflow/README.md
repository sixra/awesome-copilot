# Foundry Agentic Loop workflow

A GitHub Copilot dynamic workflow that turns a brief into a verified Microsoft Foundry solution on Azure. It runs four phases in sequence:

1. **Specify**: EARS spec, frozen contract and deployment plan.
2. **Implement**: azd scaffold and provision, a hosted checkpoint, then parallel workstreams and integration.
3. **Verify**: local E2E, a hosted invocation, telemetry and evaluations.
4. **Deploy**: `azd up`, health checks and deployed E2E.

It ships with the `foundry-agentic-loop` plugin. The **SDD** mode of the `foundry-agentic-loop` skill starts it, and the Foundry Agentic Loop canvas shows its progress.

At setup, it adds the Agentic Loop SDD section to the workspace root `AGENTS.md` unless one exists. The section locks the workspace to SDD and routes short commands such as `deploy`, `status` and `resume` in later prompts. A workspace locked to rapid prototyping stops the run until Copilot converts the prototype to SDD.

## How a phase runs

Each phase follows its guide in the `foundry-agentic-loop` skill (`references/specify.md`, `implement.md`, `verify.md` or `deploy.md`) in fresh-context subagents, using `microsoft-foundry` for platform operations. Subagents stay inside the workspace, read skills from the paths resolved at setup and delete only Azure resources the run created whose provisioning failed:

- **Lead**: does the phase work and records lessons in `docs/LOOP.md`.
- **Review**: an independent reviewer reruns every check and reports all blocking issues at once, with evidence. Earlier reports count as claims, not evidence.
- **Fix**: a fixer resolves the issues, then a new review first confirms each one is resolved before finishing its checks. This repeats up to `maxFixLoops` times.
- **Implement**: the foundation step plans up to four workstreams. If they own disjoint workspace-relative files outside the shared ones the lead keeps, such as `azure.yaml`, `infra/`, `docs/` and the root lockfiles, they run in parallel before integration; otherwise the build runs in sequence. Implement deploys only the hosted checkpoint services, and only when they changed; the app services deploy in Deploy.
- **Retry**: a subagent that ends without a report, usually after a provider error, is retried once and told to continue from the current workspace and Azure state. A second miss blocks the gate instead of spending fix loops; for a workstream worker, integration receives it as a failed workstream and finishes it.

The gate passes only on the reviewer's verdict.

## Checkpoints

| Checkpoint | When | Resume means |
| --- | --- | --- |
| `approve-spec-v1` | After Specify, when `autonomy` is `gated` | The spec and deployment plan are approved for provisioning |
| `approve-deploy-v1` | Before Deploy, always | Deployment to the planned target is approved |
| `blocked-<phase>-r<n>` | A gate failed after its fix loops, a subagent ended twice without a report, or a human decision is needed | The issue is resolved; round n+1 continues from the current state and re-checks it first |

Each pause posts a `Needs you:` line in Chat that names the decision. The flight record lists every gate issue, and the canvas shows them. Resume with `run_dynamic_workflow` and `resumeFromRunId`, or from the canvas. Completed steps, including every subagent report, replay from the journal, so resuming never repeats finished work.

Workflow subagents don't appear in `list_agents` or `read_agent`. The flight record is saved when the run starts, at the first step that runs after a resume, at each gate, checkpoint and Deploy skip, at the result and on failure, so a quiet hour inside one Implement step is normal. A cancelled run keeps its last saved status, so the run status from `dynamic_workflows_manage` (`runs` or `inspect-run`) is authoritative. The canvas Build tab shows live subagent activity.

## Arguments

| Arg | Default | Meaning |
| --- | --- | --- |
| `brief` | required | Self-contained brief covering users, agents, data, tools and UX (20–20,000 characters) |
| `subscriptionId` | current `az` default | Target subscription GUID |
| `location` | `auto` | Preferred region. A joint model, quota and service placement check decides |
| `environmentName` | derived | azd environment name, 2–20 characters |
| `scenarioId` | none | Canvas prompt template that the run came from |
| `autonomy` | `gated` | `gated` pauses for spec approval; `auto` skips that pause |
| `maxFixLoops` | `2` | Fix rounds per phase gate, 0–5 |
| `skipDeploy` | `false` | End after Verify with status `verified` |

For an unattended run from Specify through Verify, use `autonomy: "auto"` and `skipDeploy: true` with `copilot workflow run foundry-agentic-loop-workflow --args @args.json --result-file result.json`, where `--result-file` writes only the workflow result. Such a run can still pause at a `blocked-<phase>-r<n>` checkpoint, and with `autonomy: "gated"` or without `skipDeploy` it also pauses for approval. The CLI has no resume command, so continue a paused run from a Copilot session with its run ID.

## Outputs

- **Workspace:** the `AGENTS.md` lock, `docs/spec.md`, `docs/implementation.md`, `docs/verify.md`, `docs/deploy.md`, the lessons in `docs/LOOP.md` and `.azure/deployment-plan.md`, which alone holds the Azure settings, plus the solution itself.
- **Flight record:** `.agentic-loop/runs/<runId>.json`. It holds status, gates, attempts, issues, lessons, checkpoints and endpoints. Improve mode in the `foundry-agentic-loop` skill learns from it.
- **Result:** `{ status, runId, phases, rounds, endpoints, flightRecord }`, where `status` is `deployed` or `verified`.

## Tests

```bash
node --test extensions/foundry-agentic-loop-workflow/tests/*.test.mjs
```

Or run `npm test` from `extensions/foundry-agentic-loop-workflow`. When the Foundry Agentic Loop canvas sits next to this extension, a contract test checks that it reads the workflow's Chat lines, checkpoints, flight record path and `AGENTS.md` section, and validates Azure args the same way.
