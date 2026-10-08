# Foundry hosted agent

Reference for the `agentic-loop` skill: runtime concerns for an agent hosted on Microsoft Foundry. Hosted agents should expose the **Responses API** by default; use invocations only when explicitly required for compatibility. `agentic-loop` decides *that* the agent is hosted and *which framework* it uses; this file holds the hosted-agent runtime detail. The reference agent is [`copilot-sdk-with-toolbox.py`](copilot-sdk-with-toolbox.py).

## Hosted-agent protocol

Default to the **Responses API** protocol for hosted agents. Responses exposes an OpenAI-compatible `/responses` endpoint, and the platform manages conversation history, streaming, and session lifecycle. Prefer it for new hosted agents and generated plans.

A tool-using agent streams each tool call as output items, because evaluators score only output items; never return a bare `TextResponse` from it. With `azure-ai-agentserver-responses` 2.2.0 (check the installed API first), the `@app.response_handler` of `ResponsesAgentServerHost()` returns an async generator that creates `ResponseEventStream(response_id=context.response_id, request=request)`, yields `emit_created()` and `emit_in_progress()`, then the events of `output_item_function_call(name, call_id, arguments)` and `output_item_function_call_output(call_id, output)` for each call, then those of `output_item_message(text)`, kept last so `output_text` stays the answer, and finally `emit_completed()`.

Use the **invocations** protocol only when the user explicitly requests it, when an existing deployed agent already depends on it, or when a required sample/runtime is not yet available through Responses. If invocations is selected, document the reason in `./docs/spec.md` (SDD) or the root `README.md` (rapid).

## Python dependency contract (`requirements.txt`)

When post-processing the spec, declare the hosted agent's Python dependencies so the generated `requirements.txt` (or `pyproject.toml`) is complete. Resolve the latest stable compatible releases at implementation time and capture the resolved versions in the generated application's lockfile; the list below is the **required intent**, conditional on the choices already made (framework, toolbox, telemetry). The reference agent [`copilot-sdk-with-toolbox.py`](copilot-sdk-with-toolbox.py) imports exactly this set.

| When | Package | Why |
| --- | --- | --- |
| **Always** (keyless auth) | `azure-identity` | `DefaultAzureCredential` for managed-identity / `az login` tokens |
| **Always** (local config) | `python-dotenv` | Load `.env` in local dev (`load_dotenv`) |
| **Hosted agent runtime** | `azure-ai-agentserver-responses` | Serve the **Responses API** endpoint the Foundry platform calls |
| **Hosted agent runtime - invocations fallback** | `azure-ai-agentserver-invocations` | Include only when invocations is explicitly selected for compatibility (`InvocationAgentServerHost`) |
| **GitHub Copilot SDK** | `github-copilot-sdk` | Default hosted-agent framework: `CopilotClient`, Foundry Skills API downloads, toolbox MCP bridge, integrated agent loop, BYOK provider |
| **MAF agent** | `agent-framework` | Microsoft Agent Framework runtime (include only when explicitly requested or clearly needed for graph/workflow orchestration) |
| **Toolbox over MCP** | `httpx` | Streamable-HTTP MCP bridge to the Foundry toolbox endpoint |
| **Runtime skill download from Foundry** | `azure-ai-projects` | `AIProjectClient` to download governed skill content at hosted-agent startup; create/update/list/show/download management operations should prefer `azd ai skill` outside the runtime |
| **Observability (ON by default)** | `azure-monitor-opentelemetry-exporter`, `opentelemetry-sdk`, `opentelemetry-api` | Export traces/metrics/logs straight to Application Insights, no collector |
| **Observability — model-call tracing** | `opentelemetry-instrumentation-openai-v2` | Instrument in-process OpenAI/Foundry model calls |

Keep the Copilot SDK, toolbox, and skill-download rows for the default agentic-loop hosted agent. Drop them only for an explicit MAF/non-toolbox variant. Do **not** add `azure-search-documents` to the default runtime dependency set; Foundry IQ grounding is consumed through the toolbox MCP endpoint. Add Search SDK dependencies only for the direct-retrieval escape hatch in [`foundry-iq-grounding.md`](foundry-iq-grounding.md#escape-hatch-direct-in-code-retrieval). Drop the model-tracing row only if no in-process model calls are made. Keep the observability core rows because telemetry is **ON by default**.

Resolve versions against the index the build uses as well, because a mirror or proxy can lag the official index. Hashed locks keep only sha256, sha384 or sha512 hashes; pip rejects others ("Allowed hash algorithms for --hash are sha256, sha384, sha512").

## Copilot SDK compatibility

Generated code and documentation examples must match the latest stable package release rather than a stale example from a moving upstream branch. At implementation time, query the official package index, install the latest stable release, inspect its package metadata and API signatures, and record the resolved version in the generated application's contract and lockfile. If the build's index lacks that release, lock the newest stable release it serves (never a pre-release), inspect that API, and record the gap.

| Contract | Latest stable `github-copilot-sdk` resolved at implementation time |
| --- | --- |
| Python | 3.11+ |
| Session creation | Inspect `CopilotClient.create_session`; the current reference uses `await client.create_session(**config)` |
| Prompt send | Inspect `CopilotSession.send_and_wait`; the current reference passes a string prompt |
| Return/event shape | Inspect the installed package's annotations and event data types before generating handlers |
| Lifecycle | Prefer the async context-manager lifecycle supported by the installed release |

Compatibility checks belong in the generated application, where they run against its resolved dependencies during implementation and CI. This skill does not bundle or automatically execute an SDK test suite. If current companion-skill guidance conflicts with the installed package source, treat that guidance as an upstream documentation defect and follow the package API.

When reviewing or correcting generated SDK code, include the relevant compatibility facts in the response: resolved package version, Python minimum, session-creation shape, prompt-send shape, return/event shape, and lifecycle pattern. This makes the correction independently verifiable instead of leaving important constraints implicit in this reference.

## Read-only container filesystem

Hosted-agent container filesystems are **read-only except `/tmp`**. Any path the agent writes at runtime (downloaded skills cache, session/scratch state, generated files) must default under `tempfile.gettempdir()`. Defaulting writable paths under the app directory crashes on first invocation. See [`foundry-toolbox.md`](foundry-toolbox.md) for the skills-download cache (`SKILLS_DIR`) and [`copilot-sdk-with-toolbox.py`](copilot-sdk-with-toolbox.py) for the `working_directory` default.
