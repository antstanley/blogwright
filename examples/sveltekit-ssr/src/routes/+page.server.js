/** Rendered on every request: the timestamp changes on each reload. */
export function load({ setHeaders }) {
  setHeaders({ 'cache-control': 'no-store' });
  return { renderedAt: new Date().toISOString() };
}
