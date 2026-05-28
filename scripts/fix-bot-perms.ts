import { Client, GatewayIntentBits, PermissionsBitField } from 'discord.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const GUILD_ID = '1482681911192060065';

client.once('ready', async () => {
  const guild = await client.guilds.fetch(GUILD_ID);
  const me = guild.members.me!;
  
  console.log('Bot roles (by position):');
  const sortedRoles = me.roles.cache.sort((a, b) => b.position - a.position);
  for (const [, role] of sortedRoles) {
    console.log(`  ${role.name} (pos ${role.position}) - perms: ${role.permissions.toArray().join(', ')}`);
  }
  
  // Find the bot's highest role that it can edit
  // Bot can edit roles below its highest role
  console.log(`\nBot highest role: ${me.roles.highest.name} (pos ${me.roles.highest.position})`);
  
  // Try to add ManageGuild to the bot's own "CabCrab-System" role
  const botRole = me.roles.cache.find(r => r.name === 'CabCrab-System');
  if (botRole) {
    console.log(`\nCabCrab-System role id: ${botRole.id}, position: ${botRole.position}`);
    
    // Check if bot can edit this role (bot's highest role must be above this role)
    const canEdit = me.roles.highest.position > botRole.position;
    console.log(`Can edit CabCrab-System role: ${canEdit}`);
    
    if (canEdit) {
      try {
        await botRole.edit({
          permissions: [PermissionsBitField.Flags.ManageGuild]
        }, 'Add ManageGuild permission for onboarding setup');
        console.log('✅ Added ManageGuild to CabCrab-System role');
      } catch (e: any) {
        console.log(`❌ Failed to edit role: ${e.message}`);
        
        // Alternative: try to create an invite link with the right permissions
        console.log('\nAlternative: Bot needs to be re-invited with ManageGuild.');
        const invitePerms = new PermissionsBitField([
          PermissionsBitField.Flags.ManageGuild,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ManageRoles,
        ]);
        
        const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${me.user.id}&permissions=${invitePerms.bitfield}&scope=bot`;
        console.log(`Invite URL: ${inviteUrl}`);
      }
    } else {
      console.log('❌ Cannot edit: the bot role is at or above the bot\'s highest role');
    }
  }
  
  client.destroy();
});

client.login(process.env.DISCORD_BOT_TOKEN!);
