import { spawn } from "node:child_process";

export class ExternalOpenError extends Error {
  constructor(message, code = "invalid_url") {
    super(message);
    this.name = "ExternalOpenError";
    this.code = code;
  }
}

const MAX_URL_LENGTH = 2048;

/** Returns a normalized http(s) URL or throws. Rejects credentials, control characters and other schemes. */
export function validateExternalUrl(value) {
  const text = String(value ?? "");
  if (!text || text.length > MAX_URL_LENGTH) throw new ExternalOpenError("Enter an http(s) URL (max 2048 characters).");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f-\u009f]/.test(text)) throw new ExternalOpenError("The URL contains spaces or control characters.");
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new ExternalOpenError("Enter a valid http(s) URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ExternalOpenError("Only http(s) URLs can be opened in the default browser.");
  }
  if (parsed.username || parsed.password) throw new ExternalOpenError("URLs with embedded credentials are not allowed.");
  if (!parsed.hostname) throw new ExternalOpenError("The URL has no host.");
  return parsed.href;
}

export function launcherCommand(url, platform = process.platform) {
  if (platform === "win32") return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
  if (platform === "darwin") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}

function defaultOpener(url) {
  const { command, args } = launcherCommand(url);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { shell: false, windowsHide: true, detached: true, stdio: "ignore" });
    } catch (error) {
      reject(error);
      return;
    }
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

let opener = defaultOpener;

/** Test seam: replaces the OS launcher. Pass null to restore the default. */
export function setExternalOpener(fn) {
  opener = fn ?? defaultOpener;
}

export async function openInDefaultBrowser(url) {
  const safe = validateExternalUrl(url);
  try {
    await opener(safe);
  } catch (error) {
    throw new ExternalOpenError(`Could not launch the default browser: ${error.message}`, "launch_failed");
  }
  return safe;
}
