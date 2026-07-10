# Open Source Readiness

ClaudeCrab 的公開發布基準。這份文件記錄「repo 看起來完整」之外，第一批使用者是否真的能安全安裝、驗證與回報問題。

參考基準：

- [GitHub community profile](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-community-profiles-for-public-repositories)
- [OpenSSF Scorecard](https://github.com/ossf/scorecard)
- [GitHub Actions security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)
- [GitHub CodeQL](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning-with-codeql)

## Current Status

| Area | Status | Notes |
|---|---|---|
| License | Ready | `LICENSE` 與 package metadata 都是 AGPL-3.0-or-later。 |
| README / branding | Ready | 對外名稱為 ClaudeCrab，包含定位、Banner、quick start、auth、安全邊界與 AI 部署入口。 |
| Setup docs | Ready | `docs/SETUP.md` 覆蓋 local、Windows background、Docker、cloud/provider、admin console 與 troubleshooting。 |
| AI deployment skill | Ready | 公開 skill 位於 `.claude/skills/claudecrab-deploy/`。 |
| Safe example flow | Ready | 使用者先複製 `agents/example` 到被 gitignore 的自訂 agent 目錄，再加入 secret。 |
| Access warning | Ready | `.env.example` 與 `setup:check` 都說明 `ALLOWED_USERS` 留空會允許 channel 內所有人。 |
| CI | Pending remote rerun | Workflow 覆蓋 Node 20/22、audit、setup、typecheck、lint、tests 與 Docker build；跨平台測試與 Docker native build 修正需在下一次 push 驗證。 |
| Static analysis | Pending remote rerun | CodeQL workflow 已存在；上一輪因 GitHub code scanning 尚未啟用而失敗，需在 default branch 重新執行確認。 |
| Secret scanning | Pending remote rerun | 本機 full-history gitleaks 通過；workflow 已明確指定 `.gitleaks.toml`，避免把測試 snowflake 誤判成 secret。 |
| Dependency updates | Ready | Dependabot 覆蓋 npm 與 GitHub Actions。 |
| Dependency audit | Needs SDK migration | Production high-severity advisories 已清除；`claude-agent-sdk@0.2.119` 的 transitive moderate advisory 只能依 SDK upgrade SOP 處理。 |
| Community health | Ready | `SECURITY.md`、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、issue / PR templates 都存在。 |
| Release | Ready | GitHub 已發布 `v1.0.0`；後續 release 應附 migration note、known issues 與驗證結果。 |
| Repository metadata | Needs owner action | GitHub description、topics、social preview 與 default-branch protection 仍需確認。 |
| Real Discord canary | Needs operator | 自動測試不會使用真實 token；公開宣傳前仍需 fresh clone + 真實 Discord thread 對話 canary。 |

## Release Gate

公開宣傳或發新 release 前：

1. `npm ci`
2. `npm run setup:check -- --template --agent example`
3. `npm run typecheck`
4. `npm run lint`
5. `npm run test:run`
6. `npm run setup:verify -- --template`
7. `npm audit --omit=dev --audit-level=high`
8. Build production Docker image。
9. 對完整 Git history 跑 gitleaks。
10. Push 後確認 CI、CodeQL、Secret Scan 全綠。
11. 用 fresh clone 建立一個自訂 agent，完成真實 Discord channel 與 thread 對話 canary。

## First-User Acceptance

第一批使用者至少要能回答並完成：

- 我應該用 OAuth、API key 還是第三方 provider？
- 哪些值放 `.env`，哪些放 `agent.json`，哪些交給 `.claude/settings.local.json`？
- 如何避免把 secret commit 進 repo？
- shared server 如何限制可使用 agent 的人？
- 設定改動何時要關 session，何時要重啟？
- 啟動後沒反應時，要看哪個 log、跑哪個檢查？
- Docker/cloud 如何持久化 DB、logs 與 OAuth 狀態？

README、`docs/SETUP.md`、`docs/CLAUDE-SETTINGS.md` 與 deployment skill 必須對以上答案保持一致。

## Non-Goals For First Public Release

- 不提供 hosted control plane 或多租戶 SaaS。
- 不讓一般 Discord 使用者修改 deployment config。
- 不自動替 operator 建立 Discord application、取得 token 或繞過 provider 認證。
- 不把私人 agents、memory、logs、credentials、local `.claude` state 或個人 workflow 放進 repo。
- 不在 SDK migration canary 完成前自動升級 `@anthropic-ai/claude-agent-sdk`。
