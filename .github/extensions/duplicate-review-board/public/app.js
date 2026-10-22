const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="board-token"]').content;
let board = { items: [], reports: [], columns: [], selected: null };
let discovered = [];
let opened;
let preview;
let dirty = false;
let publishing = false;

async function api(name, body) {
    const response = await fetch(`/api/${name}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "x-board-token": token, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
    return result;
}

function message(text, error = false, target = "message") {
    $(target).textContent = text;
    $(target).classList.toggle("error", error);
}

async function run(button, work, target = "message") {
    button.disabled = true;
    try { await work(); }
    catch (error) { message(error.message, true, target); }
    finally {
        button.disabled = false;
        const item = board.selected === opened?.number && board.items.find((entry) => entry.id === opened.id);
        if (item && $("detail").open) refreshReview(item);
    }
}

function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function safeLink(link, url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") throw new Error("Invalid GitHub link");
        link.href = parsed.href;
    } catch { link.removeAttribute("href"); }
}

function columns(select, value) {
    select.replaceChildren(...board.columns.map((column) => {
        const option = element("option", column.label);
        option.value = column.id;
        return option;
    }));
    select.value = value;
}

function render() {
    const chosen = $("reports").value;
    const selected = board.reports.some((report) => String(report.number) === chosen)
        ? String(board.selected ?? "") : chosen || String(board.selected ?? "");
    const reports = new Map([...discovered, ...board.reports].map((report) => [report.number, report]));
    $("reports").replaceChildren(...[...reports.values()].sort((a, b) => b.number - a.number).map((report) => {
        const option = element("option", `#${report.number} ${report.title} (${report.state})`);
        option.value = report.number;
        return option;
    }));
    if (reports.has(Number(selected))) $("reports").value = selected;
    const query = $("search").value.toLowerCase();
    const visible = board.items.filter((item) =>
        (!$("hide-published").checked || !item.publication) &&
        `${item.title} ${item.resources.map((resource) => resource.path).join(" ")}`.toLowerCase().includes(query));
    $("board").replaceChildren(...board.columns.map((column) => {
        const container = element("section", undefined, "column");
        const items = visible.filter((item) => item.column === column.id);
        const total = board.items.filter((item) => item.column === column.id).length;
        container.append(element("h2", `${column.label} (${items.length}/${total})`));
        container.addEventListener("dragover", (event) => event.preventDefault());
        container.addEventListener("drop", (event) => {
            event.preventDefault();
            const item = board.items.find((entry) => entry.id === event.dataTransfer.getData("text/plain"));
            if (item && !item.publication) run($("import"), () => move(item, column.id));
        });
        for (const item of items) {
            const card = element("article", undefined, "card");
            card.draggable = !item.publication;
            card.addEventListener("dragstart", (event) => event.dataTransfer.setData("text/plain", item.id));
            const title = element("button", `Group ${item.number}: ${item.title}`);
            title.addEventListener("click", () => show(item.id));
            card.append(title, element("p", item.resources.map((resource) => resource.path).join("\n"), "prewrap"));
            for (const badge of [
                item.accepted && "Accepted on source", item.changed && "Source changed",
                item.queueId && "Background review queued", item.review && `AI: ${item.review.recommendation}`,
                item.reviewError && "Review failed / cancelled",
                item.publication && `Publication: ${item.publication.status}`,
            ].filter(Boolean)) card.append(element("span", badge, "badge"));
            const select = element("select");
            select.setAttribute("aria-label", `Local decision for group ${item.number}`);
            columns(select, item.column);
            select.disabled = Boolean(item.publication);
            select.addEventListener("change", () => run(select, () => move(item, select.value)));
            card.append(select);
            container.append(card);
        }
        if (!items.length) container.append(element("small", total ? "No groups match the filters." : "No groups."));
        return container;
    }));
    if (!board.selected) $("board").append(element("p", "Find reports, then import one to begin. No remote actions happen automatically."));
    if (opened && $("detail").open) {
        const item = board.items.find((entry) => entry.id === opened.id);
        if (board.selected === opened.number && item) refreshReview(item);
    }
}

function receive(snapshot) { board = snapshot; render(); }

async function move(item, column) {
    receive(await api("update", {
        number: board.selected, id: item.id, column, note: item.note, draft: item.draft,
    }));
    message("Local decision saved. GitHub is unchanged.");
}

function refreshReview(item) {
    $("review-result").textContent = item.queueId ? "Queued for a background agent. You can keep triaging." :
        item.reviewError || (item.review ? `${item.review.recommendation}\n\n${item.review.rationale}` : "No comparison yet.");
    $("review").disabled = Boolean(item.queueId || item.publication);
    $("cancel-review").disabled = !item.queueId;
    $("receipt").replaceChildren();
    if (item.publication) {
        $("receipt").append(element("p", `GitHub publication: ${item.publication.status} (${item.publication.kind})`));
        if (item.publication.url) {
            const link = element("a", "Open published result");
            link.target = "_blank"; link.rel = "noopener noreferrer";
            safeLink(link, item.publication.url);
            $("receipt").append(link);
        }
    }
    for (const id of ["column", "note", "draft-title", "draft-body", "save", "preview"]) {
        $(id).disabled = Boolean(item.publication);
    }
}

