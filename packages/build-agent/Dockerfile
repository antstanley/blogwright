# Builder MicroVM image: a long-running HTTP server that builds the Astro site.
# Node 24 + pnpm (via corepack). The site's own dependencies are installed at build
# time inside the MicroVM using the source zip handed to the /run hook.
FROM node:24-slim

# Enable pnpm and provide git (Astro/content tooling can shell out to it).
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# The image artifact contains a bundled server (no external deps) + a minimal manifest.
COPY package.json ./
COPY server.js ./

ENV NODE_ENV=production
EXPOSE 8080

# Lambda snapshots the running server; the /ready hook confirms readiness.
CMD ["node", "server.js"]
