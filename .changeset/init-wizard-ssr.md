---
"blogwright": minor
---

`blogwright init` asks whether the app is server-rendered and, if so, which framework: `astro`, `sveltekit`, `nuxt`, `tanstack-start`, `nextjs` or `other`. A known framework gets its recipe's `ssr` block, including the `ssr.shim` variables its server reads, and the next steps link the recipe's build settings; `other` gets the defaults to fill in. When the chosen region has no Lambda Web Functions, the wizard asks for one that does.
