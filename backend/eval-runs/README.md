# Voice live-evaluation runs

One folder per run: `<YYYY-MM-DD>-<suite>[-<note>]/` with the CLI's `summary.json` and `.jsonl`
(`phase47-generalization-cli.ts --output backend/eval-runs/<folder>`). Commit the summary with the
change it measured. Runs made before 30 Oct 2026 scored create intents as failures (scorer bug,
WP-H1) and are not comparable with later ones. See documentation/setup-and-build.md.

No run has been recorded here yet; the last known live result (29 Oct 2026, 5/12 Ukrainian,
multi-turn 0/5) exists only as numbers in documentation/known-issues.md KI-04.
