import { buildDetailToc } from "./detail-toc";
import { sanitizeHtml } from "./sanitize-html";

export function finalizePluginReadme(
  markdownHtml: string,
  urls?: { linkBaseUrl: string; imageBaseUrl: string },
  warn: (error: unknown) => void = console.warn,
): string {
  try {
    const { html } = buildDetailToc(markdownHtml);
    return sanitizeHtml(html, urls);
  } catch (error) {
    warn(error);
    return "";
  }
}
