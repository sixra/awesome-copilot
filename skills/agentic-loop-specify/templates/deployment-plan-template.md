# Azure deployment plan

> Written by Specify, used by Implement and Deploy. Contains no secrets.

## Target

| Field | Value |
| --- | --- |
| Solution | `{solution}` |
| azd environment | `{solution}-{stage}` (at most 20 characters) |
| Subscription | `{name}` (`{id}`), tenant `{tenantId}` |
| Signed-in principal | `{upn or appId}` (`{objectId}`) |
| Resource groups | App: `rg-{environment}` (new; `az group exists` returned false). Foundry: {the provider's group, recorded after provisioning} |
| Region | Preferred `{region}` → chosen `{region}`, because {placement evidence} |
| Agent scaffold | `azd ai agent init .` with the Basic sample manifest `{manifestUrl}`, in an empty `.scaffold` folder, then moved into place |
| Infra | `azure.yaml` layers: `foundry` (`microsoft.foundry`) → `app` (Bicep with AVM, `infra/app`) |

## Models

| Deployment | Model and version | SKU | Capacity | Quota evidence |
| --- | --- | --- | --- | --- |
| `gpt-5.4-mini` | `gpt-5.4-mini` {version} | GlobalStandard | {TPM} (~{c} concurrent E2E cases at {tokens} per case) | {free quota in region} |

## Resources

| Resource | Layer | Purpose | SKU | Identity | Est. monthly cost |
| --- | --- | --- | --- | --- | --- |
| Foundry account and project | foundry | Agents, models, toolbox | S0 | system | usage |
| Container Apps environment and apps | app | Frontend, backend, MCP | Consumption | user-assigned | {estimate} |
| Container Registry | app | Images (remote build) | Basic | AcrPull by identity | {estimate} |
| Log Analytics and Application Insights | app | Telemetry, connected to the project | Pay-as-you-go | — | {estimate} |

## RBAC

Verdict from the agentic-loop RBAC preflight: `READY` or `BLOCKED`.

| Principal | Role | Scope | Created by |
| --- | --- | --- | --- |
| {identity} | {role} | {scope} | app layer |
| {deployer} (`AZURE_PRINCIPAL_ID`) | Monitoring Metrics Publisher | Application Insights | app layer |

{When BLOCKED: the ready-to-run grant block for an owner.}

## Environment variables

Implement sets these with `azd env set`, `AZURE_RESOURCE_GROUP` first, one command per variable.

| Variable | Value |
| --- | --- |
| `AZURE_RESOURCE_GROUP` | `rg-{environment}` |
| `AZURE_SUBSCRIPTION_ID` | `{id}` |
| `AZURE_LOCATION` | `{region}` |
| `AZURE_TENANT_ID` | `{tenantId}` |
| `AZD_AGENT_SKIP_ACR` | `false` only when agents deploy as containers |

## Risks and decisions

| Item | Decision | Evidence |
| --- | --- | --- |
| {cost, quota, security or compliance item} | {decision} | {source} |
