# Codex Cloud setup for plane

Use this branch to prepare an isolated development environment for `duanap/plane`.

- Migration branch: `codex/cloud-migration/2026-10-09`
- Source baseline: `5119f2937008b91a07feb3031a9fe45a00e67347`
- Runtime: Node.js {"node": ">=22"}
- Setup status: repository and command inspection complete; cloud installation and runtime checks pending.

## Install dependencies

Run from the repository root:

```bash
npm install
```

## Check the environment

Run the applicable checks and record their actual results:

```bash
npm run test
npm run build
```

## Start development

Run in the development environment:

```bash
npm run start
```

Check the documented local health endpoint or page after startup.

## Configuration and work boundaries

- Read the existing `AGENTS.md` and README before changing behavior.
- Put credentials in cloud environment configuration; keep `.env`, private keys, production databases, uploads, and dependency directories out of commits.
- Use synthetic development data. Production deployment and production database operations require a separate request.
- Keep existing APIs, game rules, and authentication behavior.
- Use local checks. Do not add CI or paid GitHub features for this migration.
- Preserve focused branches; do not force-push or overwrite the default branch.

See the [official cloud environment guide](https://learn.chatgpt.com/docs/environments/cloud-environments) for environment publication and credentials.

## Earlier server source

The original untracked `_server-source-0be1aefd` directory is preserved in `archives/server-source-0be1aefd.zip`. This is a separate historical source snapshot. Keep the current repository as the active codebase; compare the archive only when needed.
