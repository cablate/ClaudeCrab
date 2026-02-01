# OpenPackage.dev

> "Claude Code Plugins, but universal, more powerful, and open source"

## 簡介

OpenPackage 是一個輕量級 CLI 工具，用於建立版本化、AI 編碼平台無關的套件。支援簡化的安裝、卸載和分發流程。

- **官網**：https://openpackage.dev/
- **GitHub**：https://github.com/enulus/openpackage

## 核心功能

### 套件結構

使用 `openpackage.yml` 作為必要的配置檔案，可以包含：

- **Rules** — 編碼規範檔案
- **Commands** — Slash commands
- **Agents** — Agent 檔案（subagents）
- **Skills** — 遵循 Anthropic Agent Skills 規範的 skill 檔案
- **Root** — 規格、文件、測試等

### YAML 配置

- 每個套件都有 `openpackage.yml` manifest 檔案
- Skills 使用 SKILL.md，包含 YAML frontmatter（name, description 等）
- 支援跨專案遷移與複用

## OPKG CLI 指令

| 指令 | 說明 |
|------|------|
| `opkg init` | 初始化套件 |
| `opkg install` | 安裝套件到 codebase（支援 local/remote registry、GitHub repos、Claude Code Plugins marketplace） |
| `opkg save` | 將檔案加入套件 |
| `opkg status` | 查看已安裝的套件 |
| `opkg push` | 上傳到 registry |
| `opkg pull` | 從 registry 下載 |

## 使用場景

- **跨專案遷移**：透過 YAML 配置快速複製 agent skill 設定
- **一鍵安裝**：`opkg install` 自動部署所有依賴
- **版本管理**：追蹤 skill 和 plugin 的版本變更
- **開源生態**：相容 Claude Code Plugins，但更開放和強大

## 資料來源

- [OpenPackage 官網](https://openpackage.dev/)
- [GitHub - enulus/OpenPackage](https://github.com/enulus/openpackage)
- [OpenCode Agent Skills Plugin](https://github.com/joshuadavidthomas/opencode-agent-skills)
- [Building Agent Skills from Scratch](https://dev.to/onlyoneaman/building-agent-skills-from-scratch-lbl)
