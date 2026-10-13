<!-- foundry-agentic-loop:begin mode=sdd -->
## Agentic Loop: SDD workflow

This workspace is built with spec-driven delivery. For build requests, load the `foundry-agentic-loop` skill and follow its `references/sdd.md`. Short commands:

| Command | Step |
| --- | --- |
| `specify`, `implement`, `verify` | Run that phase guide on the existing artifacts |
| `deploy` | If the latest run in `.agentic-loop/runs/` is paused at `approve-deploy-v1`, summarize it and resume it once approved; otherwise run the Deploy phase guide, which asks before `azd up` |
| `status` | Summarize the latest run in `.agentic-loop/runs/` |
| `approve`, `resume` | Resume the paused run with `resumeFromRunId` |
| `build <brief>` | Start a new `foundry-agentic-loop-workflow` run |
| `improve` | Improve mode |

- The spec and contract live in `docs/spec.md`, lessons in `docs/loop-sri.md` and Azure settings only in `.azure/deployment-plan.md`, never here.
- This section locks the build mode. Change it only when the user explicitly confirms a switch.
<!-- foundry-agentic-loop:end -->
