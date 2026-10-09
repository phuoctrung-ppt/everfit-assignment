---
name: nestjs-skills
description: Use when building, debugging, reviewing, or testing NestJS backend code, or when invoked as $nestjs-skills with a task description.
license: MIT
metadata:
  version: "3.0.0"
---

# NestJS Skills

Invocation: `$nestjs-skills {task description}`.

Build context before doing the task. Resolve the skill directory from this file's
location, then run its JavaScript loader with Node.js (18+; no dependencies):

```bash
node .agents/skills/nestjs-skills/scripts/context-builder.mjs --task 'add JWT login with refresh tokens'
```

This example assumes the project root. From another directory, use the absolute
script path. Pass task text as one safely quoted argument, never interpolate it
as shell code. If no task was supplied, ask what NestJS work is needed.

The output contains the **raw, complete** [best practices](best-practices.md),
then task-matched documents from `references/` and `advanced/`, with source paths.
Read the output and use it to perform the requested task; generating context is
only preparation. Inspect the project's code and dependencies before applying
examples. Preserve the project's ORM, validation approach, and conventions.

## Load more only when needed

The loader uses keyword routing, not semantic understanding. Review its selection
against the actual task. Automatic context is capped at four detailed references,
two advanced files, and 24,000 source characters. Whole files that do not fit are
listed as deferred; no code examples are cut in half.

If a needed topic is missing, list the catalog, then expand the specific file:

```bash
node .agents/skills/nestjs-skills/scripts/context-builder.mjs --list
node .agents/skills/nestjs-skills/scripts/context-builder.mjs --expand-ref advanced/microservices.md
```

Repeat `--expand-ref` for additional files. Expansion without `--task` emits only
those files, avoiding repeated core context. Explicit expansions bypass automatic
limits. Read linked documents only when they answer an outstanding task question;
do not bulk-read either directory. If tool output is truncated, read the missing
selected source in chunks before relying on it.

If Node.js is unavailable, read `best-practices.md`, list filenames with `rg --files`
in this skill's `references/` and `advanced/` folders, then read only relevant files.
The references are examples, not guarantees of compatibility with installed versions.
