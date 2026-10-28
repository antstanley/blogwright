/**
 * Registry adapter: reads one exact version's metadata from the npm registry
 * (`GET /<name>/<version>`), which publishes `dist.unpackedSize` and the
 * os/cpu/libc constraints. Only platform variants are looked up, so a run
 * makes a handful of requests.
 */

import type { PublishedVersion, Registry } from '../ports.js';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

/** Upper bound on one metadata request. */
const REQUEST_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
}

/** Build the registry adapter; `registryUrl` defaults to the public npm registry. */
export function createNpmRegistry(registryUrl: string = DEFAULT_REGISTRY): Registry {
  const base = registryUrl.replace(/\/+$/, '');
  return {
    async publishedVersion(name: string, version: string): Promise<PublishedVersion> {
      // A scoped name keeps its @ but escapes its slash: /@scope%2Fname/1.0.0.
      const url = `${base}/${name.replace('/', '%2F')}/${encodeURIComponent(version)}`;
      let response: Response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (err) {
        throw new Error(`fetching ${url} failed: ${(err as Error).message}`, { cause: err });
      }
      if (!response.ok) throw new Error(`fetching ${url} returned HTTP ${response.status}`);

      const metadata: unknown = await response.json();
      if (!isRecord(metadata)) throw new Error(`${url} did not return a JSON object`);
      const dist = metadata['dist'];
      const unpackedSize = isRecord(dist) ? dist['unpackedSize'] : undefined;
      const published: {
        os?: string[];
        cpu?: string[];
        libc?: string[];
        unpackedSize: number | undefined;
      } = {
        unpackedSize: typeof unpackedSize === 'number' ? unpackedSize : undefined,
      };
      const os = stringList(metadata['os']);
      const cpu = stringList(metadata['cpu']);
      const libc = stringList(metadata['libc']);
      if (os !== undefined) published.os = os;
      if (cpu !== undefined) published.cpu = cpu;
      if (libc !== undefined) published.libc = libc;
      return published;
    },
  };
}
