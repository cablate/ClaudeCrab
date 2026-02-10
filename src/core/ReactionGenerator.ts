import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ActivityPhase, ActivityMood } from '../types/activity.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'ReactionGenerator' });

/** Phase descriptions for the reaction prompt */
const PHASE_DESCRIPTIONS: Record<ActivityPhase, string> = {
  task_received: '有人傳了訊息給你',
  working: '正在想怎麼回覆',
  tool_use: '正在使用工具',
  completed: '剛回覆完訊息',
  error: '遇到了錯誤',
  idle: '目前閒置中，沒什麼事做',
};

/** Mood diversity hints — nudge Haiku away from always picking "focused" */
const PHASE_MOOD_HINTS: Partial<Record<ActivityPhase, string>> = {
  task_received: '- mood 建議偏向：neutral、annoyed（又有事了）、excited（有趣的任務）',
  working: '- mood 不要總是 focused，可以是 tired（好累）、annoyed（好煩）、neutral',
  tool_use: '- mood 建議偏向：focused 或 neutral',
  completed: '- mood 建議偏向：excited（搞定了！）、neutral（還好啦）、bored（太簡單）',
  error: '- mood 建議偏向：annoyed（又壞了）、tired（不想處理）',
  idle: '- mood 建議偏向：bored、tired、neutral',
};

/** Random scenarios for idle mutters */
const MUTTER_SCENARIOS = [
  '你剛滑了一下手機',
  '你盯著螢幕發呆了一會兒',
  '你突然想到一件事',
  '你聽到隔壁傳來奇怪的聲音',
  '你在想等等要吃什麼',
  '你回想起今天發生的事',
  '你望向窗外',
  '你伸了個懶腰',
  '你覺得椅子坐得屁股痛',
  '你想起一首歌但想不起歌名',
  '你偷看了一眼旁邊的同事',
  '你在想老闆是不是忘了你的存在',
  '你的肚子叫了一聲',
  '你突然覺得有點冷',
  '你在想人生的意義',
  '你剛打了一個哈欠',
  '你想到一個笑話但沒人可以講',
  '你在數天花板的格子',
  '你覺得今天特別安靜',
  '你看到螢幕上自己的倒影',
];

export interface ReactionGeneratorOptions {
  /** Get agent display name by ID */
  getAgentName: (agentId: string) => string;
  /** Get agent personality (soul.md content) by ID */
  getAgentPersonality: (agentId: string) => string | undefined;
  /** Haiku model ID */
  model?: string;
}

/**
 * Unified Haiku-based reaction generator for agent personality text.
 * Consolidates AI calling logic from ActivityService and IdleMutterScheduler.
 */
export class ReactionGenerator {
  private readonly getAgentName: (agentId: string) => string;
  private readonly getAgentPersonality: (agentId: string) => string | undefined;
  private readonly model: string;

  constructor(options: ReactionGeneratorOptions) {
    this.getAgentName = options.getAgentName;
    this.getAgentPersonality = options.getAgentPersonality;
    this.model = options.model ?? 'claude-haiku-4-5-20251001';
  }

