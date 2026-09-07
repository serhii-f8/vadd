# Releasing `@vadd/cli`

`@vadd/cli` is the only published package. `packages/core`, `packages/server` and
`packages/web` are private workspace packages that the CLI's build bundles in.

## What the package contains

`packages/cli/scripts/build.ts` produces `packages/cli/dist/`:

- `bin.js` — the `vadd` entry point; sets `VADD_MIGRATIONS_DIR`, `VADD_PROMPTS_DIR` and
  `VADD_WEB_DIST` to the bundled copies and imports the server.
- `server.js` — the Fastify server with `@vadd/core` bundled in. Real npm dependencies
  (Fastify, `better-sqlite3`, the pinned ACP adapters, …) stay external and are declared in
  `packages/cli/package.json`.
- `migrations/` — the Drizzle SQL migrations and their journal.
- `prompts/claude-code/v1/` — the prompt templates and the exported event schema.
- `web/` — the Vite production build.

`files` in `package.json` is `["dist"]`, so nothing outside `dist/` ships except the
`README.md`, `LICENSE` and `package.json` npm always includes. Check the exact list before
every publish:

```sh
cd packages/cli
npm pack --dry-run
```

## Checklist

1. **Green tree.** From the repository root: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
   `pnpm --filter @vadd/web build`. `pnpm eval` is expected to exit non-zero (see
   `CONTRIBUTING.md`) and is not a release gate.
2. **Version.** Bump `version` in `packages/cli/package.json` (semantic versioning) and move
   the `Unreleased` entries in `CHANGELOG.md` under the new version with the date.
3. **Smoke test the real package.** `pnpm --filter @vadd/cli smoke` builds, packs, installs
   the tarball into a scratch prefix, runs the installed binary, and drives a real project
   and objective through its HTTP API. This is the check that catches a bundle that only
   works from inside the monorepo.
4. **Publish.** `pnpm --filter @vadd/cli publish --access public` (`prepack` runs the build).
   The package is scoped, so `--access public` is required at least on the first publish.
   Scoped publishing needs rights on the `vadd` npm organisation.
5. **Tag.** `git tag v<version>` on the release commit and push the tag.
6. **Verify from the outside.** In an empty directory on a machine or profile without the
   monorepo: `npx @vadd/cli@<version>` starts, opens the browser, and a project can be added.

## Pinned versions

The three ACP packages — `@zed-industries/claude-code-acp`, `@zed-industries/agent-client-protocol`
and `@agentclientprotocol/codex-acp` — are pinned exactly, in the root `package.json` and in
`packages/cli/package.json` alike. Their real output shapes are what the adapter tests
reproduce, and both have disagreed with the SDK's own types before. Bump them deliberately,
with the adapter tests re-run against real sessions, never as part of a routine dependency
refresh.
