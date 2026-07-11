# blogwright

Deploy a static Astro site to AWS: S3 + CloudFront with builds in a Lambda MicroVM,
GitHub-OIDC CI deploys, PR previews, and optional standard.site (AT Protocol) publishing.

```sh
pnpm add -D blogwright
pnpm exec blogwright bootstrap --domain example.com
pnpm exec blogwright deploy
```

Full documentation: https://github.com/antstanley/blogwright
