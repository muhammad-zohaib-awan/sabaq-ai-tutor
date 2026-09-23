/**
 * Strip anything executable out of model-generated SVG.
 *
 * Defence in depth: the frontend now renders it as an <img> (where SVG scripts
 * never run), but the old path rendered it with dangerouslySetInnerHTML, so whatever the model
 * emits runs in the learner's browser on our origin — next to their session
 * token. And the model's input includes learner-supplied source material, so a
 * poisoned document could ask it for an SVG carrying a script. That is a
 * straight path from "upload a PDF" to "steal an admin session", and it is
 * closed here rather than trusted away.
 *
 * Allow-list by shape: keep drawing, drop everything else.
 */
const BLOCKED_TAGS =
  /<\s*\/?\s*(script|foreignObject|iframe|object|embed|link|style|animate\w*|set|handler|audio|video|image|use|a|meta|base)\b[^>]*>/gi;
/** Remove the CONTENT of script/style blocks too, not only their tags. */
const BLOCKED_BLOCKS = /<\s*(script|style|foreignObject)\b[\s\S]*?<\s*\/\s*\1\s*>/gi;
const STYLE_URL = /style\s*=\s*("[^"]*(url|expression|javascript)[^"]*"|'[^']*(url|expression|javascript)[^']*')/gi;

/** on* handlers, javascript: urls, and external references. */
const EVENT_ATTR = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL = /(href|xlink:href|src)\s*=\s*("|')?\s*(javascript|data:text\/html|vbscript):[^"'>\s]*/gi;
const EXTERNAL_REF = /(href|xlink:href|src)\s*=\s*("|')?\s*https?:\/\/[^"'>\s]*/gi;

export function sanitizeSvg(input: string): string {
  if (!input) return '';

  const start = input.indexOf('<svg');
  if (start === -1) return '';
  const end = input.lastIndexOf('</svg>');
  if (end === -1) return '';

  let svg = input.slice(start, end + 6);

  svg = svg
    .replace(BLOCKED_BLOCKS, '')
    .replace(BLOCKED_TAGS, '')
    .replace(STYLE_URL, '')
    .replace(EVENT_ATTR, '')
    .replace(JS_URL, '')
    .replace(EXTERNAL_REF, '')
    // Entity-encoded angle brackets are a classic way to smuggle a tag past a
    // regex filter that only looks at literal "<".
    .replace(/&#x?0*(3c|60);/gi, '')
    .replace(/&lt;\s*script/gi, '');

  // A runaway diagram should not be able to hang the browser either.
  return svg.length > 200_000 ? '' : svg;
}
