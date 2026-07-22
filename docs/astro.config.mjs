import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://blogwright.iamstan.dev',
  integrations: [
    starlight({
      title: 'blogwright',
      logo: { src: './src/assets/logo.svg', alt: '' },
      customCss: ['./src/styles/custom.css'],
      description:
        'Full operations for a blog site on AWS: S3 + CloudFront hosting with builds in a Lambda MicroVM, PR previews, GitHub-OIDC CI deploys, and standard.site publishing.',
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
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
      ],
    }),
  ],
});
