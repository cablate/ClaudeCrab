import { Client, GatewayIntentBits, ChannelType } from 'discord.js';

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`✅ Connected as ${client.user?.tag}`);
  const guild = await client.guilds.fetch(GUILD_ID);
  const channels = await guild.channels.fetch();

  // Find channels to delete
  const toDelete = [];
  for (const [, ch] of channels) {
    if (!ch) continue;
    if (ch.name.includes('cab-專案') || 
        ch.name.includes('活動行事曆') || 
        ch.name.includes('活動回放') || 
        ch.name.includes('活動提案')) {
      toDelete.push(ch);
    }
  }

  // Delete them
  for (const ch of toDelete) {
    await ch.delete('Cab requested cleanup - too many channels');
    console.log(`  🗑️ Deleted #${ch.name}`);
  }

  // Find the old 作品集 text channel and the categories
  let oldPortfolio = null;
  let cabCategory = null;
  let eventCategory = null;
  
  for (const [, ch] of channels) {
    if (!ch) continue;
    if (ch.type === 4) {
      if (ch.name.includes('Cab 分享')) cabCategory = ch;
      if (ch.name.includes('活動中心')) eventCategory = ch;
    }
    if (ch.name.includes('cab-作品集')) oldPortfolio = ch;
  }

  // Delete old text 作品集
  if (oldPortfolio) {
    await oldPortfolio.delete('Converting to Forum');
    console.log(`  🗑️ Deleted old #cab-作品集 (text -> forum)`);
  }

  // Create Forum channel for 作品集
  if (cabCategory) {
    const forum = await guild.channels.create({
      name: '🏆｜cab-作品集',
      type: ChannelType.GuildForum,
      topic: 'Cab 的文章、影片、課程、作品展示。新作品上架時更新。每篇作品開一個 thread。',
      parent: cabCategory.id,
      defaultForumLayout: 0, // List view
      defaultSortOrder: 0,   // Latest activity
    });
    console.log(`  ✅ Created Forum #cab-作品集 (${forum.id})`);
  }

  // Create single event channel under 活動中心
  if (eventCategory) {
    const eventCh = await guild.channels.create({
      name: '📅｜活動',
      type: ChannelType.GuildText,
      topic: '活動預告、回顧、提案都在這裡。即將舉辦的活動會置頂。',
      parent: eventCategory.id,
    });
    console.log(`  ✅ Created #活動 (${eventCh.id})`);
  }

  console.log('\n✅ Cleanup complete!');
  await client.destroy();
});

client.login(TOKEN);
