// The actual pkg/esbuild bundle entry point (see package.json's
// build:sidecar script). Kept separate from sidecar.ts so that file stays a
// pure, side-effect-free module -- testable by importing its exports
// without also triggering process execution (and so this file needs no
// "am I the main module" detection, which doesn't survive bundling/renaming
// cleanly across the tsx-ESM-dev / esbuild-CJS-bundle-for-pkg split).
import { main } from "./sidecar.js";

main(process.argv).catch((err: unknown) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: String(err) })}\n`);
  process.exitCode = 1;
});
