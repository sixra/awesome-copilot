# Improve mode

Recursive improvement: learn from past executions and refine the Agentic Loop skill and workflow with the smallest evidence-backed changes. Analysis is read-only; nothing is applied without approval.

## 1. Gather evidence

**Scope.** In a solution repository, use its own evidence. In a clone of `github/awesome-copilot`, the evidence lives in solution folders: find recent sessions that loaded `foundry-agentic-loop` with `session_store_sql`, confirm the folders with the user, and read their records.

**Budget.** Present proposals within about 20 minutes. Start from the distilled records below. Use session history only to confirm or quantify a candidate cluster, and never read raw transcripts (`events.jsonl`) end to end.

- **Flight records:** `.agentic-loop/runs/*.json`, with phases, rounds, gate status, issues, lessons, durations and outcome.
- **Lessons:** `docs/loop-sri.md` entries and their status.
- **Workflow history:** `dynamic_workflows_manage` with `runs`, filtered to `foundry-agentic-loop-workflow`, then `inspect-run` for each failed, blocked or slow run.
- **Session history:** `session_store_sql` for recent Agentic Loop sessions in scope: failed tools, retries, user corrections, questions asked and manual fixes after a blocked pause. Time-bound every query and use `LIMIT`.
- **Current sources:** the `foundry-agentic-loop` skill (`SKILL.md`, `references/`, `assets/` and `evals/evals.json`) and the workflow `lib/*.mjs`.

## 2. Analyze

Cluster findings by root cause, not symptom. Look for:
- recurring gate failures and phases that need many rounds or run long
- issues fixed by hand in Chat
- user corrections
- adopted lessons not yet captured in a skill
- instructions that never influence outcomes (token cost)

Rank clusters by frequency × impact. Keep a cluster only when it has evidence from at least two runs, or from one verified severe failure.

Find target sections with `grep` instead of reading whole files. With more than three clusters, draft them in parallel, one subagent per cluster, each returning the fields in §3.

## 3. Propose

For each cluster, give:
- the evidence (run IDs, phases, quotes)
- the target file and section
- a minimal diff
- the expected benefit
- a regression check: an existing eval or a new eval case

Prefer tightening or deleting text over adding it. Keep `SKILL.md` lean and put details in references. Never weaken approvals, RBAC, safety or evidence gates, and never add secrets or tenant-specific values. Ask a fresh-context reviewer subagent to challenge each proposal against the evals, and drop those that fail. Re-verify only the claims the reviewer disputes, in one batch.

## 4. Apply after approval

- **In a clone of `github/awesome-copilot`:** edit `skills/foundry-agentic-loop/` and `extensions/foundry-agentic-loop-*` directly. Validate with `npm run skill:validate`, `npm run plugin:validate` and `node --test extensions/foundry-agentic-loop-*/tests/*.test.mjs`, then offer a pull request.
- **In a solution repository:** plugin files are replaced on update, so write project overrides instead. Copy the whole skill folder to `.github/skills/foundry-agentic-loop/` and edit it there; the workflow ignores a copy without `SKILL.md`, `references/sdd.md` and the four phase guides. Workflow subagents read project skills first, so overrides apply to the next run. Change workflow code only through an upstream pull request.
- **Afterwards:** reload with `extensions_reload` when extensions change. Run the affected evals in one parallel batch, fix the failures, then rerun only those, once. If an eval still fails, run it once against the base commit. If it fails there too, record it as pre-existing and stop iterating. Mark matching `docs/loop-sri.md` lessons `adopted`, and mark them `validated` only after a later run confirms the benefit. Offer to upstream generalizable improvements.
