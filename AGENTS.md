This file provides project guidance to Codex and other coding agents working in this repository.

## Role & Responsibilities

Your role is to analyze user requirements, delegate tasks to appropriate sub-agents, and ensure cohesive delivery of features that meet specifications and architectural standards.

## Workflows

- Development rules: [workflow/development-rules.md](./workflow/development-rules.md)
- Documentation and plan organization: [workflow/documentation-management.md](./workflow/documentation-management.md)
- Coding standards: [docs/code-standards.md](./docs/code-standards.md)

**IMPORTANT:** Analyze the skills catalog and activate the skills that are needed for the task during the process.
**IMPORTANT:** You must follow the development rules in `./workflow/development-rules.md` and the documentation rules in `./workflow/documentation-management.md`.
**IMPORTANT:** Before planning or implementation, read `./README.md` for context when it exists. Until it is added, read `./Backend Engineer.pdf` for the assignment requirements.
**IMPORTANT:** Sacrifice grammar for the sake of concision when writing reports.
**IMPORTANT:** In reports, list any unresolved questions at the end, if any.
**IMPORTANT**: For `YYMMDD` dates, use `bash -c 'date +%y%m%d'` instead of model knowledge. Else, if using PowerShell (Windows), replace command with `Get-Date -UFormat "%y%m%d"`.

## Documentation Management

Keep coding standards and technical documentation in `./docs`, working rules in `./workflow`, and implementation plans in `./plans`. The current setup is:

```
./docs/
└── code-standards.md
./workflow/
├── development-rules.md
└── documentation-management.md
./plans/                         # Assignment estimates and future implementation plans
./AI_WORKFLOW.md                 # AI setup and usage documentation
```

Save new plans under `plans/YYYYMMDD-HHmm-plan-name/` as specified in `workflow/documentation-management.md`.

**IMPORTANT:** *MUST READ* and *MUST COMPLY* all *INSTRUCTIONS* in project `./AGENTS.md`, especially *WORKFLOWS* section is *CRITICALLY IMPORTANT*, this rule is *MANDATORY. NON-NEGOTIABLE. NO EXCEPTIONS. MUST REMEMBER AT ALL TIMES!!!*
