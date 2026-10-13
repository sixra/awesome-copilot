const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="canvas-token"]').content;
const number = value => new Intl.NumberFormat().format(value ?? 0);
const money = (value, currency = "USD") => new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const toTime = value => typeof value === "number" ? value : Date.parse(value ?? "");
const clock = (value, seconds = false) => Number.isFinite(toTime(value)) ? new Date(toTime(value)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) }) : "";
const iso = value => Number.isFinite(toTime(value)) ? new Date(toTime(value)).toISOString() : "";
function setMark(id, text, label = "", tone = "") {
    const mark = $(id);
    mark.textContent = text;
    mark.dataset.tone = tone;
    if (text && label) { mark.setAttribute("role", "img"); mark.setAttribute("aria-label", label); }
    else { mark.removeAttribute("role"); mark.removeAttribute("aria-label"); }
}

const TABS = { rapid: ["setup", "resources", "build", "explore", "optimize"], sdd: ["setup", "build", "workflow", "explore", "optimize"] };
const PHASES = ["Specify", "Implement", "Verify", "Deploy"];
const LESSONS = "docs/loop-sri.md";
const PHASE_COPY = {
    Specify: "EARS acceptance criteria, a frozen contract, workstreams and a deployment plan, checked by an independent reviewer.",
    Implement: "azd provisions the Foundry project and a hosted checkpoint proves the integration before agents, tools and app are built in parallel.",
    Verify: "Every acceptance criterion tested end to end, plus hosted invocations, traces and agent evaluations, with bounded fix loops.",
    Deploy: "azd up ships agents and apps with keyless auth and monitoring, then reruns the end-to-end tests against the deployed endpoints.",
};
const BLOCKED_COPY = {
    Specify: "Preflight or the spec review found a blocker, such as missing access, quota or an unresolved question.",
    Implement: "Provisioning or the build hit a blocker that its agents could not resolve.",
    Verify: "Fix loops ended before every acceptance check passed.",
    Deploy: "Deployment, health checks or the deployed end-to-end tests did not pass.",
};
const MODE_HINT = {
    rapid: "Builds fast in a Foundry project you already have.",
    sdd: "A workflow specifies, implements, verifies and deploys, pausing at gates for your decision.",
};
// AGENTS.md records the build mode chosen when the loop started; Chat commands and the workflow follow it.
const LOCK_HINT = {
    rapid: "Locked by AGENTS.md. To move to SDD, ask Copilot in Chat to convert this prototype.",
    sdd: "Locked by AGENTS.md. To switch modes, ask Copilot in Chat.",
};
const LOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const BUILD = {
    rapid: {
        title: "Start with an outcome",
        intro: "Describe what you need or pick an industry scenario. Copilot builds a working agentic solution in your Foundry project.",
        guided: "Answer a few focused questions about agents, data, tools and the user experience.",
        send: "Send to Chat",
        hint: "Opens in Chat with your selected project. Copilot asks before creating or changing resources.",
    },
    sdd: {
        title: "Specify what to deliver",
        intro: "Start from a brief or a scenario. The workflow writes a spec for your approval, builds it in a new Foundry project, verifies it and deploys it to Azure.",
        guided: "Copilot asks only the questions that shape the spec, then starts the workflow.",
        send: "Start SDD workflow",
        hint: "Copilot runs preflight in Chat, then starts the workflow. Follow every phase on the Workflow tab.",
    },
};
const TARGET_HELP = "The workflow creates a resource group and a Foundry project here. Nothing deploys until you approve it.";

