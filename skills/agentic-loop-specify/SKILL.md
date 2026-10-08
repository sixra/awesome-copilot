---
name: agentic-loop-specify
description: 'Specify phase of the Agentic Loop spec-driven workflow. Turns a brief into docs/spec.md (EARS requirements, agents, architecture, frozen implementation contract, workstreams, verification plan) and .azure/deployment-plan.md (Azure target, model placement, RBAC verdict, azd environment) after a read-only Azure preflight. Sub-commands: sync, reverse, validate, devcontainer. Use when specifying an agentic solution on Microsoft Foundry, when agentic-loop-workflow runs Specify, or to derive a spec from an existing prototype.'
---

# Agentic Loop · Specify

Write the source of truth for an agentic solution. Apply the [agentic-loop](../agentic-loop/SKILL.md) defaults. This phase makes no Azure changes.

## Operating mode

- Read the brief, any canvas scenario, existing `docs/spec.md`, `.azure/deployment-plan.md`, `README.md` and the `LOOP.md` lessons. Update existing artifacts instead of starting over.
- **Interactive:** ask once, with choices, only questions whose answers change scope: users, data, tools, UX or compliance.
- **In the workflow:** never ask. Take the safest reasonable default, record it under Assumptions and continue. Return `blocked` only for decisions on permissions, quota, cost or security.

## Sub-commands

| Command | Action |
| --- | --- |
| *(none)* | Create or update both artifacts |
| `sync` | Update the spec from the current code and `docs/*.md`; list any drift |
| `reverse` | Derive the spec from an existing or rapid-prototype workspace (README contract, `azure.yaml`, `src/`) |
| `validate` | Run the checklist below and report only the gaps |
| `devcontainer` | Copy [devcontainer.json](templates/devcontainer.json) to `.devcontainer/devcontainer.json` |

## Steps

1. **Preflight (read-only).** Run `az account show`, `azd auth login --check-status` and `azd ext list`, and record the subscription, tenant and signed-in principal. Run the [joint placement check](../agentic-loop/references/foundry-models.md) for the model and region, and the [RBAC preflight](../agentic-loop/references/rbac-preflight.md) for the caller. Run `az group exists -n rg-<env>` and add a short suffix on collision.
2. **Spec.** Write `docs/spec.md` from [spec-template.md](templates/spec-template.md):
   - Write acceptance criteria in EARS form: "When <trigger>, the <system> shall <response>".
   - Freeze the [implementation contract](../agentic-loop/references/implementation-contract.md).
   - Split the build into at most four workstreams with exclusive files.
   - Map every requirement to a verification check.
3. **Deployment plan.** Write `.azure/deployment-plan.md` from [deployment-plan-template.md](templates/deployment-plan-template.md). It covers the target, placement evidence, RBAC verdict and grant block, resources, cost drivers and environment variables.
4. **Repository.** Ensure `.gitignore` covers `.azure/*`, `!.azure/deployment-plan.md`, `.env` and build output, and `.gitattributes` sets `* text=auto eol=lf`. Commit only when asked.
5. **Review.** In the workflow, a fresh reviewer checks the artifacts. Interactively, run `validate` yourself.

## Validate checklist

- No `[NEEDS CLARIFICATION]` markers remain. Each open item is an Assumption with a default and an owner.
- Every functional requirement has EARS criteria and a verification row. Non-functional requirements are measurable.
- The contract names every service, environment variable, endpoint, schema, protocol and auth method. Its versions row requires exact pins and image tags, resolved at Implement to the latest stable release, with the `github-copilot-sdk` API verified before any code is generated.
- Seed and decision rules (spec sections 9–10) make every scenario's outcome computable from frozen facts. Tables are well formed, and no credential or `Authorization` literal appears.
- There are at most four workstreams, and they own disjoint files.
- Placement shows the model is available with quota in the region. The RBAC verdict is `READY`, or `BLOCKED` with a ready-to-run grant block.
- Companion skills appear only when a requirement needs them.

## Gate

Pass only when both files exist and the checklist holds. Report: status, summary, artifacts, assumptions, issues and lessons.
