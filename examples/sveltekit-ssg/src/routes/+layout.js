// Prerender every page at build time.
export const prerender = true;
// Write /about as about/index.html: Blogwright's router resolves /about to
// /about/index.html, never to about.html.
export const trailingSlash = 'always';
