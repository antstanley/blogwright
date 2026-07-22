---
title: Installation
description: Install blogwright as a dev dependency and point it at your AWS credentials.
sidebar:
  order: 2
---

blogwright ships as a single dev dependency with no infrastructure tooling to set up — no CloudFormation, Terraform, or CDK. You install it as a dev dependency in the repo of the site you want to deploy, and it talks to AWS directly by SigV4-signing raw HTTP requests.

## Prerequisites

- **Node.js ≥ 22.** The package declares `"engines": { "node": ">=22" }`.
- **pnpm.** Sites are built inside the builder MicroVM with `pnpm install && pnpm build`, so your site must build via `pnpm build`.
- **An AWS account** with credentials available in the ambient provider chain — see below.

## Install

Add blogwright to the site repo as a dev dependency:

```sh
pnpm add -D blogwright
```

The package installs two bins pointing at the same CLI: `blogwright` and its short alias `bw`. Run either through `pnpm exec`:

```sh
pnpm exec blogwright --help
pnpm exec bw --help
```

Commands that target an environment accept it as a positional argument or via `--env`; when you pass neither, the environment defaults to `production`. (`init` takes no environment, and the `preview` subcommands always run against the shared `preview` environment.)

## AWS credentials

The CLI signs its own requests, so there is no blogwright-specific credential setup. Credentials are resolved through the standard Node provider chain — environment variables, shared config/credentials files (named profiles), SSO, and container or instance metadata all work. If `aws sts get-caller-identity` succeeds in your shell, blogwright resolves the same credentials.

:::note
For CI, you do not need long-lived keys at all: `bootstrap` can provision a GitHub OIDC deploy role. See [CI deploys with GitHub OIDC](/guides/ci-github-oidc/).
:::

## Local testing with the floci emulator

Every command accepts `--endpoint <url>`, which overrides the AWS endpoint for all requests — for example `--endpoint http://localhost:4566` to target the floci emulator. When the override is active and no real credentials resolve, the CLI falls back to a dummy `test`/`test` credential pair so signing still succeeds — the emulator does not validate signatures.

## Next steps

With the CLI installed and credentials in place, follow the [quickstart](/getting-started/quickstart/) to go from an empty AWS account to a live site, or browse the full [CLI reference](/reference/cli/).
