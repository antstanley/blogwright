/** Resource tags applied to everything blogwright creates. */
export type ResourceTags = Record<string, string>;

/** Encode tags for S3's x-amz-tagging header / object tagging query strings. */
export function encodeTagQuery(tags: ResourceTags): string {
  return Object.entries(tags)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}
