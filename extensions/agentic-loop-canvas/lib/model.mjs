import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { outcome, projectIdentity } from "./azure.mjs";
import { frontendStatus } from "./frontends.mjs";
import { ARTIFACTS, checkpointInfo, flightRecordPath } from "./live.mjs";

export const links = {
    devpack: "https://learn.microsoft.com/azure/foundry/how-to/develop/install-cli-sdk?tabs=macos%2Cpython%2Cazd-ai#install-foundry-devpack",
    quickstart: "https://learn.microsoft.com/azure/foundry/tutorials/quickstart-create-foundry-resources?tabs=azurecli",
    landingZone: "https://azure.github.io/AI-Landing-Zones/",
    optimizer: "https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/agent-optimizer-overview",
    evaluations: "https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/evaluate-agent?tabs=python",
    insightsScan: "https://learn.microsoft.com/en-us/azure/foundry/observability/how-to/agent-insights",
    extensions: "https://github.com/github/awesome-copilot/tree/main/extensions",
};

export const MODES = Object.freeze(["rapid", "sdd"]);
const projectKinds = ["insights", "foundry", "inspect", "optimizer", "evaluations", "insightsScan"];
const unscoped = ["quickstart", "landingZone", "plugin", "devpack", "auth", "sdd", "changes", "improve", "deploy"];

export function validTarget(target = {}) {
    const result = { subscriptionId: null, location: "auto", environmentName: "" };
    if (target.subscriptionId != null && target.subscriptionId !== "") {
        if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(target.subscriptionId)) throw new Error("Choose a valid Azure subscription.");
        result.subscriptionId = target.subscriptionId;
    }
    if (target.location != null && target.location !== "") {
        if (!/^(?:auto|[a-z][a-z0-9]{2,30})$/.test(target.location)) throw new Error("Choose a valid Azure region.");
        result.location = target.location;
    }
    if (target.environmentName) {
        if (!/^[a-zA-Z][a-zA-Z0-9-]{1,19}$/.test(target.environmentName)) throw new Error("Use 2-20 letters, digits or hyphens for the azd environment name, starting with a letter.");
        result.environmentName = target.environmentName;
    }
    return result;
}

function azureTarget(target = {}, subscriptions = []) {
    const { subscriptionId, location, environmentName } = validTarget(target);
    const subscription = subscriptions.find(row => row.id === subscriptionId);
    return [
        `Azure subscription: ${subscriptionId ? `${subscription?.name ? `${subscription.name} ` : ""}(${subscriptionId})` : "confirm the current az/azd default with me"}`,
        `Azure region: ${location === "auto" ? "recommend one from live model, quota and hosted-agent availability" : location}`,
        `azd environment: ${environmentName || "derive a short name from the solution"}`,
    ].join("\n");
}

function changeRequest(runId, checkpoint, feedback) {
    const hold = "Do not resume the run: I will continue it from the Agentic Loop canvas.";
    const pause = checkpointInfo(checkpoint);
    if (pause?.kind === "blocked") {
        const files = [...ARTIFACTS[pause.phase], "LOOP.md"].join(", ");
        return `The agentic-loop-workflow run ${runId} is paused because ${pause.phase} could not pass its gate (round ${pause.round}). Read every issue in the ${pause.phase} round ${pause.round} entry of phases in ${flightRecordPath(runId)}, then ${files}. Fix each issue at its root cause in the workspace, Azure configuration, quota or region, and rerun the failing checks. Record the evidence in ${ARTIFACTS[pause.phase].at(-1)} and the cause and fix in LOOP.md. ${hold} Resuming runs ${pause.phase} again.${feedback ? `\n\nGuidance:\n${feedback}` : ""}`;
    }
    switch (checkpoint) {
        case "approve-spec-v1": return feedback && `The agentic-loop-workflow run ${runId} is paused for spec approval. Apply this feedback to docs/spec.md, and to .azure/deployment-plan.md when affected. Keep the EARS acceptance criteria, contract, workstreams and verification mapping consistent. Summarize what changed. ${hold}\n\nFeedback:\n${feedback}`;
        case "approve-deploy-v1": return feedback && `The agentic-loop-workflow run ${runId} is paused for deployment approval. Apply this feedback to .azure/deployment-plan.md and the azd configuration when affected. Summarize what changed, including cost, security and region impact. Do not deploy anything. ${hold}\n\nFeedback:\n${feedback}`;
        case "failed": return `The agentic-loop-workflow run ${runId} stopped before finishing. Inspect its error and progress log, find the root cause in the workspace, Azure configuration, quota or region, fix it and verify the fix. Add the cause and fix to LOOP.md. Do not resume or restart the run: I will continue from the Agentic Loop canvas.${feedback ? `\n\nGuidance:\n${feedback}` : ""}`;
        default: throw new Error("Request changes while the run waits at a checkpoint or after it fails.");
    }
}

