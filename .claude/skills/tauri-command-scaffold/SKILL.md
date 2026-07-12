---
name: tauri-command-scaffold
description: Scaffold a new Tauri IPC command end-to-end -- the Rust #[tauri::command] handler, its registration, the TypeScript invoke() wrapper, and matching types on both sides. Use whenever adding a new Rust<->TS entry point in the Tauri app, so the two sides of the IPC boundary never drift out of sync.
argument-hint: <command-name> -- <what it does>
---

# Tauri command scaffold

Tauri IPC has two independent sources of truth -- the Rust handler and the TS
`invoke()` call site -- and nothing enforces that their argument/return shapes
agree. Drift between them fails at runtime, not compile time. This skill
generates both sides together from one description so they start in sync.

## Precondition

Check that `apps/desktop/src-tauri/Cargo.toml` exists. If it doesn't, the
Tauri app hasn't been scaffolded yet (`pnpm create tauri-app` or equivalent)
-- stop and say so instead of inventing a layout.

## Steps

1. **Pick the identifier.** Use one `snake_case` name for both sides (e.g.
   `list_transcripts`). Tauri does not rename `#[tauri::command]` fns for JS
   by default -- the JS `invoke("name", ...)` string must match the Rust fn
   name exactly unless `rename_all` is set on the handler. Reuse the same
   identifier everywhere to remove the one place drift usually creeps in.

2. **Find the existing layout first.** Look for how prior commands are
   organized (`apps/desktop/src-tauri/src/commands/*.rs` vs a single
   `commands.rs`; a frontend `apps/desktop/src/lib/tauri/*.ts` vs inline
   `invoke()` calls) and follow the established pattern rather than
   introducing a new one. If this is the first command in the project, put
   the Rust handler in `apps/desktop/src-tauri/src/commands.rs` and the TS
   wrapper in `apps/desktop/src/lib/tauri.ts`.

3. **Write the Rust handler.**
   - `#[tauri::command]` fn, arguments and return type both `serde`
     (de)serializable.
   - Errors: return `Result<T, E>` where `E: serde::Serialize` (a plain
     `String` is fine to start; a typed error enum is better once there is
     more than one failure mode) -- Tauri v2 requires the error type to be
     serializable, it will not accept `anyhow::Error` etc. directly.
   - Never accept a secret (`GROQ_API_KEY`, `DATABASE_URI`) as an argument
     *from* the frontend, and never return one in the success or error
     payload. Secrets live only in the Rust process / Node sidecar (env var)
     and stay there -- see `tauri-capability-reviewer` for why.

   ```rust
   #[tauri::command]
   fn list_transcripts(dir: String) -> Result<Vec<TranscriptMeta>, String> {
       // ...
   }
   ```

4. **Register it.** Add the fn to the `tauri::generate_handler![...]` list in
   `apps/desktop/src-tauri/src/lib.rs` (Tauri v2 convention; `main.rs` on v1).
   A command that exists but isn't registered here fails silently as
   "command not found" at call time -- easy to forget, so double check this
   step.

5. **Write the TS wrapper**, colocated with existing wrappers:

   ```ts
   import { invoke } from "@tauri-apps/api/core";

   export function listTranscripts(dir: string): Promise<TranscriptMeta[]> {
     return invoke("list_transcripts", { dir });
   }
   ```

   - `camelCase` on the TS export is fine (that's just a JS function name);
     the *string* passed to `invoke()` must stay the exact Rust fn name.
   - Mirror the Rust struct/enum shapes as TS `interface`/`type` in the same
     file or an adjacent `types.ts`, by hand -- there is no code generation
     wired up here, so keep the two definitions next to each other to make
     future drift easy to spot in review.

6. **Capabilities.** If the command touches `fs`, `shell`, `http`, `dialog`,
   etc., add the narrowest possible permission to
   `apps/desktop/src-tauri/capabilities/*.json` (scoped to the specific
   path/window/origin needed, not the `*-all`/`default` bundle). Flag the
   change for `tauri-capability-reviewer` -- permission scope is a security
   boundary, not a lint nit.

7. **Tests.** Add a `#[cfg(test)]` unit test for the Rust handler's logic
   (not the IPC plumbing itself). If the frontend has a test for the call
   site, mock `invoke` rather than spawning a real Tauri runtime.

## Output

Report back: the Rust file(s) touched, the TS file(s) touched, whether
`generate_handler!` was updated, and whether a new capability grant was added
(so the human/reviewer knows to look at it).