  /**
   * Generate a personality-driven reaction for a lifecycle event.
   * @param recentMessages - Last N reaction messages for this agent (to avoid repetition)
   */
  async generateReaction(
    agentId: string,
    phase: ActivityPhase,
    recentMessages: string[],
    metadata?: Record<string, unknown>,
  ): Promise<{ message: string; mood: ActivityMood }> {
    const personality = this.getAgentPersonality(agentId);
    const agentName = this.getAgentName(agentId);
    const phaseDesc = PHASE_DESCRIPTIONS[phase];

    // Build context hint (brief, not the full content)
    let contextHint = '';
    if (metadata?.taskContent) {
      const content = String(metadata.taskContent);
      contextHint = `（任務大概是關於：${content.substring(0, 40)}）`;
    } else if (metadata?.toolName) {
      contextHint = `（用了 ${metadata.toolName}）`;
    } else if (metadata?.error) {
      contextHint = `（遇到的問題：${String(metadata.error).substring(0, 40)}）`;
    }

    // Mood hint based on phase — guide Haiku toward diverse emotions
    const moodHint = PHASE_MOOD_HINTS[phase] ?? '';

    const recentLine = recentMessages.length > 0
      ? `\n你最近的內心獨白（不要重複類似的）：\n${recentMessages.map(m => `- ${m}`).join('\n')}`
      : '';

    const prompt = `你是 ${agentName}，一個虛擬辦公室裡的員工。${personality ? `你的個性：\n${personality.substring(0, 500)}` : ''}

現在的狀況：${phaseDesc}${contextHint}${recentLine}

請寫一句「內心獨白」——不是在跟別人說話，而是你心裡的碎碎念、自言自語。
要求：
- 口語化、有個性、像真人的內心 OS
- 15 字以內
- 不要對外回應、不要摘要任務內容
- 要有情緒，像「又來了...」「搞定，爽！」「這什麼鬼」
${moodHint}
回覆 JSON：{"message": "你的內心獨白", "mood": "neutral|excited|annoyed|tired|focused|bored"}
只回覆 JSON，不要其他內容。`;

    const responseText = await this.callHaiku(prompt);
    return this.parseResponse(responseText, this.inferMood(phase));
  }

  /**
   * Generate an idle mutter based on agent personality and a random scenario.
   */
  async generateMutter(agentId: string, recentMessages: string[] = []): Promise<{ message: string; mood: ActivityMood }> {
    const personality = this.getAgentPersonality(agentId);
    const agentName = this.getAgentName(agentId);
    const hour = new Date().getHours();

    const timeContext =
      hour < 6 ? '深夜' :
      hour < 12 ? '早上' :
      hour < 18 ? '下午' :
      '晚上';

    const scenario = MUTTER_SCENARIOS[Math.floor(Math.random() * MUTTER_SCENARIOS.length)];

    const recentLine = recentMessages.length > 0
      ? `\n你最近說過的碎念（不要重複類似的）：\n${recentMessages.map(m => `- ${m}`).join('\n')}`
      : '';

    const prompt = `你是 ${agentName}。${personality ? `你的個性：\n${personality.substring(0, 500)}` : ''}

現在是${timeContext}，${scenario}。${recentLine}
用你的個性說一句內心碎念（口語化、15 字以內）。
不要提到時間，不要說「等著」，要有趣、有個性、像真人自言自語。

回覆 JSON：{"message": "你的碎念", "mood": "neutral|excited|annoyed|tired|focused|bored"}
只回覆 JSON，不要其他內容。`;

    const responseText = await this.callHaiku(prompt);
    return this.parseResponse(responseText, 'bored');
  }

  // --- Private ---

  private async callHaiku(prompt: string): Promise<string> {
    const q = query({
      prompt,
      options: {
        model: this.model,
        maxTurns: 1,
        tools: [],
        persistSession: false,
        permissionMode: 'dontAsk',
      },
    });

    let responseText = '';
    for await (const msg of q) {
      if (msg.type === 'result') {
        if (msg.subtype === 'success') {
          responseText = msg.result;
        }
        break;
      }
    }
    return responseText;
  }

  private parseResponse(
    raw: string,
    fallbackMood: ActivityMood,
  ): { message: string; mood: ActivityMood } {
    const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned) as { message: string; mood?: string };

    const validMoods: ActivityMood[] = ['neutral', 'excited', 'annoyed', 'tired', 'focused', 'bored'];
    const mood = validMoods.includes(parsed.mood as ActivityMood)
      ? (parsed.mood as ActivityMood)
      : fallbackMood;

    return { message: parsed.message, mood };
  }

  /** Infer a reasonable mood from the phase as fallback */
  inferMood(phase: ActivityPhase): ActivityMood {
    switch (phase) {
      case 'task_received': return 'focused';
      case 'working': return 'focused';
      case 'tool_use': return 'focused';
      case 'completed': return 'excited';
      case 'error': return 'annoyed';
      case 'idle': return 'bored';
    }
  }
}
