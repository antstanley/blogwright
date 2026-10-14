import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://blogwright.iamstan.dev',
  redirects: {
    // The standard.site guide moved into the Plugins section.
    '/guides/publishing-standard-site': '/plugins/standard-site/',
    // "Beyond Astro: SPAs & monorepos" split into two guides.
    '/guides/non-astro-sites': '/guides/monorepos/',
  },
  integrations: [
    starlight({
      title: 'blogwright',
      components: {
        MarkdownContent: './src/components/MarkdownContent.astro',
        MobileMenuToggle: './src/components/MobileMenuToggle.astro',
      },
      logo: { src: './src/assets/logo.svg', alt: '' },
      customCss: ['./src/styles/custom.css'],
      description:
        'Deploy static sites, single-page apps and server-rendered apps to AWS with one CLI: S3 + CloudFront hosting, builds in a Lambda MicroVM, Lambda Web Functions for SSR, PR previews, GitHub-OIDC CI deploys, and plugins for analytics and standard.site publishing.',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/antstanley/blogwright' },
      ],
      favicon: '/favicon.svg',
      head: [
        // PNG fallbacks for browsers that ignore SVG favicons (Safari).
        {
          tag: 'link',
          attrs: { rel: 'icon', href: '/favicon.png', type: 'image/png', sizes: '32x32' },
        },
        {
          tag: 'link',
          attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/antstanley/blogwright/edit/main/docs/',
      },
      sidebar: [
        { label: 'Getting started', items: [{ autogenerate: { directory: 'getting-started' } }] },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Examples', items: [{ autogenerate: { directory: 'examples' } }] },
        { label: 'Plugins', items: [{ autogenerate: { directory: 'plugins' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
      ],
    }),
  ],
});
