import fs from "node:fs";
import path from "node:path";
import { VFile } from "vfile";
import { matter } from "vfile-matter";

/**
 * Associate a reviewed, local README with an external listing, never its
 * installation source. Reject symlinks so the build only reads committed docs.
 */
export function externalPluginReadme(root, name) {
  if (
    typeof name !== "string" ||
    name.length > 64 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(name) ||
    name.includes("..") ||
    name.includes("--")
  ) {
    throw new Error(`Invalid external plugin name for README: "${name}"`);
  }

  const segments = ["docs", "external-plugins", name, "README.md"];
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    const isReadme = index === segments.length - 1;
    if (stat.isSymbolicLink() || (isReadme ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error(`External plugin README must be a regular file in a local directory: ${current}`);
    }
  }

  const file = new VFile({ path: current, value: fs.readFileSync(current, "utf8") });
  matter(file, { strip: true });
  if (!String(file).trim()) {
    throw new Error(`External plugin README has no Markdown body: ${current}`);
  }
  return segments.join("/");
}
