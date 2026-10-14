import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

// Start calls this once per request on the server and once in the browser.
export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true });
}
