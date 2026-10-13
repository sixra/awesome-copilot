# Agentic Loop

Build agentic solutions on Microsoft Foundry, GitHub and Azure, from a quick prototype to a verified, deployed solution.

## Install

```
copilot plugin install agentic-loop@awesome-copilot
```

In the GitHub Copilot App, ask Copilot to **open the agentic loop**. The `agentic-loop` skill finds the bundled canvas and workflow, installs any that are missing and opens the canvas. It installs the `microsoft-foundry` skill only after you agree.

## Two ways to build

| Mode | Start with | Result |
| --- | --- | --- |
| **Rapid prototyping** (default) | An existing Foundry project | Hosted agents, a governed toolbox, Foundry IQ grounding when needed and a React/FastAPI app on Container Apps, built from Chat |
| **Spec-driven delivery (SDD)** | A brief and an Azure subscription | `agentic-loop-workflow` creates the Foundry project and runs **Specify → Implement → Verify → Deploy** to a solution deployed with azd |

Start either mode from Chat or from the canvas. The canvas includes 61 industry scenarios.

## How SDD works

Each phase follows its guide in the `agentic-loop` skill, in fresh-context subagents:

| Phase | Work |
| --- | --- |
| Specify | EARS spec, frozen implementation contract, workstreams and deployment plan after a read-only Azure preflight |
| Implement | azd scaffold and provisioning, the hosted integration checkpoint, then parallel workstreams |
| Verify | Local end-to-end tests per acceptance criterion, hosted invocation, telemetry and Foundry evaluations |
| Deploy | `azd up` after approval, health checks and end-to-end tests against the deployed endpoints |

In each phase:

- A **lead** does the work.
- An independent **reviewer** reruns the checks and reports issues with evidence.
- **Fixers** get a bounded number of rounds, and the gate passes only on the reviewer's verdict.

The workflow pauses for your approval of the spec (unless autonomy is `auto`) and always before `azd up`. A gate that still fails after its fix rounds pauses with the evidence for your decision. Resuming replays completed steps from the journal, so finished work never runs twice. Every run writes a flight record to `.agentic-loop/runs/`.

## Components

| Type | Name | Description |
| --- | --- | --- |
| Skill | [Agentic Loop](../../skills/agentic-loop/) | One skill: setup, mode selection, defaults and working rules, plus guides for rapid prototyping, each SDD phase and improve mode |
| Canvas | [Agentic Loop canvas](../../extensions/agentic-loop-canvas/) | Setup, project selection, scenarios, the live workflow view, exploration, optimization and costs |
| Workflow | [Agentic Loop workflow](../../extensions/agentic-loop-workflow/) | The dynamic workflow that runs the four SDD phases in sequence behind evidence gates |

## Improve mode

Each build records verified lessons in `LOOP.md`, and each SDD run leaves a flight record. Ask Copilot to **improve the agentic loop** to mine both. Copilot proposes evidence-backed changes to the skill and workflow, each with a regression check, and applies only the changes you approve. Approvals, RBAC, safety and evidence gates are never weakened.

## Requirements

- GitHub Copilot App for the canvas. The workflow also runs from the Copilot CLI with `copilot workflow run agentic-loop-workflow`
- An Azure subscription, the Azure CLI and the Azure Developer CLI with its Foundry (`azure.ai.*`) extensions. The canvas Setup tab helps install missing tools with Foundry DevPack, and the skill asks before installing or upgrading anything
- Python 3.13, Node.js and Git

Both modes create billable Azure resources, such as model deployments, hosted agents, Container Apps and monitoring, plus Azure AI Search when grounding needs it. Copilot confirms billable changes before making them. To remove an SDD environment, ask Copilot to tear it down. After you approve, it runs `azd down --purge` and deletes the Entra app registrations the build created, which live outside the resource group.

If the canvas or workflow is listed as disabled, re-enable it and continue in a new session: running sessions keep it disabled. The `agentic-loop` skill walks you through this.

## Credits

Builds on [aiappsgbb/agentic-loop](https://github.com/aiappsgbb/agentic-loop) (MIT, Copyright (c) 2026 aiappsgbb) and the lean spec2cloud skills in [Azure-Samples/Spec2Cloud](https://github.com/Azure-Samples/Spec2Cloud) (MIT, Copyright (c) Microsoft Corporation).
