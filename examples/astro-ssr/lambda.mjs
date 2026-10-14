// Entry shim for Lambda Web Functions. Lambda passes the listen address in
// AWS_LAMBDA_HTTP_ENDPOINT; Astro's standalone server reads HOST and PORT.
const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT;
const colon = endpoint.lastIndexOf(':');
process.env.HOST = endpoint.slice(0, colon);
process.env.PORT = endpoint.slice(colon + 1);
await import('./entry.mjs');
