import { createHash } from "node:crypto";

export const digest = (text) => createHash("sha256").update(text).digest("hex");

export function resourcePath(value) {
    return /^(?:agents\/[a-z0-9.-]+\.agent\.md|instructions\/[a-z0-9.-]+\.instructions\.md|skills\/[a-z0-9-]+(?:\/SKILL\.md)?)$/.test(value);
}

/** Parse only the detector's group sections; never infer groups from prose. */
export function parseReport(body) {
    if (typeof body !== "string") throw new Error("The report has no Markdown body.");
    const headings = [...body.matchAll(/^#### Group (\d+):[ \t]*(.+)\r?$/gm)];
    if (!headings.length) throw new Error("No duplicate groups found. Expected '#### Group N: ...' sections.");
    const ids = new Set();
    return headings.map((heading, index) => {
        const start = heading.index;
        const end = headings[index + 1]?.index ?? body.length;
        const section = body.slice(start, end);
        const resources = [...section.matchAll(/^\|[ \t]*`([^`]+)`[ \t]*\|[ \t]*([^|\r\n]+)\|[ \t]*([^\r\n]*)\|[ \t]*\r?$/gm)]
            .map((match) => ({ path: match[1], type: match[2].trim(), description: match[3].trim() }));
        if (resources.length < 2 || resources.some((resource) => !resourcePath(resource.path))) {
            throw new Error(`Group ${heading[1]} has an unsupported resource table. Nothing was imported.`);
        }
        for (const resource of resources) {
            if (resource.path.startsWith("skills/") && !resource.path.endsWith("/SKILL.md")) resource.path += "/SKILL.md";
        }
        const paths = resources.map((resource) => resource.path).sort();
        if (new Set(paths).size !== paths.length) throw new Error(`Group ${heading[1]} repeats a resource.`);
        const id = digest(paths.join("\n")).slice(0, 24);
        if (ids.has(id)) throw new Error("The report repeats the same resource group.");
        ids.add(id);
        const checkbox = /^- \[([ xX])\][ \t]+Reviewed[^\r\n]*$/m.exec(section);
        if (!checkbox) throw new Error(`Group ${heading[1]} has no Reviewed checkbox.`);
        const reason = /\*\*Why flagged:\*\*[ \t]*([\s\S]*?)(?=\r?\n---|\r?\n<\/details>|$)/.exec(section)?.[1].trim() ?? "";
        const title = heading[2].trim();
        return {
            id, number: Number(heading[1]), title, resources, reason,
            accepted: checkbox[1].toLowerCase() === "x",
            checkboxOffset: start + checkbox.index + 3,
            fingerprint: digest(JSON.stringify({ title, resources, reason })),
        };
    });
}

export function acceptGroup(body, id) {
    const group = parseReport(body).find((entry) => entry.id === id);
    if (!group) throw new Error("The group is no longer in the source report.");
    return body.slice(0, group.checkboxOffset) + "x" + body.slice(group.checkboxOffset + 1);
}