export function promptFor(kind, { project, scenario, text, agent, mode = "rapid", target, subscriptions, runId, checkpoint } = {}) {
    if (!MODES.includes(mode)) throw new Error("Choose rapid prototyping or SDD mode.");
    if (runId != null && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runId)) throw new Error("Invalid workflow run.");
    const context = project && !unscoped.includes(kind) && !(mode === "sdd" && ["guided", "scenario", "custom"].includes(kind))
        ? `\nSelected Foundry project: ${project.id}\nEndpoint: ${project.endpoint ?? "resolve from Azure"}\nUse resource group ${project.resourceGroup} for additional solution resources.` : "";
    // Name the scenario's run skills so the reuse rule applies even when the prompt text does not mention them.
    const runSkills = scenario?.runSkills?.some(name => !scenario.prompt.includes(name)) ? `\nRun skills to reuse: ${scenario.runSkills.join(", ")}.` : "";
    const brief = scenario ? `${scenario.prompt}\n\nIndustry: ${scenario.industry}${runSkills}` : text?.trim();
    const where = project ? "in the selected Foundry project" : "in an existing Foundry project; ask me which one to use";
    const rapid = brief ? `Use the agentic-loop skill in rapid prototyping mode to build this complete solution ${where}.\n\n${brief}` : null;
    const sdd = brief ? `Use the agentic-loop skill in SDD mode. Start the agentic-loop-workflow to specify, implement, verify and deploy this solution end to end; Implement provisions a new Foundry project and the solution resources with azd. Run preflight and ask only the clarifying questions that change the spec before starting the workflow.\n\n${brief}\n\n${scenario?.id ? `Workflow scenarioId: ${scenario.id}\n` : ""}${azureTarget(target, subscriptions)}` : null;
    const prompts = {
        plugin: `Install or enable the missing Agentic Loop prerequisites. Check copilot plugin list and install only what is missing: copilot plugin install agentic-loop@awesome-copilot (skills, canvas and workflow) and copilot plugin install azure@awesome-copilot (Azure skills, including microsoft-foundry). If the marketplace is unknown, run copilot plugin marketplace add github/awesome-copilot first. Then reload skills and extensions and confirm agentic-loop, its phase skills, agentic-loop-canvas and agentic-loop-workflow are available. If a plugin extension is still missing, install it with install_extension from ${links.extensions}/<name> at user scope; if one is listed as disabled, re-enable it as the agentic-loop skill bootstrap describes. Tell me if a new session is required.`,
        devpack: `Guide me through installing missing az, azd, and azd ai tools using Foundry DevPack: ${links.devpack}. Check my OS and installed tools first. DevPack may not include Azure CLI; if az is still missing, use Microsoft's Azure CLI installation instructions. Ask before installing anything.`,
        auth: "Check Azure CLI and Azure Developer CLI availability and current sign-in. Authenticate only installed CLIs that need it, using az login or azd auth login as appropriate. Confirm the intended tenant and subscription; do not expose tokens.",
        quickstart: `Guide me through creating a Microsoft Foundry project using ${links.quickstart}. Clarify subscription, region, resource group and names, check permissions, estimate cost, and ask for approval before provisioning. Configure Application Insights for the project.`,
        landingZone: `Guide me through a production-ready enterprise AI deployment using Azure AI Landing Zones: ${links.landingZone}. Clarify governance, networking, identity, subscriptions, region and cost before provisioning.`,
        insights: "Create or reuse an Azure Application Insights resource and connect it to this Foundry project. Verify the project connection, managed-identity permissions and telemetry configuration. Ask before creating billable resources.",
        guided: mode === "sdd"
            ? `Use the agentic-loop skill in SDD mode to guide me from idea to a deployed agentic solution. Clarify the use case, agents, data, tools and user experience with focused questions, then start the agentic-loop-workflow.\n\n${azureTarget(target, subscriptions)}`
            : `Use the agentic-loop skill in rapid prototyping mode to guide me through creating a complete agentic solution ${where}: clarify the use case, one or more agents, and the user experience. Ask focused questions and obtain approval before provisioning.`,
        scenario: scenario ? (mode === "sdd" ? sdd : rapid) : null,
        custom: mode === "sdd" ? sdd : rapid,
        sdd,
        changes: kind === "changes" && runId ? changeRequest(runId, checkpoint, text?.trim()) : null,
        improve: `Use the agentic-loop skill in improve mode. Analyze ${runId ? `agentic-loop-workflow run ${runId} and ` : ""}recent Agentic Loop evidence: .agentic-loop/runs flight records, LOOP.md lessons, workflow run history and session history. Find recurring failures, slow phases and manual fixes, propose the smallest evidence-backed changes to the agentic-loop skills and workflow, check them against the skill evals, and ask before applying them.`,
        deploy: runId ? `Use the agentic-loop skill in SDD mode to deploy the solution that agentic-loop-workflow run ${runId} verified without deploying. Follow agentic-loop-deploy in Chat: run its preflight, summarize the resources, region, cost and security impact from .azure/deployment-plan.md and docs/verify.md, and ask for my approval before azd up. Pass its gate, write docs/deploy.md and add lessons to LOOP.md.` : null,
        foundry: "Open the existing Microsoft Foundry Canvas in its Manage view for my use. Reuse its public canvas API, then synchronize the selected project using set_canvas_selected_foundry_project with the verified project ID and endpoint below. Resolve the tenant from the selected subscription before synchronization, especially when switching directories. Do not create or deploy anything. Keep this Agentic Loop panel available.",
        inspect: agent ? `Launch Agent Inspector locally for this existing Foundry agent using microsoft-foundry. Verify the project and agent version below. Use the deployed endpoint if supported; if local source is required, locate this agent's matching source and explain any missing prerequisites. Do not substitute another workspace agent, scaffold or redeploy. Verify Inspector is responding and open it in the integrated browser. Ask before installing missing tools or sending test prompts that may incur usage charges.\nAgent name: ${JSON.stringify(agent.name)}\nAgent version: ${agent.version == null ? "Resolve the latest version; none was returned by discovery." : JSON.stringify(agent.version)}` : null,
        optimizer: `Use the microsoft-foundry skill to help me improve an existing agent with Foundry Agent Optimizer: ${links.optimizer}. Confirm the target agent and baseline version/configuration in the selected project; ask if ambiguous. Check preview availability and whether this is a prompt or hosted agent. For hosted agents, inspect optimizer readiness before proposing the required integration. Reuse representative evaluation data and available evaluator/optimization model deployments; agree on quality criteria, optimization targets and a bounded run budget. Protect against tool side effects with test endpoints or approved mocks. Ask before billable runs, new resources, or applying/promoting a candidate and redeploying. Compare candidates against the baseline and report evidence, trade-offs and available measured usage; do not silently replace the running agent.`,
        evaluations: `Use the microsoft-foundry skill to create automatic evaluations for an existing agent following ${links.evaluations}. Confirm the target agent/version in the selected project and verify installed SDK compatibility, permissions, judge-model deployment and regional support. Reuse or create a representative, privacy-reviewed dataset; generate and review an agent-specific rubric with suitable quality, safety and tool-use evaluators. Define acceptance thresholds and a repeatable evaluation workflow that records run IDs, scores and failures. Clarify whether automation should run in CI on changes or through a supported scheduled/continuous evaluation workflow before configuring its trigger, cadence, sampling and budget. Protect against tool side effects. Ask before billable runs, data uploads, new resources or enabling recurring execution. Do not substitute a one-off evaluation for the agreed automation.`,
        insightsScan: `Use the microsoft-foundry skill to run an on-demand Foundry agent Insights scan following ${links.insightsScan}. Confirm the target agent/version and analysis window in the selected project; ask if ambiguous. Check preview availability, connected Application Insights, recent representative traces, a supported judge-model deployment, and the required user/project managed-identity access to telemetry and the model. Do not enable sensitive-content capture or broaden protected-data access without approval. Agree on scope and billable analysis before starting; do not enable a recurring schedule. Follow the asynchronous run to a terminal result with bounded polling and report its run ID, status and available usage. Review supporting traces before accepting findings, summarize affected versions and recommended evaluations or optimizations, and ask before applying fixes.`,
    };
    if (typeof prompts[kind] !== "string" || !prompts[kind].trim()) throw new Error("Choose a valid prompt.");
    if (projectKinds.includes(kind) && !project) throw new Error("Select a Foundry project first.");
    return `[Agentic Loop canvas action]\n${prompts[kind]}${context}`;
}

