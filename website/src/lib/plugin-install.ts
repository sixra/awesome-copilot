export function buildVSCodePluginInstallUrl(
  pluginName: string,
  source = "github/awesome-copilot",
): string {
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(source)) {
    throw new Error(`Invalid plugin marketplace repository: ${source}`);
  }
  if (!pluginName.trim() || /[@\u0000-\u001f\u007f]/.test(pluginName)) {
    throw new Error(`Invalid marketplace plugin name: ${pluginName}`);
  }

  const query = new URLSearchParams({ source, plugin: pluginName });
  return `vscode://chat-plugin/install?${query}`;
}
