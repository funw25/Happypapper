/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 blocks /_next/* dev resources for origins it does not recognise.
  // Without this, opening the reader on http://127.0.0.1:3100 serves the HTML
  // but never hydrates, because the client chunks are refused.
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  // PGlite loads pglite.wasm through `new URL("./pglite.wasm", import.meta.url)`
  // and hands that object to fs.readFile. Turbopack rewrites that expression to
  // `new __turbopack_context__.U(<asset>)`, where U is Turbopack's relativeURL
  // shim, not a Node URL. fs rejects it with ERR_INVALID_ARG_TYPE, PGlite aborts
  // and the production build cannot initialise the database. Keeping the package
  // external leaves import.meta.url and URL intact at runtime.
  //
  // `pg` is external for the same reason: it loads native/optional modules and
  // opens sockets, so a bundled copy is not what should run in production.
  // The S3 client is external for that reason too.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "@aws-sdk/client-s3"],
};

export default nextConfig;