export class Model {
    constructor({ azure, session, scenarios, storage }) {
        this.azure = azure;
        this.session = session;
        this.scenarios = scenarios;
        this.storage = storage;
        this.state = { tab: "setup", subscriptionId: null, projectId: null, draft: "", mode: null, target: validTarget() };
        this.projects = [];
        this.subscriptions = [];
        this.projectWarnings = [];
        this.writes = Promise.resolve();
        this.envProjectKey = undefined;
        this.envProjectError = null;
        this.envProjectRetryAt = 0;
    }

    async load() {
        try { Object.assign(this.state, JSON.parse(await readFile(this.storage, "utf8"))); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        let migrated = false;
        if (this.state.tab === "cost") { this.state.tab = "optimize"; migrated = true; }
        for (const key of ["estimate", "scope"]) if (Object.hasOwn(this.state, key)) { delete this.state[key]; migrated = true; }
        if (this.state.mode != null && !MODES.includes(this.state.mode)) { this.state.mode = null; migrated = true; }
        try { this.state.target = validTarget(this.state.target ?? {}); }
        catch { this.state.target = validTarget(); migrated = true; }
        if (migrated) await this.save();
    }

    mode(hasRuns) { return this.state.mode ?? (hasRuns ? "sdd" : "rapid"); }

    async setMode(mode) {
        if (mode != null && !MODES.includes(mode)) throw new Error("Choose rapid prototyping or SDD mode.");
        this.state.mode = mode;
        await this.save();
        return this.state;
    }

    async setTarget(input) {
        this.state.target = validTarget({ ...this.state.target, ...input });
        await this.save();
        return this.state.target;
    }

    async targets() {
        this.subscriptions = await this.azure.subscriptions();
        if (this.state.target.subscriptionId && !this.subscriptions.some(row => row.id === this.state.target.subscriptionId)) {
            this.state.target = { ...this.state.target, subscriptionId: null };
            await this.save();
        }
        return { subscriptions: this.subscriptions, target: this.state.target };
    }

    async save() {
        const content = JSON.stringify(this.state, null, 2);
        this.writes = this.writes.catch(() => {}).then(async () => {
            await mkdir(path.dirname(this.storage), { recursive: true });
            await writeFile(`${this.storage}.tmp`, content, { mode: 0o600 });
            await rename(`${this.storage}.tmp`, this.storage);
        });
        await this.writes;
    }

    get project() { return this.projects.find(project => project.id === this.state.projectId) ?? null; }

    async setup() {
        const [result, extensions] = await Promise.all([outcome(async () => {
            const diagnostics = await this.session.rpc.skills.reload();
            if (diagnostics.errors.length) throw new Error(diagnostics.errors.join("; "));
            return this.session.rpc.skills.list();
        }), outcome(() => this.session.rpc.extensions.list())]);
        const setup = await this.azure.prerequisites(result.data?.skills ?? [], extensions.data?.extensions ?? null);
        if (result.status === "error") {
            setup.ready = false;
            setup.discoveryError = result.error;
        }
        return setup;
    }

    resourceState() {
        return { projects: this.projects, subscriptions: this.subscriptions, selected: this.project, subscriptionId: this.state.subscriptionId, warnings: this.projectWarnings };
    }

    async frontends(retry = false) {
        const result = await frontendStatus(this.session);
        const target = result.foundryProject;
        const key = target.id?.toLowerCase() ?? target.error;
        if (key !== this.envProjectKey || (this.envProjectError && (retry || Date.now() >= this.envProjectRetryAt))) {
            this.envProjectKey = key;
            this.envProjectError = target.error;
            if (target.id) {
                const sync = await outcome(() => this.discover(projectIdentity(target.id).subscriptionId, target.id));
                this.envProjectError = sync.status === "error" ? sync.error : null;
            }
            this.envProjectRetryAt = Date.now() + 30_000;
        }
        return { ...result, projectSync: {
            ...this.resourceState(),
            error: this.envProjectError,
        } };
    }

    async discover(subscriptionId, requiredProjectId) {
        if (!requiredProjectId) this.projects = [];
        const subscriptions = await this.azure.subscriptions();
        const requested = subscriptionId ?? this.state.subscriptionId ?? subscriptions[0]?.id;
        const id = subscriptions.find(row => row.id.toLowerCase() === requested?.toLowerCase())?.id;
        if (!requested) throw new Error("No enabled Azure subscriptions found. Sign in and recheck access.");
        if (!id) throw new Error("The selected subscription is no longer accessible. Select another subscription.");
        const result = await this.azure.projects(id);
        const preferredId = requiredProjectId ?? this.state.projectId;
        const selected = result.projects.find(project => project.id.toLowerCase() === preferredId?.toLowerCase());
        if (requiredProjectId && !selected) throw new Error(`The FOUNDRY_PROJECT in .env could not be found or accessed.${result.warnings.length ? ` ${result.warnings.join("; ")}` : ""}`);
        const previous = { subscriptions: this.subscriptions, projects: this.projects, warnings: this.projectWarnings, state: { ...this.state } };
        this.subscriptions = subscriptions;
        this.projects = result.projects;
        this.projectWarnings = result.warnings;
        this.state.subscriptionId = id;
        this.state.projectId = selected?.id ?? this.projects[0]?.id ?? null;
        try { await this.save(); }
        catch (error) {
            this.subscriptions = previous.subscriptions;
            this.projects = previous.projects;
            this.projectWarnings = previous.warnings;
            this.state = previous.state;
            throw error;
        }
        return { ...result, ...this.resourceState() };
    }

    async select(projectId) {
        if (!this.projects.some(project => project.id === projectId)) throw new Error("Refresh resources and select an available project.");
        this.state.projectId = projectId;
        await this.save();
        return this.project;
    }

    async send(input, mode = this.mode(false), checkpoint = null) {
        const scenario = input.scenarioId ? this.scenarios.find(row => row.id === input.scenarioId) : undefined;
        if (input.scenarioId && !scenario) throw new Error("Unknown scenario.");
        const prompt = promptFor(input.kind, {
            project: this.project, scenario, text: input.text, mode, runId: input.runId, checkpoint,
            target: this.state.target, subscriptions: this.subscriptions,
        });
        const messageId = await this.session.send({ prompt });
        return { messageId, prompt };
    }

    async inspectAgent({ projectId, agentName }) {
        const project = this.project;
        if (!project || project.id !== projectId) throw new Error("The selected project changed. Refresh Explore before inspecting this agent.");
        if (typeof agentName !== "string" || !agentName.trim()) throw new Error("Choose an agent to inspect.");
        const agents = await this.azure.agents(project);
        const agent = agents.find(row => row.name === agentName);
        if (!agent) throw new Error("This agent is no longer available in the selected project. Refresh Explore.");
        if (this.project?.id !== project.id) throw new Error("The selected project changed. Refresh Explore before inspecting this agent.");
        const prompt = promptFor("inspect", { project, agent });
        const messageId = await this.session.send({ prompt });
        return { messageId, agentName: agent.name };
    }
}
