/** @type {import('next').NextConfig} */
export default {
  // A self-contained server in .next/standalone, with the node_modules files it
  // traced copied in.
  output: 'standalone',
  // Trace from this directory, so server.js lands at .next/standalone/server.js
  // even when the project sits inside a larger repository.
  outputFileTracingRoot: import.meta.dirname,
};
