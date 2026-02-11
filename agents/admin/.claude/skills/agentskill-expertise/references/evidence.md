# 官方引用與證據

| # | 主題 | 引用 | 來源 | 對設計的意義 |
|---|------|------|------|-------------|
| 1 | Metadata 預載 | "the agent pre-loads the name and description of every installed skill into its system prompt" | claude.com/blog/agent-skills | Session 啟動即載入，不需手動觸發 |
| 2 | 漸進式揭露 | "Like a well-organized manual that starts with a table of contents, then specific chapters, and finally a detailed appendix" | leehanchung.github.io/claude-skills-deep-dive | 三層結構：metadata → SKILL.md → references |
| 3 | 語義匹配 | "Skill invocation relies entirely on Claude's language understanding rather than algorithmic routing" | mikhail.io/claude-code-skills | description 的語義清晰度比關鍵字覆蓋率重要 |
| 4 | Token 預算 | `<available_skills>` 區塊強制 15,000 字元上限 | 官方實測 | description 必須精簡但有資訊量 |
| 5 | 少即是多 | "Find the smallest set of high-signal tokens that maximize likelihood of desired outcome." | anthropic.com/engineering/context-engineering | 被動載入 > 主動引導的理論基礎 |
| 6 | Tool Overload | "Providing an LLM with 100+ tools leads to Context Confusion" / "The biggest performance gains came from removing things." | manus.im/blog/Context-Engineering-for-AI-Agents | 精簡比增加更能提升效能 |
| 7 | 官方定位 | Skill 定位為「Domain Expertise（領域知識）」 | Anthropic 官方 Skill 介紹 | 本質是知識外化，不是規則集合 |
