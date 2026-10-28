import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_MANIFEST_VERSION,
  artifactBuildManifestKey,
  artifactBuildManifestPrefix,
  artifactManifestKey,
  compareArtifact,
  computeReleaseHash,
  createArtifactManifest,
  isExactMatch,
  parseArtifactManifest,
  releaseIdentity,
  serializeArtifactManifest,
  sha256Hex,
  type ArtifactFile,
  type ObservedFile,
} from './artifact-manifest.js';

function file(path: string, content: string): ArtifactFile {
  return { path, bytes: new TextEncoder().encode(content).byteLength, sha256: sha256Hex(content) };
}

const FILES = [file('posts/index.html', '<p>posts</p>'), file('index.html', '<p>home</p>')];

describe('sha256Hex', () => {
  it('is the lowercase hex digest', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('computeReleaseHash', () => {
  it('is the SHA-256 of the sorted sha256sum listing (a pinned vector)', () => {
    const listing =
      `${sha256Hex('<p>home</p>')}  index.html\n` +
      `${sha256Hex('<p>posts</p>')}  posts/index.html\n`;
    expect(computeReleaseHash(FILES)).toBe(sha256Hex(listing));
  });

  it('does not depend on the order files arrive in', () => {
    expect(computeReleaseHash([...FILES].reverse())).toBe(computeReleaseHash(FILES));
  });

  it('changes when any byte of any file changes', () => {
    const edited = [file('posts/index.html', '<p>posts!</p>'), file('index.html', '<p>home</p>')];
    expect(computeReleaseHash(edited)).not.toBe(computeReleaseHash(FILES));
  });

  it('sorts by UTF-8 byte order, as LC_ALL=C sort does', () => {
    // U+FF5E (BMP, 0xEF 0xBD 0x9E) sorts before U+1F600 (0xF0 ...) in bytes,
    // but after it in UTF-16 code units (0xFF5E > 0xD83D).
    const astral = file('\u{1F600}.txt', 'a');
    const bmp = file('～.txt', 'b');
    const listing = `${bmp.sha256}  ${bmp.path}\n${astral.sha256}  ${astral.path}\n`;
    expect(computeReleaseHash([astral, bmp])).toBe(sha256Hex(listing));
  });
});

describe('releaseIdentity', () => {
  it('joins the site version, revision and release hash prefix', () => {
    expect(releaseIdentity('abc123', 'f'.repeat(64), '1.4.0')).toBe('1.4.0+abc123.ffffffffffff');
  });

  it('omits the version when the site declares none', () => {
    expect(releaseIdentity('abc123', 'f'.repeat(64))).toBe('abc123.ffffffffffff');
  });

  it('extends build metadata the version already carries, keeping a single +', () => {
    expect(releaseIdentity('abc123', 'f'.repeat(64), '1.4.0+exp.sha.5114f85')).toBe(
      '1.4.0+exp.sha.5114f85.abc123.ffffffffffff',
    );
  });
});

describe('artifact manifest keys', () => {
  it('keeps the original record beside a prefix holding one manifest per build', () => {
    expect(artifactManifestKey('abc123')).toBe('build/artifacts/abc123.json');
    expect(artifactBuildManifestPrefix('abc123')).toBe('build/artifacts/abc123/');
    expect(artifactBuildManifestKey('abc123', '20261028T182312Z-1a2b3c4d')).toBe(
      'build/artifacts/abc123/20261028T182312Z-1a2b3c4d.json',
    );
  });
});

describe('createArtifactManifest', () => {
  it('sorts files and derives the aggregate fields', () => {
    const manifest = createArtifactManifest({ hash: 'abc123', siteVersion: '2.0.0', files: FILES });
    expect(manifest.manifestVersion).toBe(ARTIFACT_MANIFEST_VERSION);
    expect(manifest.files.map((f) => f.path)).toEqual(['index.html', 'posts/index.html']);
    expect(manifest.fileCount).toBe(2);
    expect(manifest.totalBytes).toBe(FILES[0]!.bytes + FILES[1]!.bytes);
    expect(manifest.releaseHash).toBe(computeReleaseHash(FILES));
    expect(manifest.release).toBe(`2.0.0+abc123.${manifest.releaseHash.slice(0, 12)}`);
  });

  it('records an empty build as zero files', () => {
    const manifest = createArtifactManifest({ hash: 'abc123', files: [] });
    expect(manifest).toMatchObject({ fileCount: 0, totalBytes: 0, files: [] });
    expect(manifest.siteVersion).toBeUndefined();
  });

  it('rejects a duplicated path', () => {
    expect(() =>
      createArtifactManifest({ hash: 'h', files: [FILES[0]!, { ...FILES[0]! }] }),
    ).toThrow(/listed twice/);
  });

  it('rejects an absolute or escaping path', () => {
    expect(() => createArtifactManifest({ hash: 'h', files: [file('/index.html', 'x')] })).toThrow(
      /relative to the site root/,
    );
    expect(() => createArtifactManifest({ hash: 'h', files: [file('a/../b', 'x')] })).toThrow(
      /relative to the site root/,
    );
  });

  it('rejects an uppercase or short sha256', () => {
    const upper = { ...FILES[0]!, sha256: FILES[0]!.sha256.toUpperCase() };
    expect(() => createArtifactManifest({ hash: 'h', files: [upper] })).toThrow(/lowercase hex/);
    const short = { ...FILES[0]!, sha256: 'abc' };
    expect(() => createArtifactManifest({ hash: 'h', files: [short] })).toThrow(/lowercase hex/);
  });

  it('rejects a negative or fractional byte count', () => {
    expect(() =>
      createArtifactManifest({ hash: 'h', files: [{ ...FILES[0]!, bytes: -1 }] }),
    ).toThrow(/invalid byte count/);
    expect(() =>
      createArtifactManifest({ hash: 'h', files: [{ ...FILES[0]!, bytes: 1.5 }] }),
    ).toThrow(/invalid byte count/);
  });
});

describe('artifactManifestKey', () => {
  it('sits beside the deployment manifests', () => {
    expect(artifactManifestKey('abc123')).toBe('build/artifacts/abc123.json');
  });
});

describe('parseArtifactManifest', () => {
  const manifest = createArtifactManifest({ hash: 'abc123', siteVersion: '1.0.0', files: FILES });
  const text = serializeArtifactManifest(manifest);

  it('round-trips a serialized manifest', () => {
    expect(parseArtifactManifest(text, 'm.json')).toEqual(manifest);
  });

  it('refuses invalid JSON, naming the source', () => {
    expect(() => parseArtifactManifest('{', 'm.json')).toThrow(/m\.json is not valid JSON/);
  });

  it('refuses a version it does not read', () => {
    const future = JSON.stringify({ ...manifest, manifestVersion: 2 });
    expect(() => parseArtifactManifest(future, 'm.json')).toThrow(/manifestVersion 2.*upgrade/);
  });

  it('refuses a manifest whose recorded release hash disagrees with its files', () => {
    const edited = JSON.stringify({ ...manifest, releaseHash: '0'.repeat(64) });
    expect(() => parseArtifactManifest(edited, 'm.json')).toThrow(
      /releaseHash.*corrupt or was edited/,
    );
  });

  it('refuses a manifest whose file list was edited', () => {
    const files = manifest.files.map((f, i) => (i === 0 ? { ...f, bytes: f.bytes + 1 } : f));
    const edited = JSON.stringify({ ...manifest, files });
    expect(() => parseArtifactManifest(edited, 'm.json')).toThrow(/totalBytes/);
  });

  it('refuses a manifest with no file list or hash', () => {
    const noFiles = JSON.stringify({ ...manifest, files: undefined });
    expect(() => parseArtifactManifest(noFiles, 'm.json')).toThrow(/no files\[\] list/);
    const noHash = JSON.stringify({ ...manifest, hash: '' });
    expect(() => parseArtifactManifest(noHash, 'm.json')).toThrow(/no revision hash/);
  });
});

describe('compareArtifact', () => {
  const manifest = createArtifactManifest({ hash: 'abc123', files: FILES });
  const exact = () =>
    new Map<string, ObservedFile>(
      manifest.files.map((f) => [f.path, { bytes: f.bytes, sha256: f.sha256 }]),
    );

  it('matches objects identical to the manifest', () => {
    const comparison = compareArtifact(manifest, exact());
    expect(comparison).toEqual({ matched: 2, missing: [], changed: [], unexpected: [] });
    expect(isExactMatch(comparison)).toBe(true);
  });

  it('reports a missing file', () => {
    const observed = exact();
    observed.delete('index.html');
    const comparison = compareArtifact(manifest, observed);
    expect(comparison.missing).toEqual(['index.html']);
    expect(isExactMatch(comparison)).toBe(false);
  });

  it('reports a file whose content differs even when its size matches', () => {
    const observed = exact();
    const home = manifest.files[0]!;
    observed.set(home.path, { bytes: home.bytes, sha256: sha256Hex('<p>HOME</p>') });
    const comparison = compareArtifact(manifest, observed);
    expect(comparison.changed).toEqual([
      {
        path: home.path,
        expected: { bytes: home.bytes, sha256: home.sha256 },
        actual: { bytes: home.bytes, sha256: sha256Hex('<p>HOME</p>') },
      },
    ]);
    expect(comparison.matched).toBe(1);
  });

  it('reports a size difference without needing the hash', () => {
    const observed = exact();
    observed.set('index.html', { bytes: 1 });
    expect(compareArtifact(manifest, observed).changed.map((c) => c.path)).toEqual(['index.html']);
  });

  it('reports objects the manifest does not list, sorted', () => {
    const observed = exact();
    observed.set('z.txt', { bytes: 1 });
    observed.set('old/index.html', { bytes: 1 });
    const comparison = compareArtifact(manifest, observed);
    expect(comparison.unexpected).toEqual(['old/index.html', 'z.txt']);
    expect(isExactMatch(comparison)).toBe(false);
  });
});
