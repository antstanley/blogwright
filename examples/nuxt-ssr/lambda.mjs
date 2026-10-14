// Entry shim for Lambda Web Functions. Lambda passes the listen address in
// AWS_LAMBDA_HTTP_ENDPOINT; Nitro's node-server reads NITRO_HOST and NITRO_PORT.
const endpoint = process.env.AWS_LAMBDA_HTTP_ENDPOINT;
const colon = endpoint.lastIndexOf(':');
process.env.NITRO_HOST = endpoint.slice(0, colon);
process.env.NITRO_PORT = endpoint.slice(colon + 1);
await import('./index.mjs');
