# SDK Patch Maintenance SOP

ClaudeCab still patches `@anthropic-ai/claude-agent-sdk` after install because the V2
`createSession` path does not forward every option this project needs.

## Current Contract

- `package.json` runs `node scripts/patch-sdk-v2.cjs` in `postinstall`.
- `scripts/patch-sdk-v2.cjs` is the single source of truth for SDK patch anchors.
- The script patches only the installed SDK file and writes only
  `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs.pre-patch` as a same-install
  rollback copy.
- Historical upgrade notes and SDK snapshots are not maintained in the repo. Use git
  history when old patch rationale is needed.

## Upgrade Flow

1. Check the installed and target SDK versions.

   ```bash
   npm list @anthropic-ai/claude-agent-sdk --depth=0
   npm view @anthropic-ai/claude-agent-sdk version
   ```

2. Test the target SDK in a sandbox before touching production `node_modules`.

   ```bash
   mkdir -p .cache/sdk-patch-lab
   cd .cache/sdk-patch-lab
   npm init -y
   npm i @anthropic-ai/claude-agent-sdk@<version> --ignore-scripts
   ```

3. Run the patch script against the sandbox package.

   ```bash
   CLAUDECAB_SDK_PATCH_DIR=.cache/sdk-patch-lab/node_modules/@anthropic-ai/claude-agent-sdk node scripts/patch-sdk-v2.cjs
   ```

4. If an anchor fails, update only the `PATCHES` entries in
   `scripts/patch-sdk-v2.cjs`. Keep every patch anchor exact and verify each target
   string appears once.

5. Install the real dependency and let `postinstall` patch it.

   ```bash
   npm i @anthropic-ai/claude-agent-sdk@<version>
   ```

6. Verify the app.

   ```bash
   npm run typecheck
   npm run lint
   npm run test:run
   npm run build
   ```

## Rollback

- Same install: copy `sdk.mjs.pre-patch` over `sdk.mjs`.
- Clean reinstall: remove `node_modules` and run `npm ci`.
- Version rollback: install the previous known-good SDK version and rerun the
  verification commands.

## Patch Rules

- Do not add SDK snapshots, minified SDK copies, or per-version research dumps back to
  the repo.
- Keep patch logic in `scripts/patch-sdk-v2.cjs`; avoid parallel patch scripts.
- Prefer deleting stale comments over preserving links to removed investigation docs.
