/*
 * Textual splice of a plugin's config block into an existing JSONC document.
 * Config files carry meaningful comments written by the wizard (`init.ts:42`
 * `renderConfig`), so the document is never round-tripped through a parse
 * and a re-stringify here - doing that would discard every one of them.
 * Instead this module scans the raw text with the same string- and
 * comment-aware discipline as `stripJsonComments`
 * (`packages/core/src/config.ts:153`) to find exactly where a new top-level
 * key belongs, and splices the rendered block in around it, leaving every
 * other byte of the file untouched.
 */

/** The file a block is spliced into. */
export interface ConfigSource {
  readonly path: string;
  readonly text: string;
}

/** A rendered block ready to splice in, and the key it is filed under. */
export interface ConfigBlock {
  readonly key: string;
  readonly rendered: string;
}

/** One entry of a rendered block, matching `renderConfig`'s own entry shape. */
export interface ConfigBlockEntry {
  readonly prop: string;
  readonly comment?: string | undefined;
}

/**
 * Render `entries` as a `"key": { ... }` block in `renderConfig`'s style
 * (`init.ts:42-69`): two-space indent per nesting level, an optional
 * `// comment` suffix per entry, and a comma between entries but never after
 * the last one. The result is meant to be handed to `spliceConfigBlock` as
 * `block.rendered`, already indented as it will appear once inserted as a
 * property of the top-level object.
 */
export function renderConfigBlock(key: string, entries: readonly ConfigBlockEntry[]): string {
  if (entries.length === 0) return `  "${key}": {}`;
  const body = entries.map((entry, i) => {
    const comma = i < entries.length - 1 ? ',' : '';
    const comment = entry.comment ? ` // ${entry.comment}` : '';
    return `    ${entry.prop}${comma}${comment}`;
  });
  return [`  "${key}": {`, ...body, '  }'].join('\n');
}

/** Decode a JSON string literal's escapes by hand, without parsing it as JSON. */
function decodeStringLiteral(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const esc = raw[++i];
    switch (esc) {
      case 'n':
        out += '\n';
        break;
      case 't':
        out += '\t';
        break;
      case 'r':
        out += '\r';
        break;
      case 'b':
        out += '\b';
        break;
      case 'f':
        out += '\f';
        break;
      case 'u':
        out += String.fromCharCode(Number.parseInt(raw.slice(i + 1, i + 5), 16));
        i += 4;
        break;
      default:
        out += esc ?? '';
    }
  }
  return out;
}

/** What the position scan found at the top level, once it has finished. */
interface TopLevelScan {
  readonly openIndex: number;
  readonly closeIndex: number;
  readonly lastSignificantIndex: number;
  readonly topLevelKeys: ReadonlySet<string>;
}

function shapeError(path: string, found: string): Error {
  return new Error(
    `${path}: expected a single top-level JSON object, found ${found} - insert the block by hand instead`,
  );
}

type Container = 'array' | 'object';

/**
 * Scan `source.text` once, string- and comment-aware like `stripJsonComments`,
 * to find the single top-level object's opening and closing brace, the last
 * significant (non-whitespace, non-comment) character before that closing
 * brace, and the set of keys already declared directly on that object. Raises
 * rather than guessing when the document is not shaped that way.
 *
 * Key-position tracking (`expectKey`) is deliberately generic: opening any
 * object, or a comma inside one, expects a key at *that* depth, not only at
 * the top - the same test that decides whether a value is a key at all also
 * runs for every nested object. `depth === 1` is the only thing that then
 * scopes a found key into `topLevelKeys`, so a `"pds"` nested three objects
 * down is read as a key (of its own object) and correctly not recorded as
 * one of the document's own.
 */
