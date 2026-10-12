---
name: agentic-loop
description: 'Build complete agentic solutions on Microsoft Foundry, GitHub and Azure: hosted agents, toolbox tools and skills, Foundry IQ grounding and a React/FastAPI app. Two modes: rapid prototyping in an existing Foundry project, or spec-driven delivery (SDD) that runs the agentic-loop-workflow through Specify, Implement, Verify and Deploy, creating the Foundry project and deploying with azd. Improve mode refines these skills and the workflow from past runs. Use for Agentic Loop requests, Agentic Loop canvas actions, or end-to-end agent solutions spanning architecture, implementation, testing and Azure deployment. Not for isolated Azure administration or unrelated UI edits.'
---

# Agentic Loop

Coordinate the solution; use `microsoft-foundry` to execute platform operations. Explicit user choices override defaults. Reuse known context, ask only for missing decisions, read only the references a step needs, and report decisions, blockers and endpoints concisely.

## Bootstrap (once per session)

1. **Foundry skill.** If `microsoft-foundry` is unavailable, ask, then install it (`copilot plugin install azure@awesome-copilot`, or `gh skill install microsoft/azure-skills microsoft-foundry --agent github-copilot --scope project`) and reload skills.
2. **Canvas and workflow.** The `agentic-loop` plugin ships both, listed as `agentic-loop:agentic-loop-canvas` and `agentic-loop:agentic-loop-workflow`. Call `extensions_manage` with `operation: "list"`. For each one missing under either name, call `install_extension` with `url: "https://github.com/github/awesome-copilot/tree/main/extensions/<name>"` and `scope: "user"`, then call `extensions_reload` once. Never install duplicates. If one is listed as disabled, ask, then remove only its ID from `extensions.disabledExtensions` in `~/.copilot/settings.json`, and have the user continue in a new session: running sessions keep it disabled, even after a reload. If an extension failed, `inspect` it and report its log. If the phase skills are also missing, recommend `copilot plugin install agentic-loop@awesome-copilot`.
3. **Canvas.** When work starts from Chat, open it once: `open_canvas` with `canvasId: "agentic-loop-canvas"`, `instanceId: "agentic-loop"` and `input: { mode }`. Prompts beginning `[Agentic Loop canvas action]` come from the canvas; follow their target, approval and resume instructions literally.

## Choose the mode

| Signal | Mode |
| --- | --- |
| Canvas prompt or explicit choice | As stated |
| Existing Foundry project selected or named; fast prototype; no deployment pipeline needed | **Rapid prototyping** → [rapid.md](references/rapid.md) |
| Spec, new Foundry project, azd/IaC, CI-ready repo or full Azure deployment | **SDD** → [sdd.md](references/sdd.md) |
| Improve, learn from runs, or canvas improve prompt | **Improve** → [improve.md](references/improve.md) |
| One named phase | That phase skill: `agentic-loop-specify`, `-implement`, `-verify` or `-deploy` |

Otherwise ask once with the choices "Rapid prototyping (existing Foundry project)" and "SDD (new project, deployed with azd)".

## Defaults

- **Agents:** Foundry hosted agents exposing the Responses API, Python 3.13, code deployment. Create them through `microsoft-foundry`'s `foundry-agent/create/quick-start-hosted.md` with the **Basic sample**; resolve the sample through the skill, never a guessed URL. Use its advanced workflow only when quick-start cannot support a capability, keeping these defaults. Prompt agents only when requested.
- **Framework:** Copilot SDK for agents that use runtime skills; Microsoft Agent Framework for basic agents and explicit workflows. If a workflow also needs skills, clarify. One framework per agent.
- **Models:** rapid keeps the Basic sample's model deployment, or verifies and reuses a supplied one. SDD defaults to `gpt-5.4-mini` unless the spec needs otherwise. Before creating resources, run the joint placement preflight in [foundry-models.md](references/foundry-models.md). Never hard-code a replacement or silently duplicate a deployment.
- **Tools and knowledge:** one governed Foundry toolbox for built-in tools, MCP connections and agent skills; agents use its endpoint, not hard-coded tool URLs. Private knowledge uses Foundry IQ through the toolbox, with citations for supported claims and a deterministic insufficient-evidence response; test both. Add Search only when needed. Reuse explicitly named run skills from the [run catalog](references/run-skills-catalog.md) instead of regenerating them.
- **App:** React + Vite, FastAPI and FastMCP (streamable HTTP) on Azure Container Apps. Rapid deploys with `az containerapp up --source <dir>`; SDD uses azd with a `microsoft.foundry` layer plus a Bicep (AVM) app layer, `remoteBuild: true` and one ACR pulled by managed identity.
- **App access:** no end-user sign-in by default, even when the users are staff. The app serves sample or synthetic data, needs no anonymous-session or identity-verification schemes to compensate, and its services still authenticate with managed identities. Add Entra sign-in only when the user asks; then the API pre-authorizes the SPA, the spec states how automated browser tests get a user token, and Implement proves that token path as soon as the app registrations exist.
- **Identity and safety:** managed identities, least-privilege keyless RBAC ([contract](references/rbac-contract.md), [preflight](references/rbac-preflight.md)). Check management-plane, data-plane and role-assignment rights separately; subscription Owner does not grant Foundry data-plane roles. Plan roles for identities not yet created and verify actual principals after creation. No credentials in browser code or Git; Foundry guardrails on.
- **Observability:** OpenTelemetry from backend, agents, MCP servers and model calls into one Application Insights connected to the project ([observability.md](references/observability.md)). Sensitive content capture stays off unless approved with redaction and retention controls.

