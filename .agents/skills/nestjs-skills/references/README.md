# Detailed NestJS References

Load individual files when the task needs examples beyond `../best-practices.md`.
Use `node ../scripts/context-builder.mjs --list` from this directory to see the catalog,
or `--expand-ref references/<filename>.md` to load a specific document.

The loader selects relevant references automatically with `--task 'description'`.
Do not bulk-read this folder. `_sections.md` and `_template.md` support reference
maintenance and are excluded from task context. Check examples against project
dependencies and conventions before applying them.
