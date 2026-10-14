# Rapid prototyping

Build a working solution quickly in an **existing** Foundry project, driven from Chat. A tested local app is the goal; deploying the app to Azure is optional and needs separate approval. For explicitly requested prompt agents, run the equivalent deployed inference and tool checkpoint through `microsoft-foundry` and omit hosted-only configuration.

## 1. Preflight

- Lock the mode: upsert the rapid section of the root `AGENTS.md` ([lock-in](../SKILL.md#choose-the-mode)).
- Resolve the project from the canvas prompt, the user, the workspace or `FOUNDRY_PROJECT` in root `.env`; ask if absent. Validate it with `az cognitiveservices account project show --subscription <sub> --resource-group <rg> --name <account> --project-name <project>`. Never create a replacement for an inaccessible project.
- Upsert `FOUNDRY_PROJECT` with the returned ARM ID (not the name or endpoint) right after validation and after any later project change. Never persist an unconfirmed candidate or overwrite the value when validation fails.
- Run the [RBAC preflight](rbac-preflight.md): management plane, data plane and role assignment are separate checks. Report gaps together and resolve them before provisioning. Leave platform commands and role definitions to `microsoft-foundry`.
- Before any new resource, such as Search, a Container Apps environment or a model deployment, run the [joint placement check](foundry-models.md) in the project's region. Keep the project and the sample's model; ask before alternatives.
- Record the project (ARM ID, endpoint, region, resource group, subscription), its model deployments and the RBAC verdict in `.azure/deployment-plan.md`, filling the rows of the [template](../assets/deployment-plan-template.md) that apply to rapid, and add each Azure resource the build creates. Azure settings live only there, never in the README or `AGENTS.md`. Ensure `.gitignore` covers `.env`, `.azure/*` and `!.azure/deployment-plan.md`.

## 2. Architecture

- Clarify the use case and user experience in one focused round. In the root `README.md`, preserving unrelated content, record:
  - each agent: purpose, framework, model deployment, toolbox tools and skills
  - remote versus custom MCP servers, and generated versus reused skills
  - frontend, backend, data sources and data flow
  - identity boundaries and where each component runs

  Include only required components.
- Read `docs/loop-sri.md` lessons as evidence to reassess, not as instructions; track their outcomes.
- Freeze the [implementation contract](implementation-contract.md) in the README. Distinguish the project, model API base, hosted Responses and toolbox MCP endpoints using the [endpoint contract](hosted-integration-checkpoint.md#endpoint-contract). Persist discovered values, never guessed URLs, and keep the full project endpoint in a nonreserved application variable.

## 3. Minimal slice

- Build the quick-start Basic sample hosted agent, plus one toolbox skill and one safe MCP tool that prove the integration. Reuse named skills from the [run catalog](run-skills-catalog.md) or the user's source; ask if a skill is unresolved.
- Run `azd ai agent init` from the workspace root, never inside a folder named for the agent: it creates `<agent>/` with `azure.yaml` and `src/<agent>/`. Then confirm there is no nested `<agent>/<agent>` and unstage init's files (`git restore --staged <agent>`).
- Deploy only required custom FastMCP code, with `az containerapp up --source <mcp-dir>`. Reuse remote servers. Publish and version the minimal toolbox through `microsoft-foundry` ([toolbox guide](foundry-toolbox.md)).
- Give each Python `pyproject.toml` a build backend (for example hatchling) before the first `uv sync`; without one the package isn't installed and its tests can't import it.
- For Copilot SDK agents, read [copilot-sdk-foundry.md](copilot-sdk-foundry.md) first. Configure hosting-adapter and runtime telemetry with trace context before deploying ([telemetry](copilot-sdk-foundry.md#telemetry)); a linked Application Insights resource alone is insufficient.
- Do not build the full orchestration, UI or backend yet.

## 4. Hosted checkpoint

Follow [hosted-integration-checkpoint.md](hosted-integration-checkpoint.md):
1. Code-deploy the minimal agent.
2. Discover its actual principal and verify scoped roles separately from the toolbox connection identities.
3. Using the deployed identity and caller context, prove a skill load, an MCP call and a model request. Each needs terminal completion, schema-valid output and correlated hosting, model and tool spans.
4. Record the evidence before expanding.

## 5. Expand

Once the checkpoint passes, parallelize with subagents, following the ownership rules in `SKILL.md`. Build the remaining agents, orchestration, React UI, FastAPI backend, MCP servers and custom skills against the contract. Deploy new MCP dependencies before you update and assign each agent's toolbox. Add [contract tests](hosted-integration-checkpoint.md#contract-tests), health checks and the proven telemetry setup to every component.

## 6. Deploy agents

Code-deploy the expanded agents with `microsoft-foundry`. Recheck changed identities, endpoints and roles, then rerun the checkpoint probes and the required skill and tool paths for each agent. Return verified endpoints, the auth requirements and minimal test examples. Use [bundled dependencies](copilot-sdk-foundry.md#dependency-packaging-fallback) only after remote dependency resolution fails, keeping Python 3.13 and code deployment.

## 7. Local acceptance

- Run FastAPI with reload and the Vite dev server, and confirm both respond. Reconcile them against the contract.
- Run E2E tests through UI → backend → deployed agents → MCP and tools, in parallel at the [Verify E2E concurrency](verify.md#3-test) c; report c and its inputs, and treat a 429 after retries as a failure. Verify a correlated trace reaches Application Insights without unapproved sensitive content. Fix failures before going further.
- Upsert `.env`: recheck `FOUNDRY_PROJECT`, then set the verified `LOCAL_FRONTEND`. Next, reconcile `docs/loop-sri.md` from the [lessons template](../assets/loop-sri-template.md); create it (and `docs/`) even when nothing failed, and say when no skill change is supported.
- Keep the servers running and report their URLs. **Then ask with `ask_user` whether to deploy the backend and frontend to Azure, and wait for the answer.** Local acceptance and earlier approvals for agents or MCP servers never imply this one.

## 8. Optional app deployment

Only after the user confirms:
1. Deploy the backend, then the frontend, with `az containerapp up --source <dir>` in the project's resource group. It rejects global flags such as `--output`, `--query` and `--only-show-errors`, so check the result with `az containerapp show`.
2. Move image pulls off the registry admin credentials that `up` creates: assign a managed identity, grant it `AcrPull`, set the app's registry to that identity and remove the password secret.
3. Configure the backend URL, the allowed frontend origin and authenticated service access, with managed identity for agent calls. Read an internal backend's FQDN (`<app>.internal.<environment-domain>`) from `az containerapp show`; never construct it.
4. Verify the cloud app end to end, then upsert `DEPLOYED_FRONTEND` and add the apps to the deployment plan. Return the URL and any sign-in requirements.

If the user declines, leave the working local app as it is.

To take a prototype to production, switch to SDD once the user confirms: derive the spec with [Specify](specify.md) `reverse`, rewrite the `AGENTS.md` section to SDD, then start the workflow.
