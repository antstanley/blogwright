/**
 * Minimal XML helpers for the handful of AWS REST-XML / query responses this CLI
 * reads (S3, STS, IAM, CloudFront). Not a general XML parser — it extracts tag
 * contents by name, which is sufficient for the flat response shapes we consume.
 */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m);
}

export function encodeEntities(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

/** Return the inner content of the first `<name>…</name>` element, or undefined. */
export function firstTag(xml: string, name: string): string | undefined {
  const re = new RegExp(`<${escapeName(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeName(name)}>`);
  const m = re.exec(xml);
  return m?.[1];
}

/** Return the decoded text value of the first `<name>` element. */
export function textTag(xml: string, name: string): string | undefined {
  const inner = firstTag(xml, name);
  return inner === undefined ? undefined : decodeEntities(inner.trim());
}

/** Return the inner content of every `<name>…</name>` element. */
export function allTags(xml: string, name: string): string[] {
  const re = new RegExp(
    `<${escapeName(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeName(name)}>`,
    'g',
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
