/**
 * Welcome Bot — 新人歡迎 DM + 自動給角色
 *
 * 使用方式：
 *   # 常駐模式（背景執行）：
 *   nohup npx tsx scripts/welcome-bot.ts &
 *
 *   # 或使用 PM2：
 *   npx pm2 start scripts/welcome-bot.ts --name welcome-bot
 *
 * 需要的 Env（已設在 settings.local.json）：
 *   DISCORD_BOT_TOKEN
 *   DISCORD_GUILD_ID
 */

import { Client, GatewayIntentBits } from 'discord.js';

const GUILD_ID = process.env.DISCORD_GUILD_ID || '1482681911192060065';
const FREE_MEMBER_ROLE_ID = '1503470575174287390'; // 🆓 免費會員
const WELCOME_CHANNEL_ID = '1503471152474095796';  // #👋歡迎-規則

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once('ready', () => {
  console.log(`✅ Welcome Bot 已上線：${client.user?.tag}`);
  console.log(`   監聽伺服器：${GUILD_ID}`);
  console.log(`   自動角色：🆓 免費會員 (${FREE_MEMBER_ROLE_ID})`);
});

// 監聽新成員加入
client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== GUILD_ID) return;

  console.log(`👋 新人加入：${member.user.tag} (${member.user.id})`);

  try {
    // 1. 發送歡迎 DM
    const dm = await member.send(
      `🎉 歡迎加入 **CabLate AI 落地總部**！\n\n` +
      `這裡聚集了一群想把 AI 實際應用在工作與創作上的人。\n\n` +
      `**快速起步**\n` +
      `1️⃣ <#${WELCOME_CHANNEL_ID}> — 閱讀社群公約\n` +
      `2️⃣ <#1503471178105491568> — 到 #自我介紹-成果展示 打聲招呼\n` +
      `3️⃣ <#1503471166323691533> — 逛逛 #閒聊，聊聊你在用 AI 做什麼\n` +
      `4️⃣ <#1503596286362914879> — 有問題到 #問答 發問\n\n` +
      `📋 也可以看看 <#1509133333626359908> 了解 Cab 正在進行什麼計畫。\n\n` +
      `期待在這裡看到你的分享！`
    );
    console.log(`   ✅ 歡迎 DM 已發送給 ${member.user.tag}`);

  } catch (err: any) {
    // 有些使用者關閉了 DM 權限
    console.log(`   ⚠️ 無法發送 DM 給 ${member.user.tag}：${err.message}`);
  }

  // 2. 自動給 🆓 免費會員 角色
  try {
    const role = member.guild.roles.cache.get(FREE_MEMBER_ROLE_ID);
    if (role) {
      await member.roles.add(role);
      console.log(`   ✅ 已賦予 🆓 免費會員 角色給 ${member.user.tag}`);
    } else {
      console.log(`   ❌ 找不到 🆓 免費會員 角色 (${FREE_MEMBER_ROLE_ID})`);
    }
  } catch (err: any) {
    console.log(`   ❌ 無法賦予角色給 ${member.user.tag}：${err.message}`);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN!);
