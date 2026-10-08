---
name: agentic-loop-implement
description: 'Implement phase of the Agentic Loop spec-driven workflow. Scaffolds Foundry hosted agents in place with azd ai agent init, builds a layered azure.yaml (microsoft.foundry layer plus a Bicep AVM app layer for Container Apps, ACR, identities, monitoring and RBAC) with declarative skill, connection and toolbox services, provisions with azd, passes the hosted integration checkpoint, then builds and integrates the spec workstreams. Writes docs/implementation.md. Use when agentic-loop-workflow runs Implement or to build from an approved docs/spec.md.'
---

# Agentic Loop · Implement

Build what `docs/spec.md` specifies on the target in `.azure/deployment-plan.md`. Apply the [agentic-loop](../agentic-loop/SKILL.md) defaults and use `microsoft-foundry` for platform operations. Reconcile existing code and infra; never re-scaffold over work.

Run azd from the workspace root, with `AZURE_DEV_USER_AGENT=microsoft_foundry_skill` inline on each azd command.

## 1. Scaffold

Skip any step whose result already exists.

1. Take the Basic sample's `manifestUrl` from `azd ai agent sample list --language python --output json` (the recommended Basic entry).
2. Scaffold the first agent as in [scaffold into an existing workspace](references/azd-layout.md#scaffold-into-an-existing-workspace): `azd ai agent init .` with `--no-prompt` in an empty `.scaffold` folder, then move it into place. Never run `azd init -t` first: agent init would rewrite the provider and nest the project.
3. Rename its service key to `<agent>`, point its `project` at `src/agents/<agent>`, and set the top-level `name` to the solution. For each further agent, copy a working agent folder to `src/agents/<name>` and run `azd ai agent init --src ./src/agents/<name> --agent-name <name> --no-prompt --deploy-mode code --runtime python_3_13 --entry-point main.py`.
4. `azd env set` each deployment-plan variable, one per command, with `AZURE_RESOURCE_GROUP` first. Read them back with `azd env get-values`.
5. Sanity-check `azure.yaml`:
   - `services.ai-project.deployments[]` is not empty.
   - There is no literal `{{…}}`.
   - Every `entryPoint` exists.
   - There is no duplicated `-2` agent service.

## 2. Infra and services

Lay out `azure.yaml`, `infra/foundry` and `infra/app` exactly as in [azd-layout.md](references/azd-layout.md):

- **Layers:** a Foundry layer, then a Bicep app layer.
- **Declarative services:** skills, MCP connections and the toolbox.
- **Apps:** Container Apps with `remoteBuild`.
- **Identity:** every row of the RBAC contract, plus a `postdeploy` hook for the runtime instance rows and MCP allow-lists ([grants after deploy](references/azd-layout.md#grants-after-deploy)).

Validate with `az bicep build --file infra/app/main.bicep`. Then run `azd provision --no-prompt`. Record the actual regions and resource groups, including the Foundry provider's group (`azd env get-value AZURE_FOUNDRY_RESOURCE_GROUP`), in the plan's Region, Resource groups and Environment variables rows, and any fallback with its reason in the plan and `docs/spec.md`, before continuing. Upsert `FOUNDRY_PROJECT` (the `AZURE_AI_PROJECT_ID` value) and `RESOURCE_GROUP` into the root `.env`.

## 3. Build

1. **Contract first.** Code against the frozen contract in `docs/spec.md`. Contract changes go to the spec first.
2. **Integration checkpoint.** Pass the [hosted integration checkpoint](../agentic-loop/references/hosted-integration-checkpoint.md) before fan-out. Build a minimal agent that loads one toolbox skill and makes one safe MCP tool call.
   1. Prove readiness and skill load locally with `azd ai agent run --no-client`, in the background, and `azd ai agent invoke --local "<probe>"`. `AgenticIdentityToken` tool calls work only hosted.
   2. Run `azd deploy <service>` for the MCP server, skill, connection, toolbox and agent services, in `uses` order.
   3. Prove the hosted version with `azd ai agent invoke <agent> "<probe>"`.
3. **Workstreams.** Build the spec workstreams in parallel when subagents are available. Each worker owns its exclusive files and runs its acceptance checks. Shared files stay with the lead: `azure.yaml`, `infra/`, the contract, `.env` and lockfiles.
4. **Integration.** Integrate centrally. Run builds, linters and unit tests, and lock Python dependencies (`uv.lock` or pinned versions).

Agent code follows these references:

- [foundry-hosted-agent.md](../agentic-loop/references/foundry-hosted-agent.md)
- [copilot-sdk-foundry.md](../agentic-loop/references/copilot-sdk-foundry.md) or `microsoft-agent-framework`
- [foundry-toolbox.md](../agentic-loop/references/foundry-toolbox.md)
- [foundry-iq-grounding.md](../agentic-loop/references/foundry-iq-grounding.md)
- [observability.md](../agentic-loop/references/observability.md)

## 4. Record

Write `docs/implementation.md` with:

- the components and their files;
- an animated Mermaid flow of a request across the frontend, backend, agent, toolbox, model and telemetry;
- the env contract;
- how to run each component locally;
- deviations from the spec, with their reason.

Add the `microsoft-foundry` marker to `AGENTS.md` if missing.

## Gate

Pass only when:

- provisioning succeeded;
- the checkpoint has evidence;
- builds and unit tests pass;
- the backend calls the agent through its dedicated endpoint (`azd ai agent show`) with scope `https://ai.azure.com/.default`.

Report: status, summary, artifacts, assumptions, issues and lessons.
