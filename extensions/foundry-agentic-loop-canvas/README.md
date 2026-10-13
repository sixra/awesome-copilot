# Agentic Loop canvas

The GitHub Copilot App side panel for the `foundry-agentic-loop` plugin. It covers the whole Agentic Loop on Microsoft Foundry: set up, choose where to build, start from an outcome, follow the spec-driven workflow live, then explore and improve the solution. Canvas ID: `foundry-agentic-loop-canvas`.

## Modes

| Mode | Tabs | When |
| --- | --- | --- |
| **Rapid prototyping** (default) | Setup, Resources, Build, Explore, Optimize | Build fast in an existing Foundry project from Chat |
| **SDD** | Setup, Build, Workflow, Explore, Optimize | Selected automatically when the session has `foundry-agentic-loop-workflow` runs, or chosen in the header |

## Tabs

| Tab | What it does |
| --- | --- |
| **Setup** | Checks the plugins, extensions, CLI tools and Azure sign-in, and offers a Chat prompt for each gap |
| **Resources** | Discovers Foundry projects across subscriptions. The selection stays in sync with `FOUNDRY_PROJECT` in the workspace `.env` |
| **Build** | Write a brief, answer guided questions, or pick one of 61 industry scenarios. SDD adds the deployment target: subscription, region and azd environment |
| **Workflow** | Follows each run live: phases, gates, agents, artifacts and the activity log. Approve the spec or deployment, request changes, resume, pause or cancel. Completed runs show their outcome and endpoints; verified runs offer **Deploy from Chat** |
| **Explore** | Opens the local and deployed apps, lists agents, model deployments, toolboxes and resource-group resources, and launches Agent Inspector |
| **Optimize** | Starts the Foundry Agent Optimizer, automatic evaluations, an Agent Insights scan or **Improve the loop**, and shows session usage and month-to-date Azure spend |

While Copilot works, an enablement dock rotates 18 short Microsoft Foundry lessons, each linked to Microsoft Learn. It respects reduced-motion settings. **How it works** opens the slide deck in `public/deck.html`.

## Safety

- Every action that starts a Copilot turn shows the prompt for review before it is sent to Chat.
- The panel server listens on `127.0.0.1` only. It requires a per-panel token, applies a strict Content Security Policy and accepts only actions validated against their schemas.
- The canvas reads only `FOUNDRY_PROJECT`, `LOCAL_FRONTEND` and `DEPLOYED_FRONTEND` from `.env`. It accepts only validated Foundry project ARM IDs, and links only to `http` or `https` URLs without credentials.

## Tests

```bash
node --test extensions/foundry-agentic-loop-canvas/tests/*.test.mjs
```
