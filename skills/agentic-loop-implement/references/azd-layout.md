# azd layout for SDD solutions

Reference for `agentic-loop-implement` and `agentic-loop-deploy`. All names below are examples. Take the real names from `docs/spec.md`.

## azure.yaml

Keep the `ai-project` block and the agent settings that the scaffold wrote, then add the extra services and the infra layers.

Declarative skill, connection and toolbox services need these extension versions:

- `azure.ai.agents` 1.0.0-beta.17 or later
- `azure.ai.connections` and `azure.ai.toolboxes` 1.0.0-beta.8 or later

Check the installed versions with `azd ext list`. Upgrade only with approval, using `azd extension update <id>`.

```yaml
requiredVersions:
  azd: '>=1.32.0'
  extensions:
    azure.ai.agents: '>=1.0.0-beta.17'
    azure.ai.connections: '>=1.0.0-beta.8'
    azure.ai.toolboxes: '>=1.0.0-beta.8'
    azure.ai.skills: '>=1.0.0-beta.1'
name: claims-triage
services:
  ai-project:                          # from the scaffold; models live here
    host: azure.ai.project
    deployments: [...]
  claims-policy:                       # Foundry skill: folder with SKILL.md
    host: azure.ai.skill
    uses: [ai-project]
    archive: skills/claims-policy
  claims-mcp:                          # FastMCP on Container Apps
    host: containerapp
    project: src/mcp/claims
    language: python
    docker: { path: Dockerfile, remoteBuild: true }
  claims-mcp-conn:
    host: azure.ai.connection
    uses: [ai-project, claims-mcp]
    category: RemoteTool
    target: ${MCP_CLAIMS_URL}
    authType: AgenticIdentityToken     # see "MCP auth"
    audience: ${MCP_CLAIMS_AUDIENCE}
    env:
      MCP_CLAIMS_URL: ${MCP_CLAIMS_URL}
      MCP_CLAIMS_AUDIENCE: ${MCP_CLAIMS_AUDIENCE}
  claims-tools:                        # writes TOOLBOX_CLAIMS_TOOLS_MCP_ENDPOINT
    host: azure.ai.toolbox
    uses: [ai-project, claims-policy, claims-mcp-conn]
    skills: [{ name: claims-policy }]
    tools:
      - type: mcp
        server_label: claims
        server_url: ${MCP_CLAIMS_URL}
        connection: claims-mcp-conn
        require_approval: never
    env: { MCP_CLAIMS_URL: ${MCP_CLAIMS_URL} }
  triage-agent:
    host: azure.ai.agent
    project: src/agents/triage-agent
    uses: [ai-project, claims-tools]
    # keep kind, name, codeConfiguration, protocols and container from the scaffold
    env:
      AZURE_AI_MODEL_DEPLOYMENT_NAME: ${AZURE_AI_MODEL_DEPLOYMENT_NAME}
      TOOLBOX_ENDPOINT: ${TOOLBOX_CLAIMS_TOOLS_MCP_ENDPOINT}
  backend:
    host: containerapp
    project: src/backend
    language: python
    docker: { path: Dockerfile, remoteBuild: true }
  frontend:
    host: containerapp
    project: src/frontend
    language: js
    docker: { path: Dockerfile, remoteBuild: true }
infra:
  layers:
    - name: foundry
      provider: microsoft.foundry
      path: infra/foundry              # README.md only
    - name: app
      provider: bicep
      path: infra/app
      dependsOn: [foundry]
```

### Rules for azure.yaml

- **Platform variables:** never set `FOUNDRY_*` or `AGENT_*` names in an agent's `env`, because the platform injects them. Deploy writes `AGENT_<SERVICE>_NAME`, `_VERSION` and `_<PROTOCOL>_ENDPOINT` to the azd environment.
- **Older extensions without upgrade approval:** remove the skill, connection and toolbox services. Recreate them in an idempotent `postprovision` hook that runs these commands in this order:
  1. `azd ai skill create|update <name> --file ./skills/<name>`
  2. `azd ai connection create <name> --kind remote-tool --target <url> --auth-type agentic-identity --audience <aud> --force`
  3. `azd ai toolbox create <name> --from-file <file>`

  See [foundry-toolbox.md](../../agentic-loop/references/foundry-toolbox.md).
