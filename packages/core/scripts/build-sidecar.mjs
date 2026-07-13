#!/usr/bin/env node
// Builds the Node sidecar (src/sidecar-bin.ts) into a standalone platform
// binary and places it where Tauri's `bundle.externalBin` expects it:
// apps/desktop/src-tauri/binaries/core-sidecar-<rust-target-triple>[.exe].
//
// Two steps, matching Tauri's own Node-sidecar guide
// (https://v2.tauri.app/learn/sidecar-nodejs), with two adjustments made
// while building this the first time (2026-07-12):
//   1. Bundle first (esbuild, CJS) -- pkg doesn't run TS/ESM source
//      directly, and packages/core/src/sidecar-bin.ts imports the rest of
//      this package plus drizzle-orm/pg, which need to be inlined into one
//      file for pkg to package.
//   2. Use @yao-pkg/pkg, not the original `pkg` package -- the original is
//      unmaintained and has no prebuilt Node binaries past ~Node 18; the
//      fork tracks current Node releases (this project requires Node 24).
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const coreRoot = join(here, "..");
const bundlePath = join(coreRoot, ".sidecar-build", "sidecar-bundle.cjs");
const desktopSrcTauri = join(coreRoot, "..", "..", "apps", "desktop", "src-tauri");
const binariesDir = join(desktopSrcTauri, "binaries");
const migrationsSrc = join(coreRoot, "src", "db", "migrations");
const migrationsDest = join(desktopSrcTauri, "resources", "db-migrations");

// On Windows, npx resolves to npx.cmd, which execFileSync can't launch
// without a shell (ENOENT) -- confirmed by a real CI failure, 2026-07-13.
// Scoped to win32 only so macOS/Linux (where npx is a plain executable)
// don't pick up Node's shell:true argument-escaping deprecation warning
// (DEP0190) for no reason.
const useShell = process.platform === "win32";

function pkgTargetFor(platform, arch) {
  const platformMap = { darwin: "macos", linux: "linux", win32: "win" };
  const archMap = { arm64: "arm64", x64: "x64" };
  const pkgPlatform = platformMap[platform];
  const pkgArch = archMap[arch];
  if (!pkgPlatform || !pkgArch) {
    throw new Error(`Unsupported platform/arch for the sidecar build: ${platform}/${arch}`);
  }
  return `node22-${pkgPlatform}-${pkgArch}`;
}

mkdirSync(dirname(bundlePath), { recursive: true });
mkdirSync(binariesDir, { recursive: true });

console.log("[sidecar] bundling src/sidecar-bin.ts -> CJS ...");
execFileSync(
  "npx",
  ["esbuild", "src/sidecar-bin.ts", "--bundle", "--platform=node", "--target=node20", "--format=cjs", `--outfile=${bundlePath}`],
  { cwd: coreRoot, stdio: "inherit", shell: useShell },
);

const targetTriple = execSync("rustc --print host-tuple").toString().trim();
const extension = process.platform === "win32" ? ".exe" : "";
const finalName = `core-sidecar-${targetTriple}${extension}`;
const finalPath = join(binariesDir, finalName);

console.log(`[sidecar] compiling standalone binary for ${targetTriple} via @yao-pkg/pkg ...`);
const pkgTarget = pkgTargetFor(process.platform, process.arch);
if (existsSync(finalPath)) rmSync(finalPath);
execFileSync("npx", ["@yao-pkg/pkg", bundlePath, "--target", pkgTarget, "--output", finalPath], {
  cwd: coreRoot,
  stdio: "inherit",
  shell: useShell,
});

console.log(`[sidecar] built ${finalPath}`);

// The pkg-compiled sidecar binary can't resolve migrations/ as a real
// on-disk sibling of itself the way the CLI or a test can (see
// db/migrate.ts's comment) -- Tauri instead ships this copy as a bundled
// resource (tauri.conf.json's bundle.resources), and the Rust shell passes
// its resolved path to the sidecar via MIGRATIONS_DIR (commands.rs). Runs
// on every build:sidecar invocation, dev included, since Tauri materializes
// bundle.resources for `tauri dev` too, not only `tauri build`.
console.log(`[sidecar] copying migrations -> ${migrationsDest} ...`);
rmSync(migrationsDest, { recursive: true, force: true });
cpSync(migrationsSrc, migrationsDest, { recursive: true });