## Working rules

- **Contract first.** Freeze service names, environment variables, protocols, endpoints, schemas, auth, streaming/errors and versions ([implementation-contract.md](references/implementation-contract.md)) before parallel work. Rapid keeps it in the root `README.md`; SDD keeps it in `docs/spec.md`, which is what "README contract" means in references.
- **Integration first.** Pass the [hosted integration checkpoint](references/hosted-integration-checkpoint.md) with a minimal agent, one toolbox skill and one safe MCP tool before building full orchestration, UI or backend. Document explicitly excluded capabilities as not applicable, never as passed.
- **Evidence, not signals.** HTTP 200, exit 0 or `active` never pass alone; require terminal completion, schema-valid output, execution evidence and correlated traces. Fix with bounded diagnostics, not unchanged redeployments.
- **Wait by completion.** Provisioning, deployments, role-assignment propagation and agent readiness end when their command or status check says so: run the command synchronously with a long initial wait, or poll its status every 30-60 s against a stated deadline. Never chain fixed sleeps; keep coding while Azure works.
- **Subagents.** Before the checkpoint, parallelize only research and preflight. After it, give each worker a bounded goal, exclusive files, skill references, verified context, the contract, acceptance checks and stop conditions. One owner holds the contract, `.env`, `LOOP.md`, lockfiles and deployment configuration. Keep teams small, avoid recursive delegation, serialize shared Azure mutations and integrate centrally; worker success is not acceptance. Delegation grants no extra approval. Without subagents, work sequentially and say so.
- **`.env` handoff.** Upsert the Git-ignored root `.env`, preserve other keys and read back: `FOUNDRY_PROJECT` (full ARM ID, as soon as validated or created), `RESOURCE_GROUP`, `LOCAL_FRONTEND` and `DEPLOYED_FRONTEND` (verified URLs only). The canvas reads these.
- **Safety.** Reuse resources; confirm billable, security or compliance changes; delete without approval only a resource this build created whose provisioning failed; never sign in for the user; never report an unverified deployment as successful.
- **Workspace boundary.** Builds stay inside the workspace: read only its root `LOOP.md`, scaffold from the Foundry samples and these references, and use code from other folders only when the user names them. Only improve mode reads past runs elsewhere.
- **Companions and SDKs.** Verify installed SDK APIs against the latest stable release (or the newest stable one the build's package index serves, recording the gap) and lock versions before generating code; package sources beat stale guidance. Consult the [build catalog](references/build-skills-catalog.md) only for needed capabilities; respect pins, ask before installs and route third-party skill defects upstream.

## Lessons (`LOOP.md`)

Right after a fix is verified — the failing probe or an equivalent boundary check reruns successfully; an edit, commit or deployment alone is not resolution — upsert a lesson in the workspace root `LOOP.md` before unrelated work. Use a dated build summary and a table: observation and evidence | proposed skill change (file/section) | expected benefit | regression check | status (proposed, adopted, validated, rejected). Separate verified app fixes from untested skill proposals and measurements from estimates; say when no skill change is supported. Preserve user notes, update matching lessons instead of duplicating, revisit earlier proposals, exclude secrets and raw `.env` or payloads, and read back the write. The coordinator, or the SDD phase lead, owns writes; workers report evidence. Lessons never authorize skill edits or weaker gates; improve mode applies them with approval.

## References

| File | Read when |
| --- | --- |
| [rapid.md](references/rapid.md) | Running rapid prototyping |
| [sdd.md](references/sdd.md) | Starting, resuming or manually running SDD |
| [improve.md](references/improve.md) | Improving skills or the workflow from evidence |
| [foundry-hosted-agent.md](references/foundry-hosted-agent.md) | Hosted-agent protocol and Python dependencies |
| [copilot-sdk-foundry.md](references/copilot-sdk-foundry.md) | Copilot SDK provider, auth, telemetry and packaging |
| [copilot-sdk-with-toolbox.py](references/copilot-sdk-with-toolbox.py) | Reference Copilot SDK agent with toolbox and OTel |
| [foundry-toolbox.md](references/foundry-toolbox.md) | Skills, MCP tools and grounding in a toolbox |
| [foundry-iq-grounding.md](references/foundry-iq-grounding.md) | Private knowledge with citations |
| [foundry-models.md](references/foundry-models.md) | Model, region, SKU and quota placement |
| [hosted-integration-checkpoint.md](references/hosted-integration-checkpoint.md) | Endpoint contract, checkpoint and contract tests |
| [implementation-contract.md](references/implementation-contract.md) | Freezing the cross-component contract |
| [rbac-contract.md](references/rbac-contract.md), [rbac-preflight.md](references/rbac-preflight.md), [check_rbac_preflight.py](references/check_rbac_preflight.py) | Role matrix and caller preflight |
| [observability.md](references/observability.md) | End-to-end telemetry |
| [reference-architecture.md](references/reference-architecture.md) | Adding services beyond the baseline |
| [build-skills-catalog.md](references/build-skills-catalog.md), [run-skills-catalog.md](references/run-skills-catalog.md) | Companion build skills and reusable run skills |
