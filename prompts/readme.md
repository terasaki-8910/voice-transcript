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
- A short "Developed via the gated pipeline" section: `sh scripts/run.sh from <stage>`
  and `INTERACTIVE=1 ...`, pass/fail in ACCEPTANCE.md, stages in pipeline.yaml.
- No emoji. Accurate to SPEC, concise.

Overwrite the template's generic README. These files are PIPELINE-GENERATED from SPEC,
never hand-authored -- so any project reproduces its own README by running this stage.
