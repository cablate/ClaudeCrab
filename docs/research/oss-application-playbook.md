# OSS 申請文案 Playbook

> 建立日期：2026-04-30
> 案例來源：Codex for Open Source 申請，主專案為 `mcp-google-map`
> 用途：未來撰寫 OSS grant、開源計畫、維護者支援方案、developer program 申請時重用。

## 核心策略

這類申請不要寫成一般履歷，也不要寫成單純專案介紹。最有效的主軸是：

> 我正在維護一個已有公開使用證據的開源基礎工具，這個工具解決某個生態缺口；如果取得資源，我會把它轉化成可驗收的維護成果，並回饋成其他維護者也能使用的 patterns。

文案要同時回答：

- 這個 repo 是什麼，為誰解決什麼問題。
- 它已經有多少公開採用或生態價值。
- 申請資源會換成哪些具體維護成果。
- 申請者是否能把經驗回饋給更大的開發者社群。

## 欄位分工

### 角色欄位

目標：證明你是實際維護者，不只是專案展示者。

應包含 primary maintainer / core maintainer 身份、功能規劃、程式碼實作、release / package 發布、docs / issues / PRs、testing / security / maintenance。

範例：

```text
I am the primary maintainer of mcp-google-map. I lead feature planning, TypeScript implementation, MCP/HTTP/CLI interfaces, npm releases, documentation, issue/PR handling, and ongoing testing/security improvements.
```

### 為什麼 repo 符合資格

目標：把 repo 寫成生態中的實用基礎工具，而不是功能清單。

結構：

```text
License + project type + core capability + public metrics + ecosystem gap + real workflows.
```

要點：

- 先講開源授權與專案類型。
- 再講工具能力與範圍。
- 放可查證指標，例如 stars、forks、downloads。
- 最後落在生態缺口與真實工作流。

### API credits 用途

目標：讓審核者看到資源會變成具體維護成果。

高價值 artifact：

- Codex-assisted PR review。
- type / security checks。
- tool schema validation。
- automated release notes / changelog。
- real-world examples。
- smoke-test agents。
- maintainer playbooks。
- test suite / schema validator / release automation / security checklist。

避免只說「加速開發」、「研究 AI」、「改善文件」。這些都太模糊。

### 補充資訊

目標：延伸 API credits 的外部價值，不要變成個人自誇。

最有效結構：

```text
社群推廣 + 真實開發者回饋迴路 + AI agent 工程研究 + 轉成 OSS examples/tests/skills/playbooks。
```

社群經營可以加分，但不要寫成「我是 KOL」。更好的表述是 practitioner community、direct feedback loop、developer adoption、turns pain points into docs/tests/examples/skills/playbooks。

## 命名與定位

內部系統名稱不一定適合直接放進公開申請。可改成更公共的表述：

- applied AI agent engineering workbench
- applied AI agent engineering lab
- AI agent engineering research platform
- coding-agent workflow research workbench

如果申請對象是 OpenAI / Codex，補充資訊中應優先使用 Codex、coding agents、MCP、agent skills、maintainer automation、AI application workflows。避免讓競品工具變成主角。

## 500 字元壓縮法

壓縮順序：

- 保留 project identity。
- 保留 public metrics。
- 保留 ecosystem gap。
- 保留 concrete artifacts。
- 刪掉形容詞與泛泛熱情。
- 刪掉重複的個人品牌描述。

高價值詞：

- maintainer
- open-source
- ecosystem gap
- reliable
- workflow
- adoption
- test suite
- smoke-test
- schema validation
- release automation
- security checks
- playbooks
- feedback loop

低價值詞：

- passionate
- exciting
- innovative
- powerful
- very useful
- KOL
- influencer
- cutting-edge

## 本次定稿範本

### 為什麼這個程式碼庫符合申請資格

```text
mcp-google-map is an MIT-licensed Google Maps MCP server and CLI that gives AI agents 18 geospatial tools: geocoding, place search, directions, weather, air quality, static maps, local rank tracking, and composite planning. It has about 281 GitHub stars, 65 forks, and 669 npm downloads last week. It fills a practical gap in the MCP ecosystem by helping agents reliably handle real-world location, routing, local search, travel, and local SEO workflows through a self-hosted open-source server.
```

### 你會如何使用 API 積分

```text
I would use API credits to make mcp-google-map easier to maintain and safer to adopt: Codex-assisted PR review, type/security checks, tool schema validation, release notes, changelog automation, and real-world examples for all 18 tools. I also plan to build smoke-test agents for stdio MCP, Streamable HTTP, and exec CLI, plus reusable maintainer playbooks for testing, docs, releases, and user support across MCP servers.
```

### 還有其他想補充的資訊嗎

```text
Beyond this repo, I run a practitioner AI engineering community in Taiwan, sharing hands-on work on Codex, MCP, agent skills, coding-agent workflows, and real-world AI apps. This gives me a direct feedback loop from developers adopting these tools. I am also building an applied AI agent engineering workbench to study project memory, skill systems, spec-driven changes, multi-agent routing, and maintainer automation, then turn findings into OSS examples, tests, skills, and playbooks.
```

## 送出前檢查表

確認事實：

- GitHub repo 是 public。
- GitHub profile 是 public。
- stars / forks / downloads 是送出當天最新數字。
- package version 與 README 描述一致。
- license 可查。
- role 沒有誇大。

確認敘事：

- 主專案清楚。
- 補充資訊沒有搶走主專案焦點。
- credits 用途是可驗收成果，不是模糊願望。
- 社群敘事是 adoption / feedback loop，不是個人流量展示。
- 研究敘事能回饋 OSS examples、tests、skills、playbooks。

確認語氣：

- 對國際審核者，優先用英文。
- 少用形容詞，多用具體名詞。
- 少講熱忱，多講維護責任與成果。
- 避免把內部品牌或未公開系統講得過細。

## 可重用模板

Repo 資格：

```text
[Repo] is an [license]-licensed [project type] that helps [target users] do [core workflows]. It currently has [metrics]. It fills a practical gap in the [ecosystem] by enabling [specific real-world use cases] through [open-source/self-hosted/reusable mechanism].
```

API credits：

```text
I would use API credits to make [repo] easier to maintain and safer to adopt: [review automation], [quality checks], [validation], [release automation], and [examples/tests]. I also plan to build [repeatable automation/artifacts] that help maintain [repo] and can be reused by other [ecosystem] projects.
```

補充資訊：

```text
Beyond this repo, I [community/research/workbench] focused on [domain]. This gives me [feedback loop/evidence/adoption channel]. I would turn findings into [OSS examples/tests/skills/playbooks] that help the broader [ecosystem] build more reliable [tools/workflows].
```
