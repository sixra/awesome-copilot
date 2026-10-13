import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { PHASES } from "./args.mjs";

export const SKILLS = Object.freeze({
    router: "foundry-agentic-loop",
    foundry: "microsoft-foundry",
});

export function phaseGuide(phase) {
    return path.join("references", `${phase.toLowerCase()}.md`);
}

// A partial override or an older copy of a skill must not shadow a complete one.
const REQUIRED = Object.freeze({
    router: ["SKILL.md", path.join("references", "sdd.md"), ...PHASES.map(phaseGuide)],
    foundry: ["SKILL.md"],
});

async function isFile(file) {
    try { return (await stat(file)).isFile(); }
    catch { return false; }
}

async function directories(folder) {
    try { return (await readdir(folder, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort(); }
    catch { return []; }
}

// Project overrides (written by improve mode) win, then the plugin that ships this extension,
// then a repository checkout, other installed plugins and personal skills.
export async function candidates(name, { cwd, extensionDir, home }) {
    const installed = path.join(home, ".copilot", "installed-plugins");
    const plugins = [];
    for (const marketplace of await directories(installed)) {
        for (const plugin of await directories(path.join(installed, marketplace))) plugins.push(path.join(installed, marketplace, plugin, "skills", name));
    }
    return [
        ["project", path.join(cwd, ".github", "skills", name)],
        ["project", path.join(cwd, ".agents", "skills", name)],
        ["plugin", path.resolve(extensionDir, "..", "..", "..", "skills", name)],
        ["repository", path.resolve(extensionDir, "..", "..", "skills", name)],
        ...plugins.map(folder => ["installed", folder]),
        ["personal", path.join(home, ".copilot", "skills", name)],
        ["personal", path.join(home, ".agents", "skills", name)],
    ];
}

async function complete(dir, files) {
    for (const file of files) if (!(await isFile(path.join(dir, file)))) return false;
    return true;
}

export async function resolveSkills(options) {
    const resolved = {};
    for (const [key, name] of Object.entries(SKILLS)) {
        resolved[key] = { name, dir: null, source: "skill-tool" };
        for (const [source, dir] of await candidates(name, options)) {
            if (await complete(dir, REQUIRED[key])) { resolved[key] = { name, dir, source }; break; }
        }
    }
    return resolved;
}

export function missingSkills(skills) {
    return Object.values(skills).filter(skill => !skill.dir).map(skill => skill.name);
}