let snapshot;
let projects = [];
let selected = null;
let activeTab = "setup";
let selectionRevision = 0;
let discovering = false;
let usageLoading = false;
let scenarioReturn = null;
let frontendsLoading = false;
let frontendsSignature;
let frontendRevision;
let frontendState = null;
let resourcesSignature;
let projectSyncError = false;
let inventory = null;
let mode = "rapid";
let modePending = false;
let lock = null;
let modeHintKey = "";
let started = false;
let envProjectId = null;
let subscriptions = [];
let target = { subscriptionId: null, location: "auto", environmentName: "" };
let targetsLoading = null;
let live = null;
let liveVersion = -1;
let liveReceivedAt = Date.now();
let knownRuns = null;
let lastCheckpoint = null;
const regions = {};
const collapsedInventory = new Set(["resources"]);
const inventoryGroups = {
    agents: { title: "Agents", scope: "Project", empty: "No agents in this project yet.", hint: "Deploy an agent to see it here.", icon: '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6"/>' },
    models: { title: "Model deployments", scope: "Foundry account", empty: "No model deployments in this account.", hint: "Deploy a model or select an account with an existing deployment.", icon: '<path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 9 9-4M12 12 3 8m9 4v9"/>' },
    tools: { title: "Toolboxes", scope: "Project", empty: "No toolboxes connected yet.", hint: "Publish tools and skills in a Foundry toolbox to make them available to agents.", icon: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12h18m-12-2v4m6-4v4"/>' },
    resources: { title: "Azure resources", scope: "Resource group", empty: "No resources returned for this resource group.", hint: "Check the selected project and refresh the inventory.", icon: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>' },
};
const loaded = new Set();

function duration(ms) {
    const total = Math.max(0, Math.round((ms || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    const seconds = total % 60;
    if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
    return minutes ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

async function api(action, input = {}) {
    const response = await fetch("/api/action", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Canvas-Token": token },
        body: JSON.stringify({ action, input }),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `Request failed (${response.status}).`);
    return value;
}

function notice(message, error = false, action = null) {
    const node = $("notice");
    node.hidden = false;
    node.className = error ? "error" : "";
    node.textContent = message;
    if (action) {
        const button = document.createElement("button");
        button.className = "quiet";
        button.dataset.go = action.go;
        button.textContent = action.label;
        node.append(" ", button);
    }
    const close = document.createElement("button");
    close.className = "quiet icon-button notice-close";
    close.dataset.dismiss = "";
    close.ariaLabel = "Dismiss message";
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    node.append(close);
}

async function busy(button, work) {
    if (button.disabled) return;
    button.disabled = true;
    try { await work(); }
    catch (error) { notice(error.message, true); }
    finally { if (button.isConnected) button.disabled = button.hasAttribute("data-requires-project") && !activeProject(); }
}

function failure(container, error) {
    container.innerHTML = `<p class="error">${escape(error.message)} Refresh to retry.</p>`;
}

// SDD only trusts the project the workflow wrote to FOUNDRY_PROJECT; rapid uses the Resources selection.
function activeProject() {
    if (mode !== "sdd") return selected;
    return selected && envProjectId && selected.id.toLowerCase() === envProjectId.toLowerCase() ? selected : null;
}

function renderProjectBar() {
    const project = activeProject();
    if (mode === "sdd") {
        $("project-label").textContent = "Foundry project · created by the workflow";
        $("project-name").textContent = project?.name ?? (envProjectId ? envProjectId.split("/").at(-1) : "Not created yet");
    } else {
        $("project-label").textContent = "Microsoft Foundry project";
        $("project-name").textContent = selected?.name ?? "Choose a project";
    }
    for (const button of document.querySelectorAll("[data-requires-project]")) button.disabled = !project;
    $("build-project-hint").hidden = mode !== "rapid" || Boolean(selected);
    $("optimize-project-hint").hidden = Boolean(project);
    $("optimize-project-hint").textContent = mode === "sdd"
        ? "The SDD workflow creates your Foundry project during Implement. Project actions unlock once it exists."
        : "Select a project on Resources to enable project actions.";
}

function applyMode(next, preferredTab) {
    next = next === "sdd" ? "sdd" : "rapid";
    const changed = next !== mode;
    mode = next;
    document.body.dataset.mode = mode;
    for (const button of document.querySelectorAll(".mode [data-mode]")) {
        const on = button.dataset.mode === mode;
        button.setAttribute("aria-checked", String(on));
        button.tabIndex = on ? 0 : -1;
    }
    renderModeHint();
    for (const button of document.querySelectorAll("[data-tab]")) button.hidden = !TABS[mode].includes(button.dataset.tab);
    renderBuild();
    renderProjectBar();
    if (changed && started) onModeChanged(preferredTab);
    return changed;
}

// Re-render only on change so a focused "Open AGENTS.md" button keeps focus across live updates.
function renderModeHint() {
    const key = `${lock}:${mode}`;
    if (key === modeHintKey) return;
    modeHintKey = key;
    document.querySelector(".mode").toggleAttribute("data-locked", Boolean(lock));
    for (const button of document.querySelectorAll(".mode [data-mode]")) {
        if (lock && button.dataset.mode !== lock) { button.setAttribute("aria-disabled", "true"); button.title = "Locked by AGENTS.md"; }
        else { button.removeAttribute("aria-disabled"); button.removeAttribute("title"); }
    }
    const hint = $("mode-hint");
    hint.classList.toggle("locked", Boolean(lock));
    if (!lock) { hint.textContent = MODE_HINT[mode]; return; }
    hint.innerHTML = `${LOCK_ICON}<span>${escape(LOCK_HINT[lock])}</span><button class="quiet" data-artifact="AGENTS.md">Open AGENTS.md</button>`;
}

function onModeChanged(preferredTab) {
    loaded.delete("explore");
    loaded.delete("optimize");
    const tab = preferredTab ?? (TABS[mode].includes(activeTab) ? null : "build");
    if (tab) selectTab(tab).catch(error => notice(error.message, true));
    else if (["explore", "optimize"].includes(activeTab)) loadTab(activeTab).catch(error => notice(error.message, true));
    if (mode === "sdd") loadTargets();
    if (mode === "rapid" && !projects.length && !discovering && !projectSyncError) discover();
}

async function chooseMode(next, preferredTab) {
    if (next === mode) return;
    if (lock && next !== lock) { notice(LOCK_HINT[lock]); return; }
    const previous = mode;
    modePending = true;
    applyMode(next, preferredTab);
    try {
        const result = await api("mode", { mode: next });
        modePending = false;
        applyLive(result);
    } catch (error) {
        modePending = false;
        applyMode(previous);
        notice(error.message, true);
    }
}

function renderBuild() {
    const copy = BUILD[mode];
    $("build-title").textContent = copy.title;
    $("build-intro").textContent = copy.intro;
    $("guided-text").textContent = copy.guided;
    $("send-prompt").textContent = copy.send;
    $("send-hint").textContent = copy.hint;
    $("target").hidden = mode !== "sdd";
    renderTargetSummary();
}

function regionLabel(location) {
    return [...$("target-location").options].find(option => option.value === location)?.text ?? location;
}

function targetSummary() {
    const subscription = subscriptions.find(row => row.id === target.subscriptionId);
    return [
        subscription?.name ?? (target.subscriptionId || "subscription confirmed in Chat"),
        target.location === "auto" ? "region recommended by Copilot" : regionLabel(target.location),
        target.environmentName ? `azd environment ${target.environmentName}` : "azd environment named from the solution",
    ].join(" · ");
}

function renderTargetSummary() {
    $("review-target").hidden = mode !== "sdd";
    $("review-target").textContent = mode === "sdd" ? `Deploys to ${targetSummary()}` : "";
}

function applyTarget(value) {
    target = { ...target, ...value };
    const location = target.location || "auto";
    if (![...$("target-location").options].some(option => option.value === location)) $("target-location").add(new Option(location, location));
    $("target-location").value = location;
    if (document.activeElement !== $("target-env")) $("target-env").value = target.environmentName ?? "";
    $("target-subscription").value = subscriptions.some(row => row.id === target.subscriptionId) ? target.subscriptionId : "";
    renderTargetSummary();
}

function loadTargets(force = false) {
    if (targetsLoading && !force) return targetsLoading;
    $("target-subscription").disabled = true;
    targetsLoading = api("targets").then(result => {
        subscriptions = [...result.subscriptions].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
        $("target-subscription").innerHTML = '<option value="">Confirm in Chat</option>' +
            subscriptions.map(row => `<option value="${escape(row.id)}">${escape(row.name)}${row.isDefault ? " · default" : ""}</option>`).join("");
        applyTarget(result.target);
    }).catch(error => {
        targetsLoading = null;
        $("target-help").textContent = `Could not list subscriptions: ${error.message} Copilot confirms the subscription in Chat.`;
    }).finally(() => { $("target-subscription").disabled = false; });
    return targetsLoading;
}

async function saveTarget(input) {
    try {
        applyTarget(await api("target", input));
        $("target-help").textContent = TARGET_HELP;
        $("target-help").classList.remove("error");
    } catch (error) { notice(error.message, true); }
}

async function frontends(retry = false) {
    if (frontendsLoading) return;
    frontendsLoading = true;
    try {
        const selection = selectionRevision;
        const result = await api("frontends", retry ? { retry: true } : {});
        const nextEnvProject = result.foundryProject?.id ?? null;
        if (nextEnvProject !== envProjectId) { envProjectId = nextEnvProject; renderProjectBar(); }
        if (result.projectSync && selection === selectionRevision && !discovering) {
            const sync = result.projectSync;
            projectSyncError = Boolean(sync.error);
            $("project-env-error").hidden = !sync.error;
            $("project-env-error").textContent = sync.error
                ? `Could not synchronize FOUNDRY_PROJECT from .env: ${sync.error} Current selection kept. Refresh to retry.` : "";
            const signature = JSON.stringify({ ...sync, error: null });
            if (signature !== resourcesSignature) {
                resourcesSignature = signature;
                applyResources(sync);
                await monitoring();
                if (activeTab === "explore") await explore();
                if (activeTab === "optimize") await costs();
            }
        }
        const changed = frontendRevision !== undefined && frontendRevision !== result.revision;
        frontendRevision = result.revision;
        const signature = JSON.stringify(result);
        if (signature === frontendsSignature) return;
        frontendsSignature = signature;
        frontendState = result;
        setMark("build-mark", result.configured ? "✓" : "", "Frontend configured");
        $("build-mark").title = "Based on LOCAL_FRONTEND or DEPLOYED_FRONTEND in workspace .env; not a health check.";
        const configured = result.frontends.filter(row => row.configured);
        $("frontend-links").innerHTML = configured.map(row => `<div class="inventory-row"><strong>${escape(row.label)}</strong>${row.error
            ? `<p class="error">${escape(row.error)}</p>`
            : `<span class="frontend-url">${escape(row.url)}</span><div class="actions"><button data-frontend="${escape(row.key)}" aria-label="Open ${escape(row.label)} in integrated browser">Open in integrated browser</button><a href="${escape(row.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escape(row.label)} in external browser">Open in external browser ↗</a></div>`}</div>`).join("") ||
            `<p class="muted">${mode === "sdd" ? "No frontend yet. The workflow records it during Implement and Deploy." : "No frontend configured. Finish the build first."}</p>`;
        if (live) renderWorkflow(live);
        if (changed && mode === "rapid" && result.frontends.some(row => row.key === "local" && row.configured) && activeTab !== "explore") {
            await selectTab("explore").catch(error => notice(`Could not finish switching to Explore: ${error.message}`, true));
        }
    } catch (error) {
        projectSyncError = true;
        $("project-env-error").hidden = false;
        $("project-env-error").textContent = `Could not read project configuration: ${error.message} Current selection kept. Refresh to retry.`;
        frontendsSignature = undefined;
        setMark("build-mark", "");
        $("build-mark").title = error.message;
        failure($("frontend-links"), error);
    } finally { frontendsLoading = false; }
}

const SKELETON = '<div class="skeleton"><span></span><span></span><span></span><p class="visually-hidden">Checking skills, extensions, tools and Azure sign-in…</p></div>';

async function setup() {
    const toolsOpen = $("setup-tools")?.open ?? false;
    const skillsOpen = $("setup-skills")?.open ?? true;
    $("setup-actions").hidden = true;
    $("checks").innerHTML = SKELETON;
    setMark("setup-mark", "");
    try {
        const result = await api("setup");
        setMark("setup-mark", result.ready ? "✓" : "", "Ready");
        const toolIds = new Set(["az", "azd", "azd-ai", "az-auth", "azd-auth"]);
        const tools = result.checks.filter(check => toolIds.has(check.id));
        const skills = result.checks.filter(check => !toolIds.has(check.id));
        const renderCheck = check => `<div class="check"><span class="${check.status === "ready" ? "status-ok" : "status-warn"}" role="img" aria-label="${check.status === "ready" ? "Ready" : "Needs attention"}">${check.status === "ready" ? "✓" : "!"}</span><div><strong>${escape(check.label)}</strong><p class="muted">${escape(check.status === "ready" ? check.data : check.error)}</p></div></div>`;
        const renderGroup = (id, title, checks, open) => {
            if (!checks.length) return "";
            const count = checks.filter(check => check.status === "ready").length;
            const ready = count === checks.length;
            return `<details id="${id}" class="setup-group"${open || !ready ? " open" : ""}><summary><span class="${ready ? "status-ok" : "status-warn"}" aria-hidden="true">${ready ? "✓" : "!"}</span> ${title} <span class="muted">${count}/${checks.length} ready${ready ? "" : ` · ${checks.length - count} need attention`}</span></summary><div class="setup-group-checks">${checks.map(renderCheck).join("")}</div></details>`;
        };
        $("checks").innerHTML = renderGroup("setup-skills", "Skills and extensions", skills, skillsOpen) +
            renderGroup("setup-tools", "Azure tools and sign-in", tools, toolsOpen) +
            (result.discoveryError ? `<p class="error">${escape(result.discoveryError)} Refresh to retry skill discovery before installing skills.</p>` : "") +
            `<p class="muted">Checked ${escape(new Date(result.checkedAt).toLocaleTimeString())}</p>`;
        const missingPlugin = result.discoveryError ? [] : skills.filter(check => check.status !== "ready");
        const missingTools = tools.filter(check => ["az", "azd", "azd-ai"].includes(check.id) && check.status !== "ready");
        const missingAuth = tools.filter(check => ["az-auth", "azd-auth"].includes(check.id) && check.status !== "ready" &&
            tools.some(tool => tool.id === check.id.replace("-auth", "") && tool.status === "ready"));
        for (const [section, description, missing] of [
            ["setup-plugin-help", "setup-missing-plugin", missingPlugin],
            ["setup-cli-help", "setup-missing-tools", missingTools],
            ["setup-auth-help", "setup-missing-auth", missingAuth],
        ]) {
            $(section).hidden = missing.length === 0;
            $(description).textContent = missing.length ? `Needs attention: ${missing.map(check => check.label).join(", ")}.` : "";
        }
        $("setup-actions").hidden = !missingPlugin.length && !missingTools.length && !missingAuth.length;
    } catch (error) {
        setMark("setup-mark", "");
        failure($("checks"), error);
    }
}

function updateProject(project) {
    if (selected?.id !== project?.id) {
        inventory = null;
        $("inventory-toolbar").hidden = true;
        $("inventory").replaceChildren();
        $("inventory-updated").textContent = "";
        $("inventory-search").value = "";
        $("inventory-kind").value = "";
        $("azure-cost").replaceChildren();
        $("monitoring").replaceChildren();
        collapsedInventory.clear();
        collapsedInventory.add("resources");
    }
    selected = project;
    selectionRevision++;
    setMark("resources-mark", project ? "✓" : "", "Project selected");
    loaded.delete("explore");
    loaded.delete("optimize");
    renderProjectBar();
    $("resource-context").innerHTML = project ? `<div class="context"><span class="muted">Resource group · ${escape(project.location)}</span><strong>${escape(project.resourceGroup)}</strong><p class="muted">This resource group will also host additional resources such as Application Insights and Container Apps.</p></div>` : "";
    renderProjects();
}

function applyResources(result) {
    projects = result.projects;
    $("subscription").innerHTML = result.subscriptions.map(row => `<option value="${escape(row.id)}">${escape(row.name)}</option>`).join("");
    $("subscription").value = result.subscriptionId ?? result.selected?.subscriptionId ?? "";
    updateProject(result.selected);
    if (result.warnings?.length) notice(`Some resources could not be listed: ${result.warnings.join("; ")}`, true);
}

function renderProjects() {
    const query = $("project-search").value.toLowerCase();
    const filtered = projects.filter(project => `${project.name} ${project.account} ${project.resourceGroup}`.toLowerCase().includes(query));
    $("projects").innerHTML = filtered.map(project => `<button class="project-option" data-project="${escape(project.id)}" aria-pressed="${project.id === selected?.id}"><strong>${project.id === selected?.id ? "✓ " : ""}${escape(project.name)}</strong><small>${escape(project.account)} · ${escape(project.resourceGroup)}</small></button>`).join("") ||
        `<p class="muted">${projects.length ? "No matching projects. Try a different search." : "No Foundry projects found in this subscription. Create one below or choose another subscription."}</p>`;
}

async function monitoring() {
    const revision = selectionRevision;
    if (!activeProject()) { $("monitoring").innerHTML = ""; return; }
    $("monitoring").innerHTML = '<p class="loading">Checking Application Insights connection…</p>';
    try {
        const result = await api("monitoring");
        if (revision !== selectionRevision) return;
        $("monitoring").innerHTML = result.connected
            ? `<p class="status-ok">✓ Application Insights connected: ${escape(result.names.join(", "))}</p><p class="muted">Connection detected; end-to-end telemetry still needs verification in your application.</p>`
            : '<div class="warning"><strong>Application Insights is not connected</strong><p>Add a project connection so traces and diagnostics have a home.</p><button data-prompt="insights">Connect in Chat</button></div>';
    } catch (error) {
        if (revision === selectionRevision) $("monitoring").innerHTML = `<div class="warning"><strong>Monitoring connection could not be verified</strong><p>${escape(error.message)}</p><button data-prompt="insights">Investigate in Chat</button></div>`;
    }
}

async function discover(subscriptionId) {
    if (discovering) return;
    discovering = true;
    $("subscription").disabled = true;
    $("projects").innerHTML = '<p class="loading">Discovering Foundry projects…</p>';
    try {
        const result = await api("discover", subscriptionId ? { subscriptionId } : {});
        applyResources(result);
        await monitoring();
    } catch (error) {
        // Never keep a green check for a project whose current discovery failed.
        projects = [];
        updateProject(null);
        failure($("projects"), error);
        $("monitoring").innerHTML = "";
    } finally { discovering = false; $("subscription").disabled = false; }
}

function renderScenarios() {
    const query = $("scenario-search").value.toLowerCase();
    const industry = $("industry").value;
    const capability = $("capability").value;
    const rows = snapshot.scenarios.filter(row => (!industry || row.industry === industry) &&
        (!capability || row.tags.includes(capability) || row.capabilities?.includes(capability)) &&
        `${row.name} ${row.description} ${row.industry} ${row.tags.join(" ")}`.toLowerCase().includes(query));
    const sort = $("sort").value;
    rows.sort((a, b) => sort === "industry" ? a.industry.localeCompare(b.industry) || a.name.localeCompare(b.name) : (sort === "reverse" ? -1 : 1) * a.name.localeCompare(b.name));
    $("result-count").textContent = `${rows.length} ${rows.length === 1 ? "scenario" : "scenarios"}`;
    $("scenarios").innerHTML = rows.map(row => `<button class="scenario" data-scenario="${escape(row.id)}"><img src="/${escape(row.image)}" alt="" loading="lazy" width="480" height="270"><h3>${escape(row.name)}</h3><p>${escape(row.description)}</p><span class="industry">${escape(row.industry)} · Review brief →</span></button>`).join("") ||
        '<p class="muted">No scenarios match these filters. Clear filters to see all scenarios.</p>';
}

function openReview(title, text, returnButton) {
    scenarioReturn = { button: returnButton, scrollY: window.scrollY };
    $("prompt-title").textContent = title;
    $("prompt-text").value = text;
    $("cancel-prompt").lastChild.textContent = returnButton?.dataset.scenario ? " Back to scenarios" : " Back";
    setScenarioReview(true);
    api("preferences", { draft: text }).catch(error => notice(error.message, true));
    window.scrollTo({ top: 0, behavior: "instant" });
}

function reviewScenario(id) {
    const scenario = snapshot.scenarios.find(row => row.id === id);
    openReview(scenario.name, `${scenario.prompt}\n\nIndustry: ${scenario.industry}`, document.querySelector(`[data-scenario="${CSS.escape(id)}"]`));
    $("prompt-title").focus({ preventScroll: true });
}

function setScenarioReview(visible) {
    $("scenario-browser").hidden = visible;
    $("prompt-review").hidden = !visible;
    document.querySelector("#build .guided").hidden = visible;
    renderTargetSummary();
}

function returnToScenarios() {
    setScenarioReview(false);
    if (activeTab === "build") {
        const back = scenarioReturn?.button?.isConnected ? scenarioReturn.button : $("scenario-search");
        back.focus({ preventScroll: true });
        window.scrollTo({ top: scenarioReturn?.scrollY ?? 0, behavior: "instant" });
    }
}

function table(headers, rows) {
    return `<div class="table-scroll" tabindex="0" aria-label="Scrollable data table"><table><thead><tr>${headers.map(header => `<th scope="col">${escape(header)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

const external = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg>';

function renderInventory() {
    if (!inventory) return;
    const project = activeProject();
    const query = $("inventory-search").value.trim().toLowerCase();
    const kind = $("inventory-kind").value;
    let count = 0;
    let errors = 0;
    const groups = Object.entries(inventoryGroups).filter(([key]) => !kind || key === kind).map(([key, group]) => {
        const list = inventory[key];
        const failed = list.status === "error";
        const rows = failed ? [] : list.data.filter(row =>
            `${row.name} ${row.detail ?? ""} ${(row.metadata ?? []).map(item => `${item.label} ${item.value}`).join(" ")}`.toLowerCase().includes(query))
            .sort((a, b) => a.name.localeCompare(b.name));
        count += rows.length;
        if (failed) errors++;
        if (query && !rows.length && !failed) return "";
        const expanded = failed || query || !collapsedInventory.has(key);
        const portal = key === "resources" ? "Azure" : "Foundry";
        const content = failed
            ? `<div class="inventory-empty"><p class="error">${escape(list.error)}</p><button data-inventory-retry>Retry resource discovery</button></div>`
            : rows.length ? `<ul class="resource-list">${rows.map(row => `<li class="resource-item"><div class="resource-content"><strong class="resource-name">${escape(row.name)}</strong>${row.metadata?.length
                ? `<dl class="resource-metadata">${row.metadata.map(item => `<div><dt>${escape(item.label)}</dt><dd>${escape(item.value)}</dd></div>`).join("")}</dl>`
                : `<p class="resource-description">${escape(row.detail)}</p>`}</div><div class="resource-actions">${row.playgroundUrl
                    ? `<a class="resource-test" href="${escape(row.playgroundUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Test ${escape(row.name)} in Foundry (opens in a new tab)">Test in Foundry ${external}</a>` : ""}${row.portalUrl
                    ? `<a class="resource-test" href="${escape(row.portalUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escape(row.name)} in ${portal} Portal (opens in a new tab)">Open in ${portal} Portal ${external}</a>` : ""}${key === "agents" && project
                    ? `<button class="resource-test" data-inspect-agent="${escape(row.name)}" data-inspect-project="${escape(project.id)}" title="Ask Copilot in Chat to launch Agent Inspector for this agent" aria-label="Inspect ${escape(row.name)} locally via Chat">Inspect locally</button>` : ""}</div></li>`).join("")}</ul>`
            : `<div class="inventory-empty"><strong>${escape(group.empty)}</strong><p>${escape(group.hint)}</p></div>`;
        return `<details class="inventory-section" data-inventory-group="${key}" ${expanded ? "open" : ""}>
            <summary><svg class="resource-icon" viewBox="0 0 24 24" aria-hidden="true">${group.icon}</svg><span class="inventory-heading"><span class="inventory-title">${group.title}</span><span class="inventory-scope">${group.scope}</span></span><span class="${failed ? "inventory-unavailable" : "inventory-badge"}">${failed ? "Unavailable" : query ? `${rows.length} / ${list.data.length}` : list.data.length}</span><svg class="inventory-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></summary>
            ${content}</details>`;
    }).join("");
    $("inventory-count").textContent = `${count} ${query ? "matching " : ""}${count === 1 ? "entry" : "entries"}${errors ? ` · ${errors} unavailable ${errors === 1 ? "section" : "sections"}` : ""}`;
    $("inventory").innerHTML = groups || '<div class="inventory-empty"><strong>No matching resources</strong><p>Try another name or clear the filters to see all resources.</p></div>';
}

const noProject = what => mode === "sdd"
    ? `<p class="muted">The SDD workflow creates your Foundry project during Implement. ${what} appear here once it exists.</p>`
    : `<p class="muted">Select a project on Resources to ${what === "Azure charges" ? "query Azure spend" : "explore its resources"}.</p>`;

async function explore() {
    const revision = selectionRevision;
    $("inventory-toolbar").hidden = true;
    $("inventory-updated").textContent = "";
    inventory = null;
    if (!activeProject()) { $("inventory").innerHTML = noProject("Its agents, models and resources"); return; }
    $("inventory").innerHTML = '<p class="loading">Reading your Foundry project…</p>';
    try {
        const result = await api("explore");
        if (revision !== selectionRevision) return;
        inventory = result;
        $("inventory-toolbar").hidden = false;
        renderInventory();
        $("inventory-updated").textContent = `Retrieved ${new Date(result.checkedAt).toLocaleTimeString()}. Private endpoints require network access. Testing in Foundry requires sign-in and can incur model or agent usage charges.`;
    } catch (error) { if (revision === selectionRevision) failure($("inventory"), error); }
}

async function usage() {
    if (usageLoading) return;
    usageLoading = true;
    try {
        const metrics = await api("usage");
        if (!snapshot.sessionId || metrics.sessionId !== snapshot.sessionId) {
            throw new Error("Usage belongs to a different or unidentified session. Reopen this canvas from the intended session.");
        }
        const count = value => typeof value === "number" && Number.isFinite(value) ? number(value) : "—";
        const rows = Object.entries(metrics.modelMetrics).filter(([, value]) => value).map(([name, value]) => [
            name, count(value.usage?.inputTokens), count(value.usage?.outputTokens), count(value.usage?.cacheReadTokens),
            count(value.usage?.cacheWriteTokens), count(value.usage?.reasoningTokens), count(value.requests?.count),
        ]);
        const tokens = Object.entries(metrics.tokenDetails ?? {}).filter(([, value]) => value)
            .map(([kind, value]) => [kind.replaceAll("_", " "), count(value.tokenCount)]);
        $("usage").innerHTML = `<p class="muted">Copilot session <span class="usage-session-id">${escape(metrics.sessionId)}</span>${metrics.sessionStartTime ? ` · Started ${escape(new Date(metrics.sessionStartTime).toLocaleString())}` : ""}</p>` +
            `<h4>Session accounting</h4><p>${metrics.totalNanoAiu == null ? "AI credits unavailable" : `${count(metrics.totalNanoAiu / 1e9)} AI credits`}</p>` +
            (tokens.length ? table(["Token category", "Reported tokens"], tokens) : '<p class="muted">Session token accounting is unavailable from this runtime.</p>') +
            '<h4>Live model breakdown</h4>' +
            (rows.length ? table(["Model", "Input", "Output", "Cache read", "Cache write", "Reasoning", "Calls"], rows) : '<p class="muted">No model breakdown returned by the runtime. This does not establish zero session usage.</p>') +
            `<p class="muted">${count(metrics.totalUserRequests)} runtime-reported user requests · ${metrics.totalApiDurationMs == null ? "API time unavailable" : `${(metrics.totalApiDurationMs / 1000).toFixed(1)}s model API time`}</p>` +
            '<p class="muted">After resume, token, request and model counters may cover different periods from session credits; they are not guaranteed lifetime totals. Missing history is not treated as zero. Accounting categories and live token counters are separate measures, not additive. Copilot credits are not USD or Azure usage.</p>' +
            `<p class="muted">Updated ${escape(new Date(metrics.checkedAt).toLocaleTimeString())}. Refreshes every 15 seconds while Optimize is visible.</p>`;
    } catch (error) { failure($("usage"), error); }
    finally { usageLoading = false; }
}

async function costs() {
    const revision = selectionRevision;
    const usagePromise = usage();
    if (!activeProject()) { $("azure-cost").innerHTML = noProject("Azure charges"); await usagePromise; return; }
    $("azure-cost").innerHTML = '<p class="loading">Querying Azure Cost Management…</p>';
    try {
        const result = await api("cost");
        if (revision !== selectionRevision) return;
        $("azure-cost").innerHTML = result.rows.length ? table(["Service", "Actual cost"], result.rows.map(row => [row.service, money(row.amount, row.currency)])) : '<p class="muted">Azure returned no charges for this period. This does not guarantee zero cost.</p>';
        $("azure-cost").innerHTML += `<p class="muted">Retrieved ${escape(new Date(result.checkedAt).toLocaleTimeString())}</p>`;
    } catch (error) { if (revision === selectionRevision) failure($("azure-cost"), error); }
    await usagePromise;
}

const STATUS = {
    pending: ["Starting", "accent"], running: ["Running", "accent"], paused: ["Paused", "warning"],
    completed: ["Completed", "success"], halted: ["Halted", "warning"], error: ["Failed", "error"], cancelled: ["Cancelled", "muted"],
};
const VIEW = {
    pending: ["", "Not started"], active: ["", "In progress"], waiting: ["!", "Waiting for you"], paused: ["‖", "Paused"],
    completed: ["✓", "Done"], failed: ["✕", "Needs attention"], stopped: ["–", "Stopped"], skipped: ["–", "Skipped"],
};
const isLive = run => run?.status === "running" || run?.status === "pending";
const statusOf = run => run.status === "paused" && run.checkpoint ? ["Needs you", "warning"] : STATUS[run.status] ?? [run.status, "muted"];

// Re-render a region only when its data changes, keeping keyboard focus on the same control.
function region(key, node, value, html) {
    const signature = JSON.stringify(value);
    if (regions[key] === signature) return false;
    regions[key] = signature;
    const focused = node.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    node.innerHTML = typeof html === "function" ? html() : html;
    if (focused) node.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    return true;
}

function phaseView(phase, run) {
    if (run.pause?.phase === phase.title) return "waiting";
    if (phase.status === "active") {
        if (isLive(run)) return "active";
        if (run.status === "paused") return "paused";
        if (run.status === "error" || run.status === "halted") return "failed";
        if (run.status === "cancelled") return "stopped";
        return "completed";
    }
    if (phase.status === "completed") return phase.gate && phase.gate.status !== "passed" ? "failed" : "completed";
    if (phase.status === "pending" && run.status === "completed") return "skipped";
    return phase.status === "skipped" ? "skipped" : "pending";
}

const artifactExists = (run, file) => file === LESSONS ? run.loop : run.phases.some(phase => phase.artifacts.some(row => row.path === file && row.exists));
const artifactButton = (run, file, label, key = `artifact:${file}`) => `<button data-artifact="${escape(file)}" data-key="${escape(key)}"${artifactExists(run, file) ? "" : ' disabled title="Not written yet"'}>${escape(label)}</button>`;

const RUNNING = new Set(["running", "active"]);
const elapsed = value => Number.isFinite(toTime(value)) ? ` · <span class="since" data-since="${toTime(value)}" title="Time on this step">${duration(Date.now() - toTime(value))}</span>` : "";

// What the phase is doing right now: the running agents with their elapsed time, then the last completed step.
function nowLines(phase, run) {
    const latest = run.log.findLast(row => row.kind === "log" && !/^(Brief|\w+ gate):/.test(row.text));
    const last = latest ? `<p class="now"><span class="muted">Last</span> ${escape(latest.text)}</p>` : "";
    const running = phase.agents.filter(agent => RUNNING.has(agent.status));
    const name = agent => String(agent.label ?? "").replace(`${phase.title} · `, "");
    if (running.length === 1) {
        const [agent] = running;
        return `<p class="now"><span class="muted">Now</span> ${escape(name(agent))}${agent.activity ? ` · ${escape(agent.activity)}` : ""}${elapsed(agent.startedAt)}</p>${last}`;
    }
    if (running.length > 1) return `<p class="now"><span class="muted">Now</span> ${running.length} agents in parallel: ${escape(running.map(name).join(", "))}</p>${last}`;
    return latest ? `<p class="now"><span class="muted">Now</span> ${escape(latest.text)}</p>` : "";
}

function renderPhase(phase, index, run) {
    const view = phaseView(phase, run);
    const [glyph, label] = VIEW[view];
    const started = view !== "pending" && view !== "skipped";
    const gate = phase.gate ? `<p class="gate"><span class="badge" data-gate="${escape(phase.gate.status)}">Gate ${escape(phase.gate.status)}</span>${phase.gate.summary ? ` ${escape(phase.gate.summary)}` : ""}</p>` : "";
    const now = view === "active" ? nowLines(phase, run) : "";
    const agents = phase.agents.slice(0, 6).map(agent => `<li class="agent" data-status="${escape(agent.status)}" title="${escape([agent.model, agent.activity].filter(Boolean).join(" · ") || agent.status)}"><span class="dot" aria-hidden="true"></span>${escape(agent.label)}<span class="visually-hidden">, ${escape(agent.status)}</span></li>`).join("") +
        (phase.agents.length > 6 ? `<li class="agent more">+${phase.agents.length - 6} more</li>` : "");
    const artifacts = started && phase.artifacts.length ? `<div class="artifacts">${phase.artifacts.map(row => artifactButton(run, row.path, row.path.split("/").at(-1))).join("")}</div>` : "";
    return `<li class="phase" data-view="${view}"${view === "active" || view === "waiting" ? ' aria-current="step"' : ""}>
        <span class="phase-icon" aria-hidden="true">${glyph}</span>
        <div class="phase-body">
            <div class="phase-head"><h3>${escape(phase.title)}</h3><span class="phase-state">${label}${started ? ` · <span data-duration="${index}">${duration(phase.activeMs)}</span>` : ""}</span></div>
            ${started && (phase.gate || phase.agents.length || now) ? "" : `<p class="muted">${escape(PHASE_COPY[phase.title])}</p>`}
            ${gate}
            ${now}
            ${agents ? `<ul class="agents" aria-label="${escape(phase.title)} agents">${agents}</ul>` : ""}
            ${artifacts}
        </div></li>`;
}

const LIMIT_TEXT = {
    maxTotalSubagents: ["agent limit", value => `${value} agents`],
    timeoutSeconds: ["time limit", value => duration(value * 1000)],
    maxAiCredits: ["AI credit limit", value => `${value} AI credits`],
};
const raisable = failure => failure?.type === "workflow_limit_reached" && Number.isFinite(failure.suggestedValue) && LIMIT_TEXT[failure.kind];

function formatFailure(failure) {
    if (failure?.type === "workflow_limit_reached") {
        const [label, format] = LIMIT_TEXT[failure.kind] ?? ["limit", String];
        return `The run reached its ${label} (${format(failure.value)}). Nothing was lost; resume to continue from the last completed step.`;
    }
    if (failure?.type === "workflow_resume_declined") return `Resume was declined: ${failure.reason}`;
    return null;
}

function feedbackBlock(label, placeholder, send) {
    return `<div id="wf-changes" class="changes" hidden>
        <label for="wf-feedback">${label}</label>
        <textarea id="wf-feedback" data-key="feedback" rows="4" maxlength="8000" placeholder="${escape(placeholder)}"></textarea>
        <div class="actions"><button data-wf="changes-send" data-key="changes-send" disabled>${send}</button></div>
        <p class="muted">Copilot applies the changes in Chat and leaves the run paused. Approve here when you are satisfied.</p>
    </div>`;
}

// The next decision the run will ask for, from its arguments in the flight record.
function nextDecision(run, phase) {
    const plan = run.plan;
    const fixes = Number.isInteger(plan?.maxFixLoops) ? ` after ${plan.maxFixLoops} automatic ${plan.maxFixLoops === 1 ? "fix" : "fixes"}` : " after its automatic fixes";
    const stuck = `If a gate still fails${fixes}, the run pauses here and lists the issues.`;
    if (!plan) return `The run pauses here when it needs a decision. ${stuck}`;
    if (phase === "Deploy") return "Nothing more. The endpoints appear here when Deploy finishes.";
    const specPending = run.phases.find(row => row.title === "Specify")?.gate?.status !== "passed";
    if (plan.autonomy === "gated" && specPending) return `Approve the spec when Specify passes. Nothing is provisioned before then. ${stuck}`;
    if (plan.skipDeploy) return `Nothing until the run ends after Verify; you deploy later from Chat. ${stuck}`;
    return `Approve deployment when Verify passes. ${stuck}`;
}

function calloutHtml(run) {
    const phase = run.phases.find(row => row.status === "active")?.title ?? run.phase ?? "the next phase";
    const cancel = '<button data-wf="cancel" data-key="cancel" class="danger-quiet">Cancel run</button>';
    const improve = `<button data-prompt="improve" data-run="${escape(run.runId)}" data-key="improve">Improve the loop</button>`;
    const box = (tone, title, body) => `<div class="callout" data-tone="${tone}" role="group" aria-labelledby="wf-callout-title"><h3 id="wf-callout-title">${title}</h3>${body}</div>`;
    if (isLive(run)) {
        const agents = run.metrics.liveAgents;
        const working = agents ? `${agents} ${agents === 1 ? "agent is" : "agents are"} working in the background` : "The run continues in the background";
        return box("accent", `Working on ${escape(phase)}`, `<p><strong>No input needed.</strong> ${working}; keep using Chat.</p>
            <p><strong>Next for you:</strong> ${escape(nextDecision(run, phase))}</p>
            <div class="actions"><button data-wf="pause" data-key="pause">Pause</button>${cancel}</div>`);
    }
    if (run.status === "paused" && run.checkpoint === "approve-spec-v1") {
        return box("warning", "Review the spec", `<p>The spec and deployment plan are ready. Approving starts Implement, which provisions the Foundry project and the resources in the plan. Ask for changes first if anything is off.</p>
            <div class="actions">${artifactButton(run, "docs/spec.md", "Open spec")}${artifactButton(run, ".azure/deployment-plan.md", "Open deployment plan")}</div>
            <div class="actions"><button class="primary" data-wf="resume" data-key="approve">Approve spec and continue</button><button data-wf="changes-toggle" data-key="changes" aria-expanded="false" aria-controls="wf-changes">Request changes</button>${cancel}</div>
            ${feedbackBlock("What should change in the spec?", "For example: add an escalation agent for refunds over $500; keep the web UI read-only.", "Send changes to Chat")}`);
    }
    if (run.status === "paused" && run.pause?.kind === "blocked") {
        const { phase: blocked, round } = run.pause;
        const row = run.phases.find(item => item.title === blocked);
        const blocker = run.blocker;
        const fixes = blocker?.fixes ? ` after ${blocker.fixes} automatic ${blocker.fixes === 1 ? "fix" : "fixes"}` : "";
        const title = blocker?.status === "failed" ? `${blocked} still fails its gate${fixes}` : blocker ? `${blocked} is blocked` : `${blocked} needs you`;
        const issues = blocker?.issues ?? [];
        const list = issues.length ? `<p class="issues-head">${issues.length === 1 ? "Fix this issue" : `Fix these ${issues.length} issues`}, then resume:</p><ol class="issues">${issues.map(issue => `<li>${escape(issue)}</li>`).join("")}</ol>` : "";
        const files = (row?.artifacts ?? []).map(file => artifactButton(run, file.path, `Open ${file.path.split("/").at(-1)}`)).join("");
        return box("warning", escape(title), `<p>${escape(blocker?.summary || row?.gate?.summary || BLOCKED_COPY[blocked])}</p>${list}
            <div class="actions">${files}${run.loop ? artifactButton(run, LESSONS, "Open loop-sri.md") : ""}</div>
            <details class="guidance"><summary>Add guidance for the fix</summary><label for="wf-feedback" class="visually-hidden">Guidance for the fix</label><textarea id="wf-feedback" data-key="feedback" rows="3" maxlength="8000" placeholder="Optional: point Copilot at the cause, a region with quota or an acceptable trade-off."></textarea></details>
            <div class="actions"><button class="primary" data-wf="fix" data-key="fix">Fix in Chat</button><button data-wf="resume" data-key="retry">Resume and retry ${escape(blocked)}</button>${cancel}</div>
            <p class="muted">Fixing in Chat leaves the run paused. Resume when Copilot reports the fix; ${escape(blocked)} then runs again as attempt ${round + 1}, and its review first confirms these issues are resolved.</p>`);
    }
    if (run.status === "paused" && run.checkpoint === "approve-deploy-v1") {
        return box("warning", "Approve deployment", `<p>Verify passed. Deploying runs azd up, which publishes the agents and apps and adds billable compute. Check the region, resources and cost estimate in the deployment plan first.</p>
            <div class="actions">${artifactButton(run, ".azure/deployment-plan.md", "Open deployment plan")}${artifactButton(run, "docs/verify.md", "Open verification report")}</div>
            <div class="actions"><button class="primary" data-wf="resume" data-key="approve">Approve deployment</button><button data-wf="changes-toggle" data-key="changes" aria-expanded="false" aria-controls="wf-changes">Request changes</button>${cancel}</div>
            ${feedbackBlock("What should change before deployment?", "For example: deploy to Sweden Central; use the S0 tier for search.", "Send changes to Chat")}`);
    }
    if (run.status === "paused") {
        return box("warning", `Paused during ${escape(phase)}`, run.canResume
            ? `<p>Resume continues from the last completed step.</p><div class="actions"><button class="primary" data-wf="resume" data-key="resume">Resume</button>${cancel}</div>`
            : `<p>This run cannot be resumed. Start a new run from Build.</p><div class="actions"><button data-go="build">Start a new run</button></div>`);
    }
    if (run.status === "completed") {
        const deployed = frontendState?.frontends.find(row => row.key === "deployed" && row.configured && !row.error);
        const endpoints = run.outcome?.endpoints?.length
            ? `<ul class="endpoints" aria-label="Endpoints">${run.outcome.endpoints.map(row => `<li><a href="${escape(row.url)}" target="_blank" rel="noopener noreferrer">${escape(row.name)} <span aria-hidden="true">↗</span><span class="visually-hidden"> (opens in a new tab)</span></a></li>`).join("")}</ul>` : "";
        if (run.outcome?.status === "verified") {
            return box("success", "Verified, ready to deploy", `<p>Specified, implemented and verified. This run skipped Deploy; Copilot asks for your approval before azd up.</p>${endpoints}
                <div class="actions"><button class="primary" data-prompt="deploy" data-run="${escape(run.runId)}" data-key="deploy">Deploy from Chat</button>${artifactButton(run, "docs/verify.md", "Open verification report")}${artifactButton(run, ".azure/deployment-plan.md", "Open deployment plan")}${improve}</div>`);
        }
        return box("success", "Delivered", `<p>${run.outcome?.status === "deployed" ? "Specified, implemented, verified and deployed." : "The run completed."} Every phase left its evidence in the workspace.</p>${endpoints}
            <div class="actions">${deployed ? '<button class="primary" data-frontend="deployed" data-key="deployed">Open deployed app</button>' : ""}${artifactButton(run, "docs/deploy.md", "Open deployment report")}<button data-go="explore" data-key="explore">Explore resources</button>${improve}${run.loop ? artifactButton(run, LESSONS, "Open loop-sri.md") : ""}</div>`);
    }
    if (run.status === "error" || run.status === "halted") {
        const message = run.error || formatFailure(run.failure) || run.reason || "The run stopped before finishing.";
        const title = run.status === "error" ? "Workflow failed" : "Workflow halted";
        const tone = run.status === "error" ? "error" : "warning";
        if (run.canResume && raisable(run.failure)) {
            const [, format] = LIMIT_TEXT[run.failure.kind];
            return box(tone, title, `<p>${escape(message)}</p>
                <div class="actions"><button class="primary" data-wf="raise" data-key="raise">Resume with ${escape(format(run.failure.suggestedValue))}</button>${improve}<button data-go="build" data-key="new">Start a new run</button></div>`);
        }
        return box(tone, title, `<p>${escape(message)}</p>
            <details class="guidance"><summary>Add guidance for the fix</summary><label for="wf-feedback" class="visually-hidden">Guidance for the fix</label><textarea id="wf-feedback" data-key="feedback" rows="3" maxlength="8000" placeholder="Optional: point Copilot at the cause, a region with quota or an acceptable trade-off."></textarea></details>
            <div class="actions"><button class="primary" data-wf="fix" data-key="fix">Fix in Chat</button>${run.canResume ? '<button data-wf="resume" data-key="resume">Resume</button>' : ""}${improve}<button data-go="build" data-key="new">Start a new run</button></div>
            ${run.canResume ? '<p class="muted">Fixing in Chat leaves the run stopped. Resume when Copilot reports the fix.</p>' : ""}`);
    }
    return box("muted", "Run cancelled", `<p>Nothing else runs for this workflow. Artifacts written so far stay in your workspace.</p><div class="actions"><button data-go="build" data-key="new">Start a new run</button></div>`);
}

function renderWorkflow(snap) {
    const run = snap.run;
    $("wf-error").hidden = !snap.error;
    $("wf-error").textContent = snap.error ? `Workflow status could not be refreshed: ${snap.error}` : "";
    $("wf-empty").hidden = Boolean(run);
    $("wf-run").hidden = !run;
    if (!run) return;
    $("wf-picker-row").hidden = snap.runs.length < 2;
    region("picker", $("wf-picker"), [snap.runs.map(row => [row.runId, row.status, row.checkpoint]), run.runId], () => snap.runs.map(row => {
        const created = new Date(toTime(row.createdAt));
        return `<option value="${escape(row.runId)}"${row.runId === run.runId ? " selected" : ""}>${escape(created.toLocaleDateString([], { month: "short", day: "numeric" }))} ${escape(clock(created))} · ${escape(statusOf(row)[0])}</option>`;
    }).join(""));
    $("wf-brief").textContent = run.brief ?? "SDD workflow run";
    const [label, tone] = statusOf(run);
    $("wf-status").textContent = label;
    $("wf-status").dataset.tone = tone;
    const credits = run.metrics.credits;
    $("wf-meta").innerHTML = `Started ${escape(clock(run.createdAt))} · Active <span data-duration="run">${duration(run.metrics.activeMs)}</span> · ${number(run.metrics.subagents)} ${run.metrics.subagents === 1 ? "agent" : "agents"}${credits ? ` · ${credits.toLocaleString(undefined, { maximumFractionDigits: 2 })} AI credits` : ""}`;
    $("wf-meta").title = "AI credits are Copilot usage by this run's agents. Azure charges are separate; see Optimize.";
    const prior = $("wf-changes");
    const draft = { key: `${run.runId}:${run.checkpoint}`, value: $("wf-feedback")?.value ?? "", open: prior ? !prior.hidden : false, details: document.querySelector("#wf-callout details")?.open ?? false };
    const deployed = Boolean(frontendState?.frontends.some(row => row.key === "deployed" && row.configured && !row.error));
    const calloutKey = [run.runId, run.status, run.checkpoint, run.canResume, run.phase, run.metrics.liveAgents, run.outcome, run.plan, run.blocker, run.error, run.failure, run.reason, run.loop, deployed,
        run.phases.map(row => [row.gate, row.artifacts])];
    if (region("callout", $("wf-callout"), calloutKey, () => calloutHtml(run)) && draft.key === regions.draftKey) {
        if ($("wf-feedback")) $("wf-feedback").value = draft.value;
        if (draft.open && $("wf-changes")) toggleChanges(true, false);
        const details = document.querySelector("#wf-callout details");
        if (details && draft.details) details.open = true;
        const send = $("wf-callout").querySelector('[data-wf="changes-send"]');
        if (send) send.disabled = !draft.value.trim();
    }
    regions.draftKey = `${run.runId}:${run.checkpoint}`;
    const latest = run.log.findLast(row => row.kind === "log")?.seq;
    const stable = run.phases.map(row => ({ ...row, activeMs: 0, agents: row.agents.map(agent => ({ ...agent, activeMs: 0 })) }));
    region("phases", $("wf-phases"), [run.runId, run.status, run.checkpoint, latest, stable],
        () => run.phases.map((phase, index) => renderPhase(phase, index, run)).join(""));
    $("wf-log-count").textContent = run.log.length ? `· ${run.log.length} ${run.log.length === 1 ? "entry" : "entries"}` : "";
    region("log", $("wf-log"), [run.runId, run.log.at(-1)?.seq], () => [...run.log].reverse().map(row =>
        `<li${row.kind === "phase" ? ' class="phase-line"' : ""}><time datetime="${escape(iso(row.at))}">${escape(clock(row.at, true))}</time><span>${escape(row.text)}</span></li>`).join("") ||
        '<li class="muted">No activity yet.</li>');
    tick();
}

// Durations advance locally between live snapshots while a run is executing.
function tick() {
    const run = live?.run;
    if (!run) return;
    const extra = isLive(run) ? Date.now() - liveReceivedAt : 0;
    const runNode = document.querySelector('#wf-meta [data-duration="run"]');
    if (runNode) runNode.textContent = duration(run.metrics.activeMs + extra);
    run.phases.forEach((phase, index) => {
        const node = document.querySelector(`#wf-phases [data-duration="${index}"]`);
        if (node) node.textContent = duration(phase.activeMs + (phase.status === "active" ? extra : 0));
    });
    if (isLive(run)) document.querySelectorAll("#wf-phases [data-since]").forEach(node => { node.textContent = duration(Date.now() - Number(node.dataset.since)); });
}

function renderWorkflowMark(snap) {
    const run = snap.run;
    const [text, tone, label] = !run ? ["", "", ""]
        : run.status === "paused" ? ["!", "warning", run.checkpoint ? "Needs you" : "Paused"]
            : isLive(run) ? ["●", "accent", "Running"]
                : run.status === "completed" ? ["✓", "success", "Completed"]
                    : run.status === "error" || run.status === "halted" ? ["✕", "error", STATUS[run.status][0]] : ["", "", STATUS[run.status]?.[0] ?? run.status];
    setMark("workflow-mark", text, label, tone);
}

function applyLive(snap, initial = false) {
    if (!snap || typeof snap.version !== "number" || snap.version < liveVersion) return;
    liveVersion = snap.version;
    liveReceivedAt = Date.now();
    live = snap;
    const fresh = knownRuns ? snap.runs.find(row => !knownRuns.has(row.runId)) : null;
    knownRuns = new Set(snap.runs.map(row => row.runId));
    const openWorkflow = !initial && Boolean(fresh) && (snap.mode ?? mode) === "sdd" && activeTab !== "workflow";
    lock = snap.lock ?? null;
    if (!modePending && snap.mode && snap.mode !== mode) applyMode(snap.mode, openWorkflow ? "workflow" : undefined);
    else if (openWorkflow) selectTab("workflow").catch(error => notice(error.message, true));
    renderModeHint();
    const checkpoint = snap.run?.checkpoint ? `${snap.run.runId}:${snap.run.checkpoint}` : null;
    if (!initial && !openWorkflow && checkpoint && checkpoint !== lastCheckpoint && activeTab !== "workflow") {
        notice(`${snap.run.pause?.phase ?? "The workflow"} needs your decision.`, false, { go: "workflow", label: "Review" });
    }
    lastCheckpoint = checkpoint;
    document.body.classList.toggle("is-busy", Boolean(snap.busy));
    renderWorkflowMark(snap);
    renderWorkflow(snap);
    updateDock();
}

async function liveLoop() {
    let delay = 1000;
    for (;;) {
        try {
            const response = await fetch(`/api/live?v=${liveVersion}`, { headers: { "X-Canvas-Token": token }, cache: "no-store" });
            const value = await response.json();
            if (!response.ok) throw new Error(value.error || `Live updates failed (${response.status}).`);
            applyLive(value);
            delay = 1000;
        } catch {
            await sleep(delay);
            delay = Math.min(delay * 2, 30_000);
        }
    }
}

function toggleChanges(open, focus = true) {
    const toggle = $("wf-callout").querySelector('[data-wf="changes-toggle"]');
    if (!toggle || !$("wf-changes")) return;
    $("wf-changes").hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open && focus) $("wf-feedback").focus();
}

const RESUMED = {
    "approve-spec-v1": "Spec approved. Implement is starting.",
    "approve-deploy-v1": "Deployment approved. azd up is deploying your solution.",
};
const resumedText = pause => RESUMED[pause?.key] ?? (pause?.kind === "blocked" ? `Resumed. ${pause.phase} runs again.` : "Resumed.");
let cancelTimer;

function workflowAction(button) {
    const run = live?.run;
    if (!run) return;
    const runId = run.runId;
    const action = button.dataset.wf;
    if (action === "changes-toggle") { toggleChanges($("wf-changes").hidden); return; }
    if (action === "cancel" && !button.dataset.confirm) {
        button.dataset.confirm = "1";
        button.classList.add("danger");
        button.textContent = "Confirm cancel";
        clearTimeout(cancelTimer);
        cancelTimer = setTimeout(() => {
            if (!button.isConnected) return;
            delete button.dataset.confirm;
            button.classList.remove("danger");
            button.textContent = "Cancel run";
        }, 4000);
        return;
    }
    busy(button, async () => {
        if (action === "resume") {
            await api("workflow_resume", { runId });
            notice(resumedText(run.pause));
        } else if (action === "raise") {
            await api("workflow_resume", { runId, raiseLimit: true });
            notice("Resumed with a higher limit.");
        } else if (action === "pause") {
            await api("workflow_pause", { runId });
            notice("Pausing. The current step finishes first.");
        } else if (action === "cancel") {
            clearTimeout(cancelTimer);
            await api("workflow_cancel", { runId });
            notice("Run cancelled. Artifacts written so far stay in your workspace.");
        } else if (action === "changes-send" || action === "fix") {
            const text = $("wf-feedback")?.value.trim() ?? "";
            if (action === "changes-send" && !text) { $("wf-feedback")?.focus(); throw new Error("Describe the changes first."); }
            await api("prompt", { kind: "changes", runId, ...(text ? { text } : {}) });
            if ($("wf-feedback")) $("wf-feedback").value = "";
            regions.draftKey = null;
            if (action === "changes-send") toggleChanges(false);
            notice(action === "changes-send" ? "Sent to Chat. The run stays paused until you approve here."
                : run.canResume ? "Sent to Chat. Resume here after Copilot reports the fix." : "Sent to Chat. Start a new run after Copilot reports the fix.");
        }
    });
}

// Enablement dock: rotating Foundry tips, matched to the active phase, shown only while Copilot works.
const dock = { cards: [], pool: [], index: -1, phase: undefined, swap: null };

function shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

function currentPhase() {
    const run = live?.run;
    return mode === "sdd" && isLive(run) ? run.phases.find(row => row.status === "active") ?? null : null;
}

async function loadEnablement() {
    try {
        const response = await fetch("/enablement.json");
        if (!response.ok) return;
        const value = await response.json();
        dock.cards = (value.cards ?? []).filter(card => card.title && card.body);
        updateDock();
    } catch { /* Tips are optional; the dock keeps its status line. */ }
}

function renderCard(card) {
    $("dock-title").textContent = card.title;
    $("dock-body").textContent = card.body;
    $("dock-snippet").hidden = !card.snippet;
    $("dock-snippet").firstElementChild.textContent = card.snippet ?? "";
    $("dock-topic").textContent = card.topic ?? "";
    $("dock-link").hidden = !card.link?.url;
    if (card.link?.url) {
        $("dock-link").href = card.link.url;
        $("dock-link").textContent = `${card.link.label} ↗`;
        $("dock-link").ariaLabel = `${card.link.label} (opens in a new tab)`;
    }
    $("dock-card").hidden = $("dock").dataset.collapsed === "true";
}

function restartProgress() {
    const bar = $("dock-progress");
    bar.style.animation = "none";
    void bar.offsetWidth;
    bar.style.animation = "";
}

function nextCard(immediate = false) {
    if (!dock.pool.length) return;
    dock.index = (dock.index + 1) % dock.pool.length;
    const card = dock.pool[dock.index];
    restartProgress();
    clearTimeout(dock.swap);
    if (immediate || reducedMotion.matches || $("dock-card").hidden) { renderCard(card); return; }
    $("dock-card").classList.add("is-swapping");
    dock.swap = setTimeout(() => { renderCard(card); $("dock-card").classList.remove("is-swapping"); }, 180);
}

function updateDock() {
    const phase = currentPhase()?.title.toLowerCase() ?? "any";
    if (dock.cards.length && phase !== dock.phase) {
        dock.phase = phase;
        const pool = dock.cards.filter(card => card.phase === phase || card.phase === "any");
        dock.pool = shuffle(pool.length ? pool : [...dock.cards]);
        dock.index = -1;
        nextCard(true);
    }
    updateDockStatus();
}

function updateDockStatus() {
    if (!live?.busy) return;
    const phase = currentPhase();
    const since = value => Number.isFinite(toTime(value)) ? ` · ${duration(Date.now() - toTime(value))}` : "";
    const agents = live.run?.metrics.liveAgents ?? 0;
    $("dock-status").textContent = phase
        ? `${phase.title} phase${agents ? ` · ${agents} ${agents === 1 ? "agent" : "agents"} working` : ""}${since(phase.startedAt)}`
        : `Copilot is working${since(live.busySince)}`;
}

function setDockPaused(paused) {
    $("dock").dataset.paused = String(paused);
    $("dock-pause").setAttribute("aria-pressed", String(paused));
    $("dock-pause").title = paused ? "Resume tips" : "Pause tips";
}

$("dock-progress").addEventListener("animationend", () => nextCard());
$("dock-pause").onclick = () => setDockPaused($("dock").dataset.paused !== "true");
$("dock-next").onclick = () => nextCard();
$("dock-hide").onclick = () => {
    const collapsed = $("dock").dataset.collapsed !== "true";
    $("dock").dataset.collapsed = String(collapsed);
    $("dock-card").hidden = collapsed || dock.index < 0;
    $("dock-hide").setAttribute("aria-expanded", String(!collapsed));
    $("dock-hide").textContent = collapsed ? "Show tips" : "Hide tips";
    if (!collapsed) restartProgress();
};
setDockPaused(reducedMotion.matches);

// Host theme variables do not reach the iframe, so the deck gets the resolved scheme instead.
function hostTheme() {
    const context = document.createElement("canvas").getContext("2d");
    context.fillStyle = getComputedStyle(document.body).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? "dark" : "light";
}

// The deck lives in an iframe; Escape inside it posts deck-close because the dialog cannot see that key.
$("how").onclick = () => {
    const frame = $("deck-frame");
    const theme = hostTheme();
    if (!frame.getAttribute("src")) {
        frame.addEventListener("load", () => frame.contentWindow?.focus(), { once: true });
        frame.src = `/deck.html?theme=${theme}`;
    } else frame.contentWindow?.postMessage({ type: "deck-theme", theme }, location.origin);
    $("deck-dialog").showModal();
    frame.focus();
};
$("deck-close").onclick = () => $("deck-dialog").close();
$("deck-dialog").addEventListener("close", () => $("how").focus());
$("deck-dialog").addEventListener("click", event => { if (event.target === $("deck-dialog")) $("deck-dialog").close(); });
window.addEventListener("message", event => {
    if (event.origin === location.origin && event.data?.type === "deck-close" && $("deck-dialog").open) $("deck-dialog").close();
});

async function loadTab(tab, force = false) {
    if (["build", "explore", "workflow"].includes(tab) || force) await frontends(force);
    if (tab === "workflow") { applyLive(await api("live")); return; }
    if (tab === "build" && force && mode === "sdd") await loadTargets(true);
    if (loaded.has(tab) && !force) {
        if (tab === "optimize") await usage();
        return;
    }
    loaded.add(tab);
    if (tab === "setup") await setup();
    if (tab === "resources" && (force || !projects.length)) await discover();
    if (tab === "explore") await explore();
    if (tab === "optimize") await costs();
}

async function selectTab(tab) {
    if (tab === "workflow" && mode !== "sdd") return chooseMode("sdd", "workflow");
    if (!TABS[mode].includes(tab)) tab = "build";
    activeTab = tab;
    for (const button of document.querySelectorAll("[data-tab]")) {
        const current = button.dataset.tab === tab;
        button.ariaSelected = String(current);
        button.tabIndex = current ? 0 : -1;
        $(button.dataset.tab).hidden = !current;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    await api("preferences", { tab });
    await loadTab(tab);
}

const SENT = {
    plugin: "Sent to Chat. Copilot installs what is missing with your approval; refresh Setup afterwards.",
    devpack: "Sent to Chat. Copilot checks your tools and asks before installing anything.",
    auth: "Sent to Chat. Complete sign-in there, then refresh Setup.",
    quickstart: "Sent to Chat. Copilot plans the project and asks before creating it.",
    landingZone: "Sent to Chat. Copilot plans the landing zone with you.",
    insights: "Sent to Chat. Copilot connects Application Insights with your approval.",
    foundry: "Sent to Chat. Copilot opens Microsoft Foundry Canvas for your project.",
    optimizer: "Sent to Chat. Copilot confirms the agent and baseline before any run.",
    evaluations: "Sent to Chat. Copilot confirms the agent, data and thresholds first.",
    insightsScan: "Sent to Chat. Copilot confirms scope before starting the scan.",
    improve: "Sent to Chat. Copilot analyzes past runs and proposes changes for your review.",
    deploy: "Sent to Chat. Copilot runs the deploy preflight and asks for approval before azd up.",
};

document.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.tab) { selectTab(button.dataset.tab).catch(error => notice(error.message, true)); return; }
    if (button.dataset.go) {
        if (button.closest("#notice")) $("notice").hidden = true;
        selectTab(button.dataset.go).catch(error => notice(error.message, true));
        return;
    }
    if (button.dataset.mode && button.closest(".mode")) { chooseMode(button.dataset.mode); return; }
    if (button.hasAttribute("data-dismiss")) { $("notice").hidden = true; return; }
    if (button.dataset.scenario) { reviewScenario(button.dataset.scenario); return; }
    if (button.dataset.wf) { workflowAction(button); return; }
    if (button.dataset.artifact) { busy(button, () => api("open_artifact", { path: button.dataset.artifact })); return; }
    if (button.hasAttribute("data-inventory-retry")) { busy(button, explore); return; }
    if (button.hasAttribute("data-inspect-agent")) {
        busy(button, async () => {
            await api("inspect_agent", { agentName: button.dataset.inspectAgent, projectId: button.dataset.inspectProject });
            notice("Inspection request sent to Chat. Copilot checks prerequisites and launches Agent Inspector for this agent.");
        });
        return;
    }
    if (button.dataset.frontend) {
        busy(button, async () => {
            await api("open_frontend", { frontend: button.dataset.frontend });
            notice("App opened in the integrated browser.");
        });
        return;
    }
    if (button.dataset.project) {
        busy(button, async () => { updateProject(await api("select", { projectId: button.dataset.project })); await monitoring(); });
        return;
    }
    if (button.dataset.prompt) busy(button, async () => {
        const kind = button.dataset.prompt;
        await api("prompt", { kind, ...(button.dataset.run ? { runId: button.dataset.run } : {}) });
        notice(kind === "guided"
            ? mode === "sdd" ? "Sent to Chat. Copilot asks a few questions, then starts the workflow." : "Sent to Chat. Answer Copilot's questions there."
            : SENT[kind] ?? "Sent to Chat. Continue there.");
    });
});

document.querySelector("nav").addEventListener("keydown", event => {
    const buttons = [...document.querySelectorAll("[data-tab]")].filter(button => !button.hidden);
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
    if (event.key === "ArrowLeft") next = (index + buttons.length - 1) % buttons.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = buttons.length - 1;
    if (next !== undefined) { event.preventDefault(); buttons[next].focus(); selectTab(buttons[next].dataset.tab).catch(error => notice(error.message, true)); }
});
document.querySelector(".mode").addEventListener("keydown", event => {
    const buttons = [...document.querySelectorAll(".mode [data-mode]")];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    let next;
    if (["ArrowRight", "ArrowDown"].includes(event.key)) next = (index + 1) % buttons.length;
    if (["ArrowLeft", "ArrowUp"].includes(event.key)) next = (index + buttons.length - 1) % buttons.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = buttons.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    const choice = buttons[next].dataset.mode;
    if (lock && choice !== lock) { notice(LOCK_HINT[lock]); return; }
    buttons[next].focus();
    chooseMode(choice);
});
$("project-bar").onclick = () => selectTab(mode === "rapid" ? "resources" : activeProject() ? "explore" : "workflow").catch(error => notice(error.message, true));
$("refresh").onclick = () => busy($("refresh"), () => loadTab(activeTab, true));
$("refresh-foundry").onclick = () => busy($("refresh-foundry"), async () => {
    await api("refresh_foundry");
    notice("Microsoft Foundry Canvas workspace state refreshed.");
});
$("subscription").onchange = () => discover($("subscription").value);
$("project-search").oninput = renderProjects;
$("inventory-search").oninput = renderInventory;
$("inventory-kind").onchange = renderInventory;
$("inventory-reset").onclick = () => {
    $("inventory-search").value = "";
    $("inventory-kind").value = "";
    renderInventory();
    $("inventory-search").focus();
};
$("inventory").addEventListener("toggle", event => {
    const key = event.target.dataset.inventoryGroup;
    if (!key || $("inventory-search").value.trim()) return;
    if (event.target.open) collapsedInventory.delete(key);
    else collapsedInventory.add(key);
}, true);
$("wf-picker").onchange = () => api("workflow_select", { runId: $("wf-picker").value }).then(applyLive).catch(error => notice(error.message, true));
$("wf-callout").addEventListener("input", event => {
    if (event.target.id !== "wf-feedback") return;
    const send = $("wf-callout").querySelector('[data-wf="changes-send"]');
    if (send) send.disabled = !event.target.value.trim();
});
$("target-subscription").onchange = () => saveTarget({ subscriptionId: $("target-subscription").value });
$("target-location").onchange = () => saveTarget({ location: $("target-location").value });
let envSave;
$("target-env").oninput = () => {
    clearTimeout(envSave);
    const value = $("target-env").value.trim();
    const valid = !value || /^[a-zA-Z][a-zA-Z0-9-]{1,19}$/.test(value);
    $("target-env").setAttribute("aria-invalid", String(!valid));
    $("target-help").textContent = valid ? TARGET_HELP : "Use 2 to 20 letters, digits or hyphens, starting with a letter.";
    $("target-help").classList.toggle("error", !valid);
    if (valid) envSave = setTimeout(() => saveTarget({ environmentName: value }), 400);
};
for (const id of ["scenario-search", "industry", "capability", "sort"]) $(id).addEventListener(id === "scenario-search" ? "input" : "change", renderScenarios);
$("clear-filters").onclick = () => {
    for (const id of ["scenario-search", "industry", "capability"]) $(id).value = "";
    $("sort").value = "name";
    renderScenarios();
};
$("own-brief").onclick = () => {
    openReview("Your solution brief", "", $("own-brief"));
    $("prompt-text").focus({ preventScroll: true });
};
let draftSave;
$("prompt-text").oninput = () => {
    clearTimeout(draftSave);
    draftSave = setTimeout(() => api("preferences", { draft: $("prompt-text").value }).catch(error => notice(error.message, true)), 300);
};
$("cancel-prompt").onclick = () => {
    clearTimeout(draftSave);
    returnToScenarios();
    api("preferences", { draft: "" }).catch(error => notice(error.message, true));
};
$("send-prompt").onclick = () => busy($("send-prompt"), async () => {
    const text = $("prompt-text").value.trim();
    if (!text) { $("prompt-text").focus(); throw new Error("Write a brief first, or pick a scenario."); }
    clearTimeout(draftSave);
    await api("prompt", { kind: "custom", text });
    await api("preferences", { draft: "" });
    returnToScenarios();
    notice(mode === "sdd"
        ? "Sent to Chat. Copilot runs preflight, then starts the workflow. Follow it on the Workflow tab."
        : activeProject() ? `Sent to Chat with ${activeProject().name}. Continue there.` : "Sent to Chat. Copilot asks which Foundry project to use.");
});

async function start() {
    const response = await fetch("/api/state", { headers: { "X-Canvas-Token": token } });
    snapshot = await response.json();
    if (!response.ok) throw new Error(snapshot.error);
    target = { ...target, ...snapshot.state.target };
    lock = snapshot.live?.lock ?? null;
    applyMode(snapshot.live?.mode ?? snapshot.state.mode);
    if (snapshot.state.draft) {
        $("prompt-text").value = snapshot.state.draft;
        setScenarioReview(true);
    }
    for (const [id, values] of [
        ["industry", snapshot.scenarios.map(row => row.industry)],
        ["capability", snapshot.scenarios.flatMap(row => [...row.tags, ...(row.capabilities ?? [])])],
    ]) for (const value of [...new Set(values)].sort()) $(id).add(new Option(value, value));
    renderScenarios();
    if (snapshot.live) applyLive(snapshot.live, true);
    const run = snapshot.live?.run;
    const saved = snapshot.state.tab;
    const initialTab = mode === "sdd" && run && ["running", "pending", "paused"].includes(run.status) ? "workflow"
        : saved ? (TABS[mode].includes(saved) ? saved : "build") : "setup";
    // Always run readiness and project discovery on open, including restored tabs.
    loaded.add("setup");
    if (mode === "rapid") loaded.add("resources");
    const initial = Promise.all([setup(), (async () => {
        await frontends();
        if (mode === "rapid" && !projects.length && !projectSyncError) await discover();
    })()]);
    const deferred = ["explore", "optimize"].includes(initialTab);
    await selectTab(deferred ? "setup" : initialTab);
    liveLoop();
    loadEnablement();
    if (mode === "sdd") loadTargets();
    await initial;
    started = true;
    if (deferred || !TABS[mode].includes(activeTab)) await selectTab(deferred ? initialTab : "build");
    setInterval(() => { if (activeTab === "optimize" && !document.hidden) usage(); }, 15_000);
    setInterval(() => { if (!document.hidden) frontends(); }, 5_000);
    setInterval(() => { tick(); updateDockStatus(); }, 1000);
    const refreshVisible = () => {
        if (document.hidden) return;
        frontends();
        if (activeTab === "optimize") usage();
    };
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
}
start().catch(error => notice(`Canvas initialization failed: ${error.message}`, true));
