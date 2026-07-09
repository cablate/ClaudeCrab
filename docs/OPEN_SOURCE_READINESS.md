# Open Source Readiness

This checklist summarizes the public-release baseline for ClaudeCab.

Sources reviewed:

- [GitHub community profile guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-community-profiles-for-public-repositories): README, license, contributing, security, code of conduct.
- [OpenSSF Scorecard](https://github.com/ossf/scorecard): CI, dependency update tooling, branch protection, token permissions, vulnerability signals.
- [GitHub Actions security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions): least-privilege workflow permissions, secret handling, and review of third-party actions.
- [GitHub CodeQL / code scanning](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql): static analysis for JavaScript / TypeScript security issues.

## Current Status

| Area | Status | Notes |
|---|---|---|
| License | Ready | `LICENSE` is AGPL-3.0-or-later and `package.json` matches. |
| README | Ready | Includes scope, quick start, auth modes, AI deployment prompt, and banner. |
| Setup docs | Ready | `docs/SETUP.md` covers local, Docker, cloud/provider, admin console, and troubleshooting. |
| AI deployment skill | Ready | Public skill lives in `.claude/skills/claudecab-deploy/`. |
| Example agent | Ready | `agents/example` contains placeholder-only config, `.claude/settings.local.json`, MCP config, and a disabled schedule example. |
| CI | Ready | `.github/workflows/ci.yml` runs setup check, typecheck, lint, tests, setup verify, and Docker build. |
| Static analysis | Ready | `.github/workflows/codeql.yml` runs CodeQL with security-extended queries. |
| Secret scanning | Ready | `.github/workflows/secret-scan.yml` runs gitleaks with `.gitleaks.toml`; local full-history scan passes. |
| Dependency updates | Ready | `.github/dependabot.yml` covers npm and GitHub Actions. |
| Dependency audit | Needs SDK decision | Production high-severity advisories are cleared. Remaining production moderate advisory is inside `@anthropic-ai/claude-agent-sdk@0.2.119` via transitive `@anthropic-ai/sdk`; fixing it requires the SDK upgrade SOP. |
| Security policy | Ready | `SECURITY.md` exists and documents sensitive deployment surfaces. |
| Contribution guide | Ready | `CONTRIBUTING.md` covers project constraints and validation commands. |
| Code of conduct | Ready | `CODE_OF_CONDUCT.md` exists with project-specific security boundaries. |
| Issue / PR templates | Ready | `.github/ISSUE_TEMPLATE/` and `.github/pull_request_template.md` steer users away from leaking secrets and toward reproducible reports. |
| Internal docs | Ready | Audit/plan/archive/migration docs are removed from the public working tree. |
| Repository naming | Ready | Keep the public GitHub repository/package URLs as `ClaudeCrab`; README and setup docs clone from that URL. |
| Release process | Optional | Add tags/releases/changelog once public users exist. |

## Release Gate

Before announcing publicly:

1. Decide whether to run the SDK upgrade SOP to clear the remaining moderate transitive SDK advisory.
2. Run `npm run typecheck`, `npm run lint`, `npm run test:run`, and `npm run setup:verify -- --template`.
3. Run full-history secret scan:

   ```bash
   docker run --rm -v "${PWD}:/repo" zricethezav/gitleaks:latest detect --source=/repo --config=/repo/.gitleaks.toml --no-banner --redact
   ```

4. Push and verify GitHub Actions are green.
5. Confirm CodeQL and gitleaks workflows are green on the default branch.
6. Test one real fresh install path with `agents/example` copied to a new agent id.

## Non-Goals For First Public Release

- No public hosted control plane.
- No Discord-side configuration writes for normal users.
- No automatic CD deployment, because deployments require operator-owned Discord and Claude/provider secrets.
- No bundled private agents, memory, logs, local `.claude` state, or personal workflows.
