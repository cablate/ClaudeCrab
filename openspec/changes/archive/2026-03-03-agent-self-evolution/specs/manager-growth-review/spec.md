## ADDED Requirements

### Requirement: Daily Growth Review Cycle

The Admin (manager) Agent SHALL execute a daily growth review at 04:00 local time using the Opus model, after all managed Agents have completed their daily reflection (03:00). The daily review SHALL provide the same quality of assessment as the weekly review. The review SHALL consist of four phases: (1) collect today's reflection entries from managed Agents' evolution/weekly/ files, (2) evaluate today's performance per Agent against User Expectations, (3) review any pending Layer 3 proposals from evolution/proposals/ and forward immediately to user, (4) produce a daily report for the user.

#### Scenario: Normal daily review execution

- **WHEN** the daily-growth-review schedule triggers at 04:00
- **THEN** the Admin Agent SHALL read today's reflection entries from each managed Agent, evaluate today's performance, review pending proposals, and produce a daily report

#### Scenario: Agent with no reflection today

- **WHEN** a managed Agent has no reflection entry for today in evolution/weekly/
- **THEN** the Admin Agent SHALL note the absence in the daily report without treating it as an error

#### Scenario: Layer 3 proposal immediate forwarding

- **WHEN** a pending Layer 3 proposal exists in any Agent's evolution/proposals/
- **THEN** the daily report SHALL include it with Admin's recommendation — proposals SHALL NOT wait for the weekly review

#### Scenario: Proposal staleness escalation (daily cadence)

- **WHEN** a proposal has appeared in daily reports for 3 or more consecutive days without user action
- **THEN** the Admin Agent SHALL escalate it with a "Needs Attention" label

### Requirement: Daily Report Format

The daily report SHALL be a concise, structured document containing: (1) per-Agent status with today's learning, expectation comparison, and gap identification (2-3 sentences each), (2) pending Layer 3 proposals requiring user decision (if any), (3) manager notes on cross-Agent patterns or concerns (if any). The report SHALL have no character limit — completeness over brevity. The report SHALL include a copy-paste instruction block for each pending proposal, enabling the user to approve/reject directly in an Admin conversation. The report SHALL be saved to knowledge/growth-reviews/daily/YYYY-MM-DD.md.

#### Scenario: Daily report delivery

- **WHEN** the daily review cycle completes
- **THEN** the Admin Agent SHALL send the report to the user via Telegram and save a copy to knowledge/growth-reviews/daily/

#### Scenario: Daily report conciseness

- **WHEN** the Admin Agent drafts the daily report
- **THEN** the report SHALL prioritize completeness — no character limit applies. Each employee's search keywords, sources, key takeaways, and application plans SHALL be faithfully transcribed

### Requirement: Weekly Trend Analysis Cycle

The Admin (manager) Agent SHALL execute a weekly trend analysis at a scheduled time (default Monday 05:00 local time using the Opus model). This analysis SHALL be based on the week's daily growth reports and SHALL focus on patterns that daily reviews cannot reveal: learning volume trends (increasing/stable/declining), recurring gaps (structural issues), knowledge application rate, and cross-Agent collaboration health. This schedule SHALL replace and extend the existing weekly-collaboration-review schedule. The weekly report SHALL serve as a meta-analysis, not a repetition of daily reviews.

#### Scenario: Normal weekly trend analysis

- **WHEN** the weekly-growth-review schedule triggers on Monday 05:00
- **THEN** the Admin Agent SHALL read all daily reports from knowledge/growth-reviews/daily/ for the current week, read evolution/weekly/ from each managed Agent, analyze trends, and produce a weekly trend report

#### Scenario: Agent with no daily data

- **WHEN** a managed Agent has no daily report data for the current week
- **THEN** the Admin Agent SHALL note the absence in the weekly report without treating it as an error

#### Scenario: Replaces weekly-collaboration-review

- **WHEN** the weekly-growth-review schedule is active
- **THEN** the previous weekly-collaboration-review.yaml SHALL be superseded, and its collaboration health assessment responsibilities SHALL be incorporated into the new review

### Requirement: Weekly Trend Metrics

The weekly trend analysis SHALL evaluate each Agent on four trend dimensions: learning volume trend (this week vs last week, direction focus vs scatter), gap trend (recurring gaps appearing across multiple daily reports indicating structural issues), quality trend (overall trajectory relative to User Expectations over the week), and knowledge application rate (whether internalized knowledge was applied in subsequent work). Evaluation SHALL be qualitative (narrative trend assessment), not daily-level detail.

#### Scenario: Learning trend assessment

- **WHEN** the Admin Agent evaluates an Agent's weekly learning trend
- **THEN** it SHALL compare this week's learning volume and focus area against the previous week, noting increases, decreases, or direction changes

#### Scenario: Recurring gap detection

- **WHEN** the same gap appears in 3 or more daily reports within a week
- **THEN** the Admin Agent SHALL flag it as a structural issue requiring targeted attention in the weekly report

#### Scenario: Quality trend narrative

- **WHEN** the Admin Agent assesses quality trend
- **THEN** it SHALL produce a brief narrative summarizing the week's trajectory (improving/stable/declining) relative to the Agent's User Expectations

### Requirement: Layer 3 Proposal Review

The Admin Agent SHALL review all pending Layer 3 change proposals found in managed Agents' evolution/proposals/ directories during the weekly review. For each proposal, the Admin Agent SHALL assess feasibility and alignment with the Agent's role. The Admin Agent SHALL NOT approve proposals autonomously — all proposals SHALL be forwarded to the user in the weekly report with the Admin Agent's recommendation (approve/reject/defer with rationale).

#### Scenario: Proposal forwarding to user

- **WHEN** one or more pending proposals exist in any Agent's evolution/proposals/
- **THEN** the weekly report SHALL include a dedicated section listing each proposal with: originating Agent, target file, proposed change summary, and Admin recommendation

#### Scenario: No pending proposals

- **WHEN** no pending proposals exist across all managed Agents
- **THEN** the weekly report SHALL omit the proposals section entirely

#### Scenario: Stale proposal tracking in weekly

- **WHEN** a proposal has appeared in daily reports for an extended period during the week
- **THEN** the weekly report SHALL include a proposal status summary with total days pending

### Requirement: Weekly Trend Report Format

The weekly trend report produced by the Admin Agent SHALL be a concise, structured document focusing on patterns and trends, not repeating daily details. The report SHALL contain: (1) per-Agent trend summary (learning trend, structural gaps, quality trajectory), (2) proposal status summary (new/resolved/pending with days count), (3) recommended learning directions for the next week, (4) collaboration health assessment. The report SHALL have no character limit — completeness over brevity. Structural gap root cause analysis SHALL classify gaps as knowledge-issue, habit-issue, or needs-user-input. The report SHALL be saved to knowledge/growth-reviews/weekly/YYYY-Www.md.

#### Scenario: Weekly report delivery

- **WHEN** the weekly trend analysis cycle completes
- **THEN** the Admin Agent SHALL send the report to the user via Telegram and save a copy to knowledge/growth-reviews/weekly/

#### Scenario: Weekly report conciseness

- **WHEN** the Admin Agent drafts the weekly trend report
- **THEN** the report SHALL prioritize completeness — no character limit applies. The report SHALL include root cause analysis for structural gaps

#### Scenario: Weekly report does not duplicate daily

- **WHEN** the Admin Agent produces the weekly trend report
- **THEN** it SHALL focus on week-level patterns and trends, not repeat individual daily assessments
