/**
 * setup-discord-server.mjs — One-shot script to create the ClaudeCab Discord Server structure.
 *
 * Creates: Categories, Channels (text + forum), Roles, Permission Overwrites.
 * Outputs channel IDs for .env configuration.
 *
 * Usage: DISCORD_MAIN_BOT_TOKEN=xxx DISCORD_GUILD_ID=xxx node scripts/setup-discord-server.mjs
 */

import {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  OverwriteType,
} from 'discord.js';

const TOKEN = process.env.DISCORD_MAIN_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!TOKEN || !GUILD_ID) {
  console.error('Required: DISCORD_MAIN_BOT_TOKEN and DISCORD_GUILD_ID');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', async () => {
  console.log(`Bot: ${client.user?.username}`);

  const guild = await client.guilds.fetch(GUILD_ID);
  console.log(`Guild: ${guild.name}\n`);

  const botMember = await guild.members.fetch(client.user.id);

  // ============================================================
  // 1. Create Roles (if not exist)
  // ============================================================
  console.log('=== Creating Roles ===');
  const roleNames = ['Agent', 'Operations', 'Content', 'Engineer', 'Admin'];
  const roles = {};

  for (const name of roleNames) {
    let role = guild.roles.cache.find(r => r.name === name);
    if (!role) {
      role = await guild.roles.create({
        name,
        mentionable: true,
        reason: 'ClaudeCab server setup',
      });
      console.log(`  Created role: ${name} (${role.id})`);
    } else {
      console.log(`  Exists: ${name} (${role.id})`);
    }
    roles[name] = role;
  }

  // ============================================================
  // 2. Create Categories + Channels
  // ============================================================
  console.log('\n=== Creating Categories & Channels ===');

  const channelIds = {};

  // Helper: find or create category
  async function getOrCreateCategory(name) {
    let cat = guild.channels.cache.find(
      c => c.type === ChannelType.GuildCategory && c.name === name
    );
    if (!cat) {
      cat = await guild.channels.create({
        name,
        type: ChannelType.GuildCategory,
        reason: 'ClaudeCab server setup',
      });
      console.log(`  Created category: ${name}`);
    } else {
      console.log(`  Exists category: ${name}`);
    }
    return cat;
  }

  // Helper: find or create text channel
  async function getOrCreateText(name, parentId, topic) {
    let ch = guild.channels.cache.find(
      c => c.type === ChannelType.GuildText && c.name === name && c.parentId === parentId
    );
    if (!ch) {
      const opts = {
        name,
        type: ChannelType.GuildText,
        parent: parentId,
        reason: 'ClaudeCab server setup',
      };
      if (topic) opts.topic = topic;
      ch = await guild.channels.create(opts);
      console.log(`    Created #${name} (${ch.id})`);
    } else {
      console.log(`    Exists #${name} (${ch.id})`);
    }
    channelIds[name] = ch.id;
    return ch;
  }

  // Helper: find or create forum channel
  async function getOrCreateForum(name, parentId, topic) {
    let ch = guild.channels.cache.find(
      c => c.type === ChannelType.GuildForum && c.name === name && c.parentId === parentId
    );
    if (!ch) {
      ch = await guild.channels.create({
        name,
        type: ChannelType.GuildForum,
        parent: parentId,
        topic: topic || '',
        reason: 'ClaudeCab server setup',
      });
      console.log(`    Created Forum #${name} (${ch.id})`);
    } else {
      console.log(`    Exists Forum #${name} (${ch.id})`);
    }
    channelIds[name] = ch.id;
    return ch;
  }

  // --- COMMAND CENTER ---
  const cmdCenter = await getOrCreateCategory('COMMAND CENTER');
  await getOrCreateText('dashboard', cmdCenter.id, 'Agent 狀態總覽 — 定時更新');
  await getOrCreateText('approvals', cmdCenter.id, '審批請求');
  await getOrCreateText('cost-report', cmdCenter.id, '每日成本報告');
  await getOrCreateText('alerts', cmdCenter.id, '系統警報');

  // --- TASK MANAGEMENT ---
  const taskMgmt = await getOrCreateCategory('TASK MANAGEMENT');
  await getOrCreateForum('task-board', taskMgmt.id, '任務看板 — 每個 post = 一張 ticket');
  await getOrCreateForum('completed-tasks', taskMgmt.id, '已完成/取消的任務歸檔');

  // --- ENGINEERING ---
  const engineering = await getOrCreateCategory('ENGINEERING');
  await getOrCreateText('coder', engineering.id, 'Coder Agent 工作頻道');
  await getOrCreateText('oss-coder', engineering.id, 'OSS Coder Agent 工作頻道');

  // --- CONTENT ---
  const content = await getOrCreateCategory('CONTENT');
  await getOrCreateText('writer', content.id, 'Writer Agent 工作頻道');
  await getOrCreateText('seo', content.id, 'SEO Agent 工作頻道');

  // --- OPERATIONS ---
  const operations = await getOrCreateCategory('OPERATIONS');
  await getOrCreateText('admin', operations.id, 'Admin Agent 工作頻道');
  await getOrCreateText('transcriber', operations.id, 'Transcriber Agent 工作頻道');
  await getOrCreateText('media', operations.id, 'Media Agent 工作頻道');

  // --- COLLABORATION ---
  const collab = await getOrCreateCategory('COLLABORATION');
  await getOrCreateText('general', collab.id, '全員自由討論');
  await getOrCreateText('watercooler', collab.id, '閒聊 / 社交模式');

  // --- SYSTEM ---
  const system = await getOrCreateCategory('SYSTEM');
  await getOrCreateText('system-log', system.id, 'Activity events feed');
  await getOrCreateText('dev-log', system.id, '開發測試用');

  // ============================================================
  // 3. Create Forum Tags for task-board
  // ============================================================
  console.log('\n=== Creating Forum Tags ===');
  const taskBoard = guild.channels.cache.get(channelIds['task-board']);
  if (taskBoard && taskBoard.type === ChannelType.GuildForum) {
    const existingTags = taskBoard.availableTags.map(t => t.name);
    const desiredTags = [
      { name: '📋 backlog', moderated: false },
      { name: '🔄 in-progress', moderated: false },
      { name: '👀 in-review', moderated: false },
      { name: '✅ done', moderated: false },
      { name: '❌ cancelled', moderated: false },
      { name: '🔴 urgent', moderated: false },
      { name: '🟡 medium', moderated: false },
      { name: '🟢 low', moderated: false },
      { name: '🤖 coder', moderated: false },
      { name: '📝 writer', moderated: false },
      { name: '🔧 admin', moderated: false },
      { name: '🌐 seo', moderated: false },
      { name: '🎙 transcriber', moderated: false },
      { name: '🎨 media', moderated: false },
      { name: '💻 oss-coder', moderated: false },
    ];

    const newTags = desiredTags.filter(t => !existingTags.includes(t.name));
    if (newTags.length > 0) {
      const allTags = [...taskBoard.availableTags, ...newTags];
      await taskBoard.setAvailableTags(allTags.slice(0, 20)); // Discord limit
      console.log(`  Added ${newTags.length} tags to #task-board`);
    } else {
      console.log('  Tags already exist');
    }
  }

  // ============================================================
  // 4. Output .env values
  // ============================================================
  console.log('\n=== .env Channel IDs ===');
  console.log(`DISCORD_CHANNEL_DASHBOARD=${channelIds['dashboard'] || ''}`);
  console.log(`DISCORD_CHANNEL_APPROVALS=${channelIds['approvals'] || ''}`);
  console.log(`DISCORD_CHANNEL_COST_REPORT=${channelIds['cost-report'] || ''}`);
  console.log(`DISCORD_CHANNEL_ALERTS=${channelIds['alerts'] || ''}`);
  console.log(`DISCORD_CHANNEL_TASK_BOARD=${channelIds['task-board'] || ''}`);
  console.log(`DISCORD_CHANNEL_SYSTEM_LOG=${channelIds['system-log'] || ''}`);

  console.log('\n=== Agent Channel IDs ===');
  const agentChannels = ['coder', 'oss-coder', 'writer', 'seo', 'admin', 'transcriber', 'media'];
  for (const name of agentChannels) {
    console.log(`  ${name}: ${channelIds[name] || 'not created'}`);
  }

  console.log('\n=== All Channel IDs (JSON) ===');
  console.log(JSON.stringify(channelIds, null, 2));

  console.log('\n✅ Setup complete!');
  client.destroy();
  process.exit(0);
});

client.on('error', (e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});

client.login(TOKEN);
