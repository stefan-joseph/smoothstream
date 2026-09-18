import type { Root as HastRoot } from "hast";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import {
  prepareFootnotes,
  provisionalFootnoteDefinitions,
} from "./footnotes";

/**
 * GitHub's sanitizer schema plus Smoothstream's URL policy. Relative
 * destinations and fragments stay allowed. Links may use http, https, mailto,
 * or tel; images may use http or https. javascript:, vbscript:, data:, irc:,
 * and xmpp: are dropped. Spreading defaultSchema keeps GFM attributes intact;
 * replacing only `protocols.href` / `protocols.src` avoids a shallow merge
 * that would wipe cite and longDesc.
 */
const schema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto", "tel"],
    src: ["http", "https"],
  },
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize, schema);

export interface ParseMarkdownOptions {
  /** Whether later append-only input may supply a footnote definition. */
  readonly inputOpen?: boolean;
  /** Stable namespace for generated footnote fragment targets. */
  readonly footnoteIdPrefix?: string;
}

/** Parse Markdown into framework-neutral semantic HTML syntax. */
export const parseMarkdown = (
  source: string,
  options: ParseMarkdownOptions = {},
): HastRoot => {
  const original = processor.parse(source);
  const provisional = options.inputOpen
    ? provisionalFootnoteDefinitions(original, source)
    : [];
  const markdown = provisional.length > 0
    ? processor.parse(`${source}\n\n${provisional.map((label) =>
      `[^${label}]:`
    ).join("\n\n")}`)
    : original;
  const tree = processor.runSync(markdown) as HastRoot;
  return prepareFootnotes(
    tree,
    markdown,
    original,
    source,
    options.inputOpen ?? false,
    options.footnoteIdPrefix ?? "",
  );
};
