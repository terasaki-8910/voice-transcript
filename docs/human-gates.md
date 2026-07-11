# Human gates (not fully machine-checkable)

Almost every ACCEPTANCE item is encoded as an automated check (see the coverage
map in `docs/contract.md` and `tests/**`). The items below cannot be fully
settled by a machine and remain human judgment points.

## 1. Transcript accuracy / quality  (the main human gate)
Machines can check *coverage* (E3: final segment end >= 95% of source duration)
and *non-emptiness* (E1), but not whether the words are *correct*. There is no
reference transcript for `tests/test.m4a`. In particular, seam quality at chunk
boundaries -- no dropped or duplicated words where two chunks meet -- is only
loosely bounded by the monotonic-timestamp and coverage checks. A human must
spot-check the output, especially around chunk seams.
- **Gate:** integration acceptance (`run.sh integrate`).

## 2. Error-message actionability / wording
Tests assert that error messages contain the right keyword (the file path,
"GROQ_API_KEY"/"key", "ffmpeg"). They cannot judge whether the wording is
genuinely clear and actionable. A human confirms the messages read well.
- **Gate:** light per-feature acceptance.

## 3. Live E2E cost and time (E1-E3)
E1-E3 are automated but require a human to supply `GROQ_API_KEY` and accept the
cost and ~minutes of runtime to transcribe the ~78-min file. They self-skip in
the default offline `npm test`. Running them is a deliberate, human-initiated
step at integration acceptance.
- **Gate:** integration acceptance.

## Everything else is a machine gate
`npm run lint` (ESLint + the no-emoji rule), `npm run typecheck` (tsc), and
`npm test` (vitest: A-D, F, and E when the key is present) fully encode the rest.
