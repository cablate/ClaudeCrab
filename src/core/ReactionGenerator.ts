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
  // 身體感受
  '你剛滑了一下手機',
  '你盯著螢幕發呆了一會兒',
  '你在想等等要吃什麼',
  '你覺得椅子坐得屁股痛',
  '你的肚子叫了一聲',
  '你突然覺得有點冷',
  '你剛打了一個哈欠',
  '你眼睛有點乾',
  '你的肩膀超緊',
  '你覺得有點渴但懶得起來倒水',
  // 環境觀察
  '你聽到隔壁傳來奇怪的聲音',
  '你望向窗外',
  '你偷看了一眼旁邊的同事',
  '你覺得今天特別安靜',
  '你看到螢幕上自己的倒影',
  '你注意到桌上的灰塵',
  '你聞到不知道哪裡傳來的咖啡香',
  '你發現隔壁的燈一直在閃',
  // 思緒漫遊
  '你突然想到一件事',
  '你回想起今天發生的事',
  '你想起一首歌但想不起歌名',
  '你在想人生的意義',
  '你想到一個笑話但沒人可以講',
  '你在數天花板的格子',
  '你在想老闆是不是忘了你的存在',
  '你腦中突然閃過一個奇怪的畫面',
  '你想起小時候的一件蠢事',
  '你在想如果現在中樂透要幹嘛',
  '你突然好奇現在外面幾度',
  '你在想昨天夢到了什麼',
  // 動作/小事
  '你伸了個懶腰',
  '你轉了一下筆',
  '你把桌上的東西排整齊又弄亂',
  '你嘗試用嘴把筆蓋彈起來',
  '你在撕便利貼玩',
  '你把椅子往後靠差點翻過去',
  // 情緒波動
  '你突然覺得有點無聊',
  '你莫名其妙想笑',
  '你忽然有點感慨',
  '你覺得今天過得好慢',
  '你對剛才的事情有點後悔',
  '你突然很想吃甜的',
  '你覺得自己好像忘了什麼事',
  '你在猶豫要不要站起來走一走',
  '你突然想傳訊息給某個人但又算了',
  // 時間感知
  '你看了一眼時鐘覺得時間過得好快',
  '你驚覺已經過了兩個小時',
  '你在心裡倒數還有多久可以下班',
  '你想起今天好像有什麼約但想不起來',
  // 午休/深夜
  '你在考慮要不要睡個午覺',
  '你覺得咖啡因好像失效了',
  '你開始懷疑自己為什麼還沒睡',
  '你想念被窩的溫暖',
  // 週末/節日
  '你在想週末要做什麼',
  '你覺得假期怎麼還不來',
  '你突然意識到今天是星期幾',
  '你在規劃下次放假要去哪',
  // 社交焦慮
  '你在想剛才的回覆會不會太冷淡',
  '你猶豫要不要回那則訊息',
  '你覺得自己好像說錯話了',
  '你在想對方是不是生氣了',
  // 隨機荒謬
  '你突然想知道企鵝會不會游泳',
  '你在想如果變成貓咪會怎樣',
  '你腦中浮現一個完全不相關的回憶',
  '你開始思考「為什麼是這樣」這種哲學問題',
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
      ? `\n你最近的內心獨白（絕對禁止重複類似的句型、開頭、主題）：\n${recentMessages.map(m => `- "${m}"`).join('\n')}`
      : '';

    const prompt = `你是 ${agentName}，一個虛擬辦公室裡的員工。${personality ? `你的個性：\n${personality}` : ''}

現在的狀況：${phaseDesc}${contextHint}${recentLine}

請寫一句「內心獨白」——不是在跟別人說話，而是你心裡的碎碎念、自言自語。
要求：
- 口語化、有個性、像真人的內心 OS
- 15 字以內
- 不要對外回應、不要摘要任務內容
- 要有情緒，像「又來了...」「搞定，爽！」「這什麼鬼」
- 每次用不同的開頭方式，禁止總是用「靠」或髒話開頭
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
      ? `\n你最近說過的（絕對禁止重複類似的句型、開頭、主題）：\n${recentMessages.map(m => `- "${m}"`).join('\n')}`
      : '';

    const prompt = `你是 ${agentName}。${personality ? `你的個性：\n${personality}` : ''}

現在是${timeContext}，${scenario}。${recentLine}
用你的個性說一句內心碎念（口語化、15 字以內）。

嚴格要求：
- 每次用不同的開頭方式（反問、感嘆、自嘲、碎念、疑問句…隨機選一種）
- 禁止每句都用「靠」或髒話開頭——偶爾可以，但不能是預設模式
- 不要提到時間
- 不要說「等著」
- 要有趣、有個性、像真人自言自語
- 回應要跟情境（${scenario}）有直接關聯

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
