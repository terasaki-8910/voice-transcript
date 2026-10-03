# Stage (auto, after intake) -- Generate the project README(s) from SPEC. NO code.

Read SPEC.md and CLAUDE.md. Write two files documenting how to USE this project,
derived ONLY from the agreed SPEC (do not invent features or commands):

- README.en.md -- in English.
- README.md    -- the primary readme, in the maintainer's human language (see CLAUDE.md /
  the project context; Japanese for this user, otherwise English). Same content as the
  English one, translated.

Each file, adapted to what SPEC.md actually describes:
- A top language-switch badge linking to the other file (keep the shields.io style the
  template already uses).
- Title = project name; a one-line purpose.
- Requirements, setup/install, and usage with the EXACT CLI/API/options from SPEC.
- Output/behavior, and the project's constraints and explicit out-of-scope items.
- If `docs/screenshots/*.png` exist, embed them in the desktop-app section (right after
  its feature bullets, before any Preferences subsection) via plain `<img>` tags at
  `width="49%"` so two sit side by side -- real captured screenshots only, reference the
  existing files by their existing names, never invent placeholder images or alt text
  describing a screen SPEC.md doesn't mention. If the directory doesn't exist or is
  empty, skip this -- don't fabricate screenshots.
- Near the end, an "Architecture" section with a Mermaid `flowchart` diagram built ONLY
  from SPEC.md's own "Architecture" section (component names, data flow, trust
  boundaries) -- never a generic/decorative diagram, never hand-drawn as an image.
  GitHub renders Mermaid code blocks natively, so this stays reproducible: regenerating
  this file always regenerates an accurate diagram, no separate image asset to keep in
  sync. Keep it a plain `flowchart` (no external styling/icons); label edges with the
  real mechanism (e.g. "invoke()", "spawn, stdio") where SPEC.md specifies one.
- A short "Developed via the gated pipeline" section: `sh scripts/run.sh from <stage>`
  and `INTERACTIVE=1 ...`, pass/fail in ACCEPTANCE.md, stages in pipeline.yaml.
- No emoji. Accurate to SPEC, concise.

Overwrite the template's generic README. These files are PIPELINE-GENERATED from SPEC,
never hand-authored -- so any project reproduces its own README by running this stage.