- **MCP auth:** the agent identity calls MCP tools through the connection ([rbac-contract.md](../../agentic-loop/references/rbac-contract.md)).
  - **Keyless (default):** use `AgenticIdentityToken` with the MCP server's Entra app ID URI as the audience. The MCP server validates the token with Container Apps authentication. This needs an Entra app registration, which the deployer creates or which comes from the Microsoft Graph Bicep extension; record each one's display name and app ID in `docs/implementation.md` for teardown. If the tenant blocks app registrations, report the gate as `blocked`.
  - **No auth:** use `authType: None` only for read-only tools over synthetic or public data, with explicit approval. Record it as an assumption in the spec.

## infra/app (Bicep with AVM)

`main.bicep` sets `targetScope = 'resourceGroup'`. The foundry layer creates `rg-<env>` first.

Pin each AVM module to its latest version. Find it at `https://mcr.microsoft.com/v2/bicep/avm/res/<path>/tags/list`.

| Module or resource | Purpose |
| --- | --- |
| `managed-identity/user-assigned-identity` | One identity per app; pass its `AZURE_CLIENT_ID` to the app |
| `operational-insights/workspace`, `insights/component` | Log Analytics and Application Insights |
| `Microsoft.CognitiveServices/accounts/projects/connections@2025-04-01-preview` | Connects App Insights to the existing project. Set `category: 'AppInsights'`, `target` to the component ID, `authType: 'ApiKey'`, `isSharedToAll: true`, `credentials.key` to the connection string and `metadata: { ApiType: 'Azure', ResourceId: <component ID> }`. |
| `container-registry/registry` | Basic SKU with the admin user disabled; grant AcrPull to every app identity |
| `app/managed-environment` | Consumption profile, logs sent to the workspace |
| `app/container-app` ×n | See [Container app settings](#container-app-settings) |
| `Microsoft.Authorization/roleAssignments` | One per [RBAC contract](../../agentic-loop/references/rbac-contract.md) row, such as backend → Foundry User on the account and apps → Monitoring Metrics Publisher. Reference roles by definition ID. |

### Container app settings

- Tag each app with `azd-service-name: <service key>`.
- Use the placeholder image `mcr.microsoft.com/azuredocs/containerapps-helloworld:latest`.
- Pull images through `registries` with the app's identity.
- Set `targetPort` to the app's real port.
- Keep names to 32 characters or fewer.

### Grants after deploy

The hosted agent's runtime identities exist only after deploy. Grant their roles in an idempotent `postdeploy` hook, as the RBAC contract describes.

### Parameters

`main.parameters.json` maps values from the azd environment, including the foundry layer's outputs:

```json
{
  "parameters": {
    "environmentName": { "value": "${AZURE_ENV_NAME}" },
    "location": { "value": "${AZURE_LOCATION}" },
    "principalId": { "value": "${AZURE_PRINCIPAL_ID}" },
    "aiAccountName": { "value": "${AZURE_AI_ACCOUNT_NAME}" },
    "aiProjectName": { "value": "${AZURE_AI_PROJECT_NAME}" },
    "projectEndpoint": { "value": "${FOUNDRY_PROJECT_ENDPOINT}" }
  }
}
```

### Outputs

Each output becomes an azd environment variable:

- `AZURE_CONTAINER_REGISTRY_ENDPOINT` (container app deploys need it)
- `APPLICATIONINSIGHTS_CONNECTION_STRING`
- `SERVICE_<NAME>_URI` for each app
- `MCP_<NAME>_URL`, including the MCP route, for example `/mcp`

## App wiring

- **Backend:** receives `FOUNDRY_PROJECT_ENDPOINT`, the agent name and `AZURE_CLIENT_ID` as environment variables. It calls the agent's dedicated endpoint with a token for `https://ai.azure.com/.default`, as in the [hosted integration checkpoint](../../agentic-loop/references/hosted-integration-checkpoint.md).
- **Frontend:** nginx serves the Vite build and proxies `/api` to `${BACKEND_URL}` through the nginx image's `templates/` substitution. This needs no CORS and no build-time URLs.
- **Telemetry:** every app receives `APPLICATIONINSIGHTS_CONNECTION_STRING` ([observability.md](../../agentic-loop/references/observability.md)).