function scanTopLevelObject(source: ConfigSource): TopLevelScan {
  const { path, text } = source;
  let inString = false;
  let inLine = false;
  let inBlock = false;
  let depth = 0;
  let openIndex = -1;
  let closeIndex = -1;
  let lastSignificantIndex = -1;
  let stringStart = -1;
  let expectKey = false;
  const containers: Container[] = [];
  const topLevelKeys = new Set<string>();

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];

    if (inLine) {
      if (ch === '\n') inLine = false;
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') {
        inString = false;
        lastSignificantIndex = i;
        if (expectKey) {
          if (depth === 1) topLevelKeys.add(decodeStringLiteral(text.slice(stringStart + 1, i)));
          expectKey = false;
        }
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      inLine = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i++;
      continue;
    }
    if (/\s/.test(ch)) continue;

    // `ch` is now a significant character outside any string or comment.
    if (openIndex === -1) {
      if (ch !== '{') throw shapeError(path, ch === '[' ? 'an array' : 'a bare value');
      openIndex = i;
      lastSignificantIndex = i;
      depth = 1;
      containers.push('object');
      expectKey = true;
      continue;
    }
    if (closeIndex !== -1) throw shapeError(path, 'a second top-level value');

    if (ch === '"') {
      inString = true;
      stringStart = i;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth++;
      lastSignificantIndex = i;
      containers.push(ch === '{' ? 'object' : 'array');
      expectKey = ch === '{';
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth--;
      containers.pop();
      if (depth === 0) {
        closeIndex = i;
      } else {
        lastSignificantIndex = i;
      }
      continue;
    }
    if (ch === ',') {
      lastSignificantIndex = i;
      expectKey = containers[containers.length - 1] === 'object';
      continue;
    }
    lastSignificantIndex = i;
  }

  if (openIndex === -1) throw shapeError(path, 'an empty document');
  if (closeIndex === -1) {
    throw shapeError(
      path,
      inString ? 'an unterminated string inside the object' : 'an unterminated object',
    );
  }
  return { openIndex, closeIndex, lastSignificantIndex, topLevelKeys };
}

/**
 * Starting at `from` (just past the last entry's value or its trailing
 * comma), skip past a comment that trails on the *same line* - `"x" //
 * note` or `"x" /* note *\/` - so that comment stays attached to the entry
 * it documents instead of being displaced by whatever gets spliced in
 * after it. Stops at the first line break, at `limit` (the object's closing
 * brace), or at the first character that is neither trailing whitespace nor
 * the start of such a comment.
 */
function skipTrailingComment(text: string, from: number, limit: number): number {
  let i = from;
  for (;;) {
    while (i < limit && (text[i] === ' ' || text[i] === '\t')) i++;
    if (i >= limit || text[i] === '\n' || text[i] === '\r') return i;
    if (text[i] === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < limit && text[i] !== '\n' && text[i] !== '\r') i++;
      return i;
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 || end + 2 > limit ? limit : end + 2;
      continue;
    }
    return i;
  }
}

/** True when `text` has a line break (LF or CRLF) starting at `at`. */
function startsWithNewline(text: string, at: number): boolean {
  return text[at] === '\n' || (text[at] === '\r' && text[at + 1] === '\n');
}

/**
 * Splice `block.rendered` into `source.text` as a new property of the
 * document's single top-level object, immediately before its closing brace.
 * The document is scanned, never reparsed: every byte outside the inserted
 * region - comments, indentation, trailing commas - comes back unchanged.
 *
 * Refuses rather than guessing when `block.key` is already present on the
 * object, or when the document is not shaped as a single top-level object.
 */
export function spliceConfigBlock(source: ConfigSource, block: ConfigBlock): string {
  const { text, path } = source;
  const scan = scanTopLevelObject(source);
  if (scan.topLevelKeys.has(block.key)) {
    throw new Error(
      `${path} already declares a "${block.key}" key - edit the file directly instead of ` +
        'writing a new block for it',
    );
  }

  // The comma belongs immediately after the last entry's own value, but the
  // new block belongs after that entry's trailing comment (if any) - an
  // operator's `// comment` on the last line documents that entry, not
  // whatever gets spliced in next, and must not be pushed onto its own line
  // in between.
  const commaIndex = scan.lastSignificantIndex + 1;
  const hasEntries = scan.lastSignificantIndex > scan.openIndex;
  const hasTrailingComma = hasEntries && text[scan.lastSignificantIndex] === ',';
  const commaPrefix = hasEntries && !hasTrailingComma ? ',' : '';
  const blockIndex = skipTrailingComment(text, commaIndex, scan.closeIndex);

  // Match the document's own line-ending convention rather than always
  // injecting a bare `\n`, so a CRLF file does not end up with a mixed-ending
  // splice or a spurious blank line before the closing brace.
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const rendered = newline === '\n' ? block.rendered : block.rendered.replaceAll('\n', newline);
  const needsTrailingNewline = !startsWithNewline(text, blockIndex);
  const insertion = `${newline}${rendered}${needsTrailingNewline ? newline : ''}`;

  return (
    text.slice(0, commaIndex) +
    commaPrefix +
    text.slice(commaIndex, blockIndex) +
    insertion +
    text.slice(blockIndex)
  );
}
