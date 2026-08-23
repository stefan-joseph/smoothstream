import type { Root as HastRoot } from "hast";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

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

/** Parse Markdown into framework-neutral semantic HTML syntax. */
export const parseMarkdown = (source: string): HastRoot => {
  const mdast = processor.parse(source);
  return processor.runSync(mdast) as HastRoot;
};
