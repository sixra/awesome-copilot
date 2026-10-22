import { randomUUID } from "node:crypto";
import { acceptGroup, digest, parseReport } from "./report.mjs";

export class Publisher {
    constructor(store, github) {
        this.store = store;
        this.github = github;
        this.previews = new Map();
        this.busy = false;
    }

    preview(number, id) {
        const report = this.store.report(number);
        const item = this.store.item(number, id);
        if (item.publication || item.queueId) throw new Error("Resolve the pending review or publication first.");
        if (!["separate", "consolidate"].includes(item.column)) throw new Error("Choose Keep separate or Consolidate first.");
        if (item.accepted && item.column === "separate") throw new Error("This group is already accepted on GitHub.");
        const preview = {
            token: randomUUID(), number, id, revision: item.revision, sourceHash: report.sourceHash,
            kind: item.column, expires: Date.now() + 5 * 60 * 1000,
            target: item.column === "separate" ? report.url : "New issue in github/awesome-copilot",
            title: item.column === "consolidate" ? item.draft.title : report.title,
            body: item.column === "consolidate" ? item.draft.body + `\n\n<!-- duplicate-review-board:${id} -->` : acceptGroup(report.body, id),
        };
        for (const [token, entry] of this.previews) if (entry.expires < Date.now()) this.previews.delete(token);
        this.previews.set(preview.token, preview);
        return preview;
    }

    async publish(token) {
        const preview = this.previews.get(token);
        this.previews.delete(token);
        if (!preview || preview.expires < Date.now()) throw new Error("Preview expired. Preview the action again.");
        if (this.busy) throw new Error("A publication is already in progress.");
        this.busy = true;
        try {
            const { number, id, kind } = preview;
            const current = await this.github.get(number);
            if (digest(current.body) !== preview.sourceHash) throw new Error("The report changed on GitHub. Refresh and preview again.");
            if (kind === "separate" && current.state !== "open") throw new Error("This report is closed. Keep the decision local or use the current report.");
            const marker = `<!-- duplicate-review-board:${id} -->`;
            if (kind === "consolidate" && (await this.github.find(marker)).length) {
                throw new Error("A tracking issue already exists for this group. Use Reconcile instead of creating another.");
            }
            await this.store.mutate((state) => {
                const item = this.store.item(number, id, state);
                const report = this.store.report(number, state);
                if (item.revision !== preview.revision || report.sourceHash !== preview.sourceHash || item.publication || item.queueId) {
                    throw new Error("Local triage changed. Preview the action again.");
                }
                item.publication = { kind, status: "unconfirmed", at: new Date().toISOString(), marker };
            });
            // Persist the intent before any write: a lost response must never trigger a blind retry.
            try {
                const result = kind === "separate"
                    ? await this.github.patch(number, preview.body)
                    : await this.github.create(preview.title, preview.body);
                if (!/^https:\/\/github\.com\/github\/awesome-copilot\/issues\/\d+$/.test(result.html_url) ||
                    result.body !== preview.body) {
                    throw new Error("GitHub did not return the expected issue URL and exact body");
                }
                await this.store.mutate((state) => {
                    const item = this.store.item(number, id, state);
                    item.publication = { ...item.publication, status: "published", url: result.html_url };
                });
            } catch (error) {
                throw new Error(`Publication not confirmed: ${error.message}. Reconcile with GitHub before any further action.`);
            }
            return this.store.snapshot();
        } finally {
            this.busy = false;
        }
    }

    async reconcile(number, id) {
        if (this.busy) throw new Error("Wait for the current publication to finish.");
        const item = this.store.item(number, id);
        const intent = item.publication;
        const kind = intent?.kind ?? item.column;
        let url;
        if (kind === "separate") {
            const issue = await this.github.get(number);
            if (!parseReport(issue.body).find((group) => group.id === id)?.accepted) {
                throw new Error("GitHub does not show this group as accepted. No local receipt was changed; inspect GitHub manually.");
            }
            url = issue.html_url;
        } else if (kind === "consolidate") {
            const matches = await this.github.find(`<!-- duplicate-review-board:${id} -->`);
            if (matches.length !== 1) throw new Error(`Found ${matches.length} matching tracking issues. Inspect GitHub manually; no retry was made.`);
            url = matches[0].html_url;
        } else throw new Error("No publishable decision to reconcile.");
        return this.store.mutate((state) => {
            const current = this.store.item(number, id, state);
            if (JSON.stringify(current.publication) !== JSON.stringify(intent)) throw new Error("Publication changed. Reconcile again.");
            current.publication = { kind, status: "published", url, at: intent?.at ?? new Date().toISOString() };
        });
    }
}