function show(id) {
    const item = board.items.find((entry) => entry.id === id);
    opened = { number: board.selected, id };
    dirty = false;
    $("detail-title").textContent = `Group ${item.number}: ${item.title}`;
    safeLink($("source"), board.reports.find((report) => report.number === opened.number)?.url);
    $("flags").textContent = [
        item.accepted && "Already accepted in the source report.",
        item.changed && "Source evidence changed since an earlier import. Review this group again; private notes were preserved.",
    ].filter(Boolean).join(" ");
    $("reason").textContent = item.reason;
    $("resources").replaceChildren(...item.resources.map((resource) => {
        const li = element("li");
        const link = element("a", resource.path);
        const file = resource.path.startsWith("skills/") && !resource.path.endsWith("/SKILL.md") ? `${resource.path}/SKILL.md` : resource.path;
        safeLink(link, `https://github.com/${board.repo}/blob/main/${file.split("/").map(encodeURIComponent).join("/")}`);
        link.target = "_blank"; link.rel = "noopener noreferrer";
        li.append(link, document.createTextNode(` - ${resource.description}`));
        return li;
    }));
    columns($("column"), item.column);
    $("note").value = item.note;
    $("draft-title").value = item.draft.title;
    $("draft-body").value = item.draft.body;
    $("guidance").value = "";
    $("draft").hidden = item.column !== "consolidate";
    message("", false, "detail-message");
    refreshReview(item);
    $("detail").showModal();
}

async function save() {
    receive(await api("update", {
        ...opened, column: $("column").value, note: $("note").value,
        draft: { title: $("draft-title").value, body: $("draft-body").value },
    }));
    dirty = false;
    message("Saved locally. GitHub is unchanged.", false, "detail-message");
}

$("discover").addEventListener("click", () => run($("discover"), async () => {
    discovered = await api("reports", {});
    render();
    message(`Found ${discovered.length} reports (up to 100 most recent). Select one and import it.`);
}));
$("import").addEventListener("click", () => run($("import"), async () => {
    const number = Number($("reports").value);
    if (!number) throw new Error("Find and select a report first.");
    receive(await api("import", { number }));
    message(`Imported report #${number}. Unchanged local decisions were preserved.`);
}));
$("reports").addEventListener("change", () => {
    const number = Number($("reports").value);
    if (board.reports.some((report) => report.number === number)) {
        run($("import"), async () => receive(await api("select", { number })));
    }
});
$("search").addEventListener("input", render);
$("hide-published").addEventListener("change", render);
$("column").addEventListener("change", () => { $("draft").hidden = $("column").value !== "consolidate"; });
$("editor").addEventListener("input", (event) => { if (event.target.id !== "guidance") dirty = true; });
$("editor").addEventListener("change", (event) => { if (event.target.id === "column") dirty = true; });
$("editor").addEventListener("submit", (event) => {
    event.preventDefault();
    run($("save"), save, "detail-message");
});
function closeDetail(event) {
    if (dirty && !window.confirm("Discard unsaved local edits?")) { event?.preventDefault(); return; }
    $("detail").close();
    opened = null;
}
$("close").addEventListener("click", closeDetail);
$("detail").addEventListener("cancel", closeDetail);
$("review").addEventListener("click", () => run($("review"), async () => {
    if (dirty) throw new Error("Save local edits before asking for a comparison.");
    await api("review", { ...opened, guidance: $("guidance").value });
    message("Comparison queued for a background agent.", false, "detail-message");
}, "detail-message"));
$("cancel-review").addEventListener("click", () => run($("cancel-review"), async () => receive(await api("cancel", opened)), "detail-message"));
$("preview").addEventListener("click", () => run($("preview"), async () => {
    if (dirty) throw new Error("Save local edits before previewing.");
    preview = await api("preview", opened);
    $("target").textContent = `Target: ${preview.target}`;
    $("publish-title").textContent = preview.title;
    $("publish-body").textContent = preview.body;
    message("", false, "publish-message");
    $("confirmation").showModal();
}, "detail-message"));
$("back").addEventListener("click", () => { if (!publishing) $("confirmation").close(); });
$("confirmation").addEventListener("cancel", (event) => { if (publishing) event.preventDefault(); });
$("confirm").addEventListener("click", () => run($("confirm"), async () => {
    publishing = true;
    $("back").disabled = true;
    message("Checking GitHub and publishing the confirmed payload. Do not retry if the response is lost.", false, "publish-message");
    try {
        receive(await api("publish", { token: preview.token }));
        $("confirmation").close();
        message("Published. The receipt is saved locally.", false, "detail-message");
    } finally { publishing = false; $("back").disabled = false; }
}, "publish-message"));
$("reconcile").addEventListener("click", () => run($("reconcile"), async () => {
    receive(await api("reconcile", opened));
    message("GitHub result verified; local receipt updated.", false, "detail-message");
}, "detail-message"));

const events = new EventSource(`/events?token=${encodeURIComponent(token)}`);
events.addEventListener("board", (event) => receive(JSON.parse(event.data)));
events.addEventListener("error", () => message("Connection interrupted. Local state is saved; reconnecting...", true));
events.addEventListener("open", () => message("Connected. Triage is local until you confirm a GitHub action."));
api("board").then(receive).catch((error) => message(error.message, true));
