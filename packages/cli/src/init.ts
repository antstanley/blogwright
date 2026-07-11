/*
 * `blogwright init` — the first-run wizard. Asks the four questions a new site
 * needs, writes a commented config/production.jsonc, and prints the path to a
 * live site. Runs before any context exists (there is no config to load yet),
 * so it takes its ports directly.
 */

import { colors, findRepoRoot, type FileSystem, type Terminal } from 'blogwright-core';

import type { Logger } from './logger.js';

const SITE_NAME_PATTERN = /^[a-z0-9-]+$/;
const GITHUB_REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const MAX_ATTEMPTS = 3;

interface Question {
  prompt: string;
  defaultValue?: string | undefined;
  required?: boolean | undefined;
  validate?: ((answer: string) => string | undefined) | undefined;
}

async function ask(terminal: Terminal, logger: Logger, q: Question): Promise<string | undefined> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const suffix = q.defaultValue ? ` [${q.defaultValue}]` : '';
    const answer = (await terminal.question(`${q.prompt}${suffix}: `)).trim() || q.defaultValue;
    if (!answer) {
      if (!q.required) return undefined;
      logger.warn('a value is required');
      continue;
    }
    const problem = q.validate?.(answer);
    if (problem) {
      logger.warn(problem);
      continue;
    }
    return answer;
  }
  throw new Error(`no valid answer after ${MAX_ATTEMPTS} attempts — giving up`);
}

function renderConfig(opts: {
  region: string;
  siteName: string;
  domain?: string | undefined;
  githubRepo?: string | undefined;
}): string {
  const entries: Array<{ prop: string; comment?: string }> = [
    { prop: `"region": "${opts.region}"` },
    {
      prop: `"siteName": "${opts.siteName}"`,
      comment: 'stable slug in every AWS resource name — never change it',
    },
  ];
  if (opts.domain) entries.push({ prop: `"domain": "${opts.domain}"` });
  if (opts.githubRepo) {
    entries.push({
      prop: `"githubRepo": "${opts.githubRepo}"`,
      comment: 'enables the GitHub OIDC deploy role',
    });
  }
  const body = entries.map((e, i) => {
    const comma = i < entries.length - 1 ? ',' : '';
    return `  ${e.prop}${comma}${e.comment ? ` // ${e.comment}` : ''}`;
  });
  return ['// config/production.jsonc — created by `blogwright init`', '{', ...body, '}', ''].join(
    '\n',
  );
}

/** Run the wizard. Returns a process exit code; never throws for expected refusals. */
export async function initSite(
  fs: FileSystem,
  terminal: Terminal,
  logger: Logger,
  root?: string,
): Promise<number> {
  if (!terminal.isInteractive) {
    logger.error(
      'init is an interactive wizard; in CI or plain mode create config/production.jsonc ' +
        'by hand instead (see README — only "region" and "siteName" are required)',
    );
    return 1;
  }
  const repoRoot = root ?? (await findRepoRoot(fs).catch(() => process.cwd()));
  const configPath = `${repoRoot}/config/production.jsonc`;
  if (await fs.exists(configPath)) {
    logger.error(`${configPath} already exists — edit it directly, or pass --config elsewhere`);
    return 1;
  }

  logger.info(colors.bold('Welcome to blogwright — four questions and you are live.'));
  const siteName = await ask(terminal, logger, {
    prompt: 'site name (lowercase slug, names every AWS resource)',
    required: true,
    validate: (v) =>
      SITE_NAME_PATTERN.test(v) ? undefined : 'must be lowercase letters, digits, or dashes',
  });
  const region = await ask(terminal, logger, {
    prompt: 'AWS region',
    defaultValue: 'us-east-1',
    required: true,
  });
  const domain = await ask(terminal, logger, {
    prompt: 'custom domain (blank to use the CloudFront domain)',
  });
  const githubRepo = await ask(terminal, logger, {
    prompt: 'GitHub repo for CI deploys, owner/repo (blank to skip)',
    validate: (v) => (GITHUB_REPO_PATTERN.test(v) ? undefined : 'expected owner/repo'),
  });

  await fs.writeText(configPath, renderConfig({ region: region!, siteName: siteName!, domain, githubRepo }));
  logger.ok(`wrote ${configPath}`);
  logger.info('');
  logger.info(colors.bold('Next steps:'));
  logger.step(`blogwright bootstrap${domain ? '' : '   # add --domain later if you get one'}`);
  logger.step('blogwright deploy');
  logger.info(colors.dim('   (bootstrap prints ACM validation CNAMEs when a domain is set)'));
  return 0;
}
