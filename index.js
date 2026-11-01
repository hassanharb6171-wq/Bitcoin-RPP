require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  GatewayIntentBits,
  Events,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder
} = require('discord.js');
const config = require('./config.json');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID || config.guildId;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');

if (!TOKEN) {
  console.error('DISCORD_TOKEN fehlt. Lege eine .env-Datei an und trage deinen Bot-Token ein.');
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}
let state = readJson(STATE_FILE, { messages: {}, rp: { started: false }, serverCode: null, serverCodeUpdatedAt: null, teamWarns: {}, teamKicked: {}, absences: {}, nametags: {} });
if (!state.messages) state.messages = {};
if (!state.rp) state.rp = { started: false };
if (!state.teamWarns) state.teamWarns = {};
if (!state.teamKicked) state.teamKicked = {};
if (!state.absences) state.absences = {};
if (!state.nametags) state.nametags = {};
let tickets = readJson(TICKETS_FILE, {});
function saveState() { writeJson(STATE_FILE, state); }
function saveTickets() { writeJson(TICKETS_FILE, tickets); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const COLORS = {
  silber: 0xC0C0C0,
  blau: 0x2776D2,
  rot: 0xD64545,
  gruen: 0x2E9D62,
  lila: 0x8E62C7,
  gold: 0xD4AF37,
  schwarz: 0x222222
};
const rankRoleIds = config.rankRoles.map(r => r.id);
const ownerRoleIds = [config.roles.founder, config.roles.owner, config.roles.deputyOwner];
const rankManagerRoleIds = [config.roles.commandManager];
const disciplineRoleIds = [config.roles.commandManager];
const rpManagerRoleIds = [config.roles.rpControl];
const robloxAccessRoleIds = [config.roles.robloxAccess];
const ticketStaffRoleIds = config.ticketStaffRoleIds;

function hasAnyRole(member, roleIds) {
  return roleIds.some(id => member.roles.cache.has(id));
}
function isGuildOwner(member) {
  return member.id === member.guild.ownerId || member.id === config.ownerIdFromExport;
}
function canManageRanks(member) {
  return hasAnyRole(member, rankManagerRoleIds);
}
function canDiscipline(member) {
  return hasAnyRole(member, disciplineRoleIds);
}
function canControlRp(member) {
  return hasAnyRole(member, rpManagerRoleIds);
}
function canCheckRoblox(member) {
  return hasAnyRole(member, robloxAccessRoleIds);
}
function canHandleTickets(member) {
  return isGuildOwner(member) || member.permissions.has(PermissionFlagsBits.Administrator) || hasAnyRole(member, ticketStaffRoleIds);
}
function canManagePanels(member) {
  return canManageRanks(member);
}
function isTeamMember(member) {
  return config.rankRoles.some(r => member.roles.cache.has(r.id)) || (config.teamListAdditionalRoles || []).some(r => member.roles.cache.has(r.id)) || hasAnyRole(member, [config.roles.commandManager, config.roles.rpControl, config.roles.robloxAccess]);
}
function safeText(value, max = 1000) {
  return String(value ?? '').replace(/@everyone/g, '@\u200beveryone').replace(/@here/g, '@\u200bhere').slice(0, max);
}
function makeEmbed(title, description, color = 0xD4AF37) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'Deine Stadt. Deine Entscheidungen. Deine Konsequenzen.' });
}
function applyBanner(embed) {
  // Keine automatisch angehängten KI-/Branding-Bilder mehr.
  return { embeds: [embed] };
}
function germanTimestamp(date = new Date()) {
  const value = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
  return `${value.replace(', ', ' • ')} Uhr`;
}
function auditEmbed(action, target, actor, reason, color = 0xD4AF37, details = '') {
  const description = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `**MITGLIED:** ${target}`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `**DURCH:** ${actor}`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `**GRUND:**\n> ${safeText(reason || 'Kein Grund angegeben', 900)}`,
    details ? `━━━━━━━━━━━━━━━━━━━━━━━━━━\n${details}` : ''
  ].filter(Boolean).join('\n');
  return makeEmbed(action, description, color);
}
async function getTextChannel(guild, id) {
  if (!id) return null;
  const channel = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
  return channel && channel.isTextBased() && typeof channel.send === 'function' ? channel : null;
}
async function sendLog(guild, channelId, embed) {
  const channel = await getTextChannel(guild, channelId);
  if (!channel) {
    console.warn(`Log-Kanal nicht gefunden oder nicht beschreibbar: ${channelId}`);
    return false;
  }
  await channel.send(applyBanner(embed));
  return true;
}
async function upsertBotMessage(channel, storageKey, payload) {
  const oldId = state.messages[storageKey];

  if (oldId) {
    const oldMessage = await channel.messages.fetch(oldId).catch(() => null);

    if (oldMessage && oldMessage.author.id === client.user.id) {
      try {
        return await oldMessage.edit({ ...payload, attachments: [] });
      } catch (error) {
        // The message may have been deleted after the fetch, or the saved ID
        // may refer to a message that no longer exists. In that case, publish
        // a fresh message and replace the stale ID instead of crashing the bot.
        if (Number(error?.code) !== 10008 && Number(error?.status) !== 404) {
          throw error;
        }
        console.warn(`Gespeicherte Bot-Nachricht '${storageKey}' (${oldId}) existiert nicht mehr. Erstelle eine neue Nachricht.`);
      }
    } else {
      console.warn(`Gespeicherte Bot-Nachricht '${storageKey}' (${oldId}) wurde nicht gefunden. Erstelle eine neue Nachricht.`);
    }
  }

  const message = await channel.send(payload);
  state.messages[storageKey] = message.id;
  saveState();
  return message;
}

async function removeLegacyBrandingFromMessage(message) {
  if (!message || message.author?.id !== client.user.id) return false;
  const hasImage = message.attachments.size > 0 || message.embeds.some(embed => Boolean(embed.image));
  if (!hasImage) return false;
  const embeds = message.embeds.map(embed => {
    const data = embed.toJSON();
    delete data.image;
    return data;
  });
  await message.edit({ embeds, attachments: [] });
  return true;
}
async function clearLegacyBrandingImages(guild) {
  const staticChannels = {
    serverCode: config.channels.serverCode,
    rpStatus: config.channels.rpStatus,
    teamList: config.channels.teamList,
    robloxIdPanel: config.channels.robloxChecker,
    robloxNamePanel: config.channels.robloxName,
    absencePanel: config.channels.absencePanel,
    ticketPanel: config.channels.ticketPanel,
    complaintPanel: config.channels.complaintPanel
  };
  for (const [key, messageId] of Object.entries(state.messages || {})) {
    const channelId = key.startsWith('absencePanel_') ? key.slice('absencePanel_'.length) : staticChannels[key];
    if (!channelId) continue;
    const channel = await getTextChannel(guild, channelId);
    if (!channel) continue;
    const message = await channel.messages.fetch(messageId).catch(() => null);
    try { await removeLegacyBrandingFromMessage(message); }
    catch (error) { console.warn(`Altes Banner in ${key} konnte nicht entfernt werden:`, error.message); }
  }
  for (const ticket of Object.values(tickets || {})) {
    if (!ticket?.channelId || !ticket?.messageId || ticket.status !== 'open') continue;
    const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
    if (!channel?.isTextBased()) continue;
    const message = await channel.messages.fetch(ticket.messageId).catch(() => null);
    try { await removeLegacyBrandingFromMessage(message); }
    catch (error) { console.warn(`Altes Ticket-Banner in ${ticket.channelId} konnte nicht entfernt werden:`, error.message); }
  }
  if (state.teamListImageUrl) {
    delete state.teamListImageUrl;
    saveState();
  }
}
async function deferEphemeral(interaction) {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: true });
}
async function replyError(interaction, text) {
  const payload = { content: String(text), ephemeral: true };
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload).catch(() => {});
  return interaction.reply(payload).catch(() => {});
}
async function replyOk(interaction, text) {
  const payload = { content: String(text), ephemeral: true };
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload).catch(() => {});
  return interaction.reply(payload).catch(() => {});
}
async function fetchGuildMember(guild, user) {
  return guild.members.cache.get(user.id) || guild.members.fetch(user.id).catch(() => null);
}
async function fetchInteractionMember(interaction) {
  if (!interaction.guild) return null;
  return interaction.guild.members.cache.get(interaction.user.id) || interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}
function validateTarget(executor, target) {
  if (!target) return 'Das Mitglied konnte nicht gefunden werden.';
  if (target.id === executor.id) return 'Du kannst diese Aktion nicht auf dich selbst anwenden.';
  if (target.id === executor.guild.ownerId) return 'Der Serverinhaber kann nicht bearbeitet werden.';
  if (!isGuildOwner(executor) && target.roles.highest.comparePositionTo(executor.roles.highest) >= 0) {
    return 'Du kannst keine Person mit gleicher oder höherer Rollenposition bearbeiten.';
  }
  return null;
}
async function validateBotCanEdit(guild, target, role) {
  const botMember = guild.members.me || await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return 'Dem Bot fehlt die Berechtigung „Rollen verwalten“. ';
  if (!role.editable) return `Der Bot kann die Rolle **${role.name}** nicht vergeben. Ziehe die Bot-Rolle in der Rollenliste über diese Rolle.`;
  if (target.roles.highest.comparePositionTo(botMember.roles.highest) >= 0) return 'Die Rollenposition des Zielmitglieds ist zu hoch. Verschiebe die Bot-Rolle über die Teamrollen.';
  return null;
}
function rankIndex(roleId) { return rankRoleIds.indexOf(roleId); }
function memberCurrentRankIndex(member) {
  const held = config.rankRoles.filter(r => member.roles.cache.has(r.id));
  if (!held.length) return -1;
  return Math.max(...held.map(r => rankIndex(r.id)));
}
function roleById(id) { return config.rankRoles.find(r => r.id === id); }
function extrasForRank(roleId) {
  return Array.isArray(config.rankRoleExtras?.[roleId]) ? config.rankRoleExtras[roleId] : [];
}

// Nickname tags use every configured primary/community role, not only team ranks.
// Secondary permission, warning, ping and temporary-status roles are intentionally omitted.
function nicknameRoleDefinitions() {
  return Array.isArray(config.nicknameRoles) && config.nicknameRoles.length
    ? config.nicknameRoles
    : config.rankRoles;
}
function highestNicknameRole(member) {
  return nicknameRoleDefinitions()
    .map(definition => ({ definition, role: member.roles.cache.get(definition.id) }))
    .filter(entry => entry.role)
    .sort((a, b) => b.role.position - a.role.position)[0] || null;
}
function cleanRoleDisplayName(roleName) {
  return String(roleName || '')
    .replace(/^\s*LYL\s*✘\s*/i, '')
    .replace(/^\s*LYL\s*♖\s*/i, '')
    .trim();
}
function stripKnownRolePrefix(nickname, preferredRoleId = null) {
  if (!nickname) return nickname;
  const ordered = [...nicknameRoleDefinitions()].sort((a, b) => cleanRoleDisplayName(b.name).length - cleanRoleDisplayName(a.name).length);
  if (preferredRoleId) {
    const preferred = ordered.find(item => item.id === preferredRoleId);
    if (preferred) ordered.unshift(...ordered.splice(ordered.indexOf(preferred), 1));
  }
  for (const definition of ordered) {
    const prefix = `${cleanRoleDisplayName(definition.name)} ✘ `;
    if (prefix.trim() && nickname.startsWith(prefix)) return nickname.slice(prefix.length).trimStart();
  }
  return nickname;
}
function composeRoleNickname(member, selectedRole, isAbsent = false) {
  const title = cleanRoleDisplayName(selectedRole.definition.name);
  const prefix = `${title} ✘ `;
  // The requested base is always the Discord username, never the server nickname or global display name.
  const username = String(member.user.username || member.user.id);
  const suffix = isAbsent ? ' (abgemeldet)' : '';
  const maxUsernameLength = Math.max(1, 32 - Array.from(prefix).length - Array.from(suffix).length);
  return `${prefix}${Array.from(username).slice(0, maxUsernameLength).join('')}${suffix}`.slice(0, 32);
}
function expectedRoleNickname(member) {
  const selected = highestNicknameRole(member);
  const isAbsent = Boolean(config.roles.absent && member.roles.cache.has(config.roles.absent));
  if (selected) return composeRoleNickname(member, selected, isAbsent);
  const suffix = isAbsent ? ' (abgemeldet)' : '';
  const username = String(member.user.username || member.user.id);
  return `${Array.from(username).slice(0, Math.max(1, 32 - Array.from(suffix).length)).join('')}${suffix}`.slice(0, 32);
}
async function syncTeamNametag(member) {
  if (!member || member.user.bot) return;
  const selected = highestNicknameRole(member);
  const saved = state.nametags[member.id];
  const isAbsent = Boolean(config.roles.absent && member.roles.cache.has(config.roles.absent));
  // Only manage names for members who have a configured display role, are absent, or were previously tagged.
  if (!selected && !saved && !isAbsent) return;

  const desiredNickname = expectedRoleNickname(member);
  if (member.nickname !== desiredNickname) {
    if (!member.manageable) {
      throw new Error('Missing Permissions: Bot-Rolle muss über der höchsten Rolle des Mitglieds stehen und „Spitznamen verwalten“ benötigen.');
    }
    await member.setNickname(
      desiredNickname,
      selected
        ? `Bitcoin RP: automatischer Nametag für ${selected.definition.name}`
        : 'Bitcoin RP: Nametag mit Discord-Username synchronisiert'
    );
  }

  if (selected || isAbsent) {
    state.nametags[member.id] = {
      appliedNickname: desiredNickname,
      roleId: selected?.role.id || null,
      username: member.user.username,
      updatedAt: Date.now()
    };
  } else {
    delete state.nametags[member.id];
  }
  saveState();
}
async function syncAllTeamNametags(guild, fetchFreshMembers = false) {
  // Full member download is used once at startup. Reconciliation runs from cache
  // to avoid repeated REST downloads and to keep event-driven updates responsive.
  let members;
  if (fetchFreshMembers) {
    try {
      members = await guild.members.fetch();
    } catch (error) {
      console.warn(`Mitglieder konnten nicht vollständig geladen werden; Cache wird verwendet: ${error.message}`);
      members = guild.members.cache;
    }
  } else {
    members = guild.members.cache;
  }

  const pending = [...members.values()].filter(member =>
    !member.user.bot && (
      highestNicknameRole(member) ||
      state.nametags[member.id] ||
      (config.roles.absent && member.roles.cache.has(config.roles.absent))
    )
  );

  let checked = 0;
  let updated = 0;
  let nextIndex = 0;
  const workerCount = Math.min(5, pending.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < pending.length) {
      const member = pending[nextIndex++];
      checked++;
      try {
        const before = member.nickname;
        await syncTeamNametag(member);
        if (member.nickname !== before) updated++;
      } catch (error) {
        console.warn(`Nametag für ${member.user.username} konnte nicht synchronisiert werden: ${error.message}`);
      }
    }
  });
  await Promise.all(workers);
  console.log(`Nametags geprüft: ${checked}, aktualisiert: ${updated}`);
}
async function validateRoleListCanEdit(guild, target, roleIds) {
  for (const id of [...new Set(roleIds)]) {
    const role = guild.roles.cache.get(id) || await guild.roles.fetch(id).catch(() => null);
    if (!role) return `Die konfigurierte Zusatzrolle \`${id}\` wurde auf dem Server nicht gefunden.`;
    const error = await validateBotCanEdit(guild, target, role);
    if (error) return error;
  }
  return null;
}
// Replaces the active team rank and synchronizes only the additional roles
// explicitly mapped to the selected rank. Other unrelated roles stay untouched.
async function applyRankBundle(guild, target, newRole, reason) {
  const previousRankIds = config.rankRoles.filter(r => target.roles.cache.has(r.id)).map(r => r.id);
  const previousExtraIds = [...new Set(previousRankIds.flatMap(extrasForRank))]
    .filter(id => target.roles.cache.has(id));
  const desiredExtraIds = [...new Set(extrasForRank(newRole.id))];
  const removeExtraIds = previousExtraIds.filter(id => !desiredExtraIds.includes(id));
  const rolesToRemove = [...new Set([...previousRankIds, ...removeExtraIds])];
  const rolesToAdd = [...new Set([newRole.id, ...desiredExtraIds])];
  const allChangedIds = [...new Set([...rolesToRemove, ...rolesToAdd])];
  const validation = await validateRoleListCanEdit(guild, target, allChangedIds);
  if (validation) throw new Error(validation);
  if (rolesToRemove.length) await target.roles.remove(rolesToRemove, reason);
  if (rolesToAdd.length) await target.roles.add(rolesToAdd, reason);
  return { previousRankIds, desiredExtraIds, removeExtraIds };
}
async function setMemberRank(interaction, direction) {
  await deferEphemeral(interaction);
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canManageRanks(executor)) return replyError(interaction, `Dafür benötigst du die Rolle <@&${config.roles.commandManager}>.`);
  const user = interaction.options.getUser('mitglied', true);
  const target = await fetchGuildMember(interaction.guild, user);
  const validation = validateTarget(executor, target);
  if (validation) return replyError(interaction, validation);
  const newRole = interaction.options.getRole('neuer_rang', true);
  if (!isGuildOwner(executor) && newRole.position >= executor.roles.highest.position) return replyError(interaction, 'Du kannst keinen Rang vergeben, der auf gleicher oder höherer Position als deine eigene Rolle liegt.');
  if (!rankRoleIds.includes(newRole.id)) return replyError(interaction, 'Diese Rolle ist nicht als verwaltbarer Teamrang hinterlegt.');
  const oldIndex = memberCurrentRankIndex(target);
  const newIndex = rankIndex(newRole.id);
  if (direction === 'up' && oldIndex >= newIndex) return replyError(interaction, 'Für einen Uprank muss der neue Rang höher als der aktuelle Rang sein.');
  if (direction === 'down' && (oldIndex < 0 || oldIndex <= newIndex)) return replyError(interaction, 'Für einen Downrank muss der neue Rang niedriger als der aktuelle Rang sein.');
  const oldRoles = config.rankRoles.filter(r => target.roles.cache.has(r.id)).map(r => r.id);
  const oldNames = oldRoles.map(id => roleById(id)?.name).filter(Boolean).join(', ') || 'Kein vorheriger Teamrang';
  const reason = safeText(interaction.options.getString('grund') || `/${direction === 'up' ? 'uprank' : 'downrank'} durch ${interaction.user.tag}`, 450);
  try { await applyRankBundle(interaction.guild, target, newRole, reason); }
  catch (error) { return replyError(interaction, error.message || 'Die Rangrollen konnten nicht vollständig aktualisiert werden.'); }
  // Nebenrollen bleiben Teil der automatischen Vergabe, werden aber in der
  // öffentlichen/ephemeren Bestätigung und im Rangprotokoll nicht aufgelistet.
  const rankDetails = `**NEUER RANG:** ${newRole}`;
  const actionEmbed = auditEmbed(direction === 'up' ? 'UPRANK' : 'DOWNRANK', target, interaction.user, reason,
    direction === 'up' ? 0x22A06B : 0xD64545, rankDetails);
  await sendLog(interaction.guild, direction === 'up' ? config.channels.upRankLog : config.channels.downRankLog, actionEmbed);
  await refreshTeamList(interaction.guild).catch(error => console.warn('Teamliste konnte nicht automatisch aktualisiert werden:', error.message));
  return replyOk(interaction, `${target.user.tag} hat jetzt den Rang **${newRole.name}**.`);
}

async function handleTeamManagement(interaction) {
  await deferEphemeral(interaction);
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canManageRanks(executor)) return replyError(interaction, `Dafür benötigst du die Rolle <@&${config.roles.commandManager}>.`);
  const sub = interaction.options.getSubcommand();
  const user = interaction.options.getUser('mitglied', true);
  const target = await fetchGuildMember(interaction.guild, user);
  const validation = validateTarget(executor, target);
  if (validation) return replyError(interaction, validation);
  const role = interaction.options.getRole('rolle', true);
  if (!isGuildOwner(executor) && role.position >= executor.roles.highest.position) return replyError(interaction, 'Du kannst keine Rolle auf gleicher oder höherer Position als deine eigene Rolle verwalten.');
  if (!rankRoleIds.includes(role.id)) return replyError(interaction, 'Du kannst über diesen Befehl nur die eingetragenen Teamrangrollen verwalten.');
  const botValidation = await validateBotCanEdit(interaction.guild, target, role);
  if (botValidation) return replyError(interaction, botValidation);
  const reason = safeText(interaction.options.getString('grund') || `Teammanagement durch ${interaction.user.tag}`, 450);
  if (sub === 'add') {
    if (target.roles.cache.has(role.id)) return replyError(interaction, 'Das Mitglied besitzt diese Rolle bereits.');
    let bundle;
    try { bundle = await applyRankBundle(interaction.guild, target, role, reason); }
    catch (error) { return replyError(interaction, error.message || 'Die Rangrollen konnten nicht vollständig aktualisiert werden.'); }
    const extras = bundle.desiredExtraIds.length ? ` Zusatzrollen: ${bundle.desiredExtraIds.map(id => `<@&${id}>`).join(', ')}.` : '';
    await sendLog(interaction.guild, config.channels.teamJoinedLog, auditEmbed('TEAMROLLE HINZUGEFÜGT', target, interaction.user, reason, 0x22A06B, `**VERGEBENE ROLLE:** ${role}${extras ? `\n**NEBENROLLEN:** ${bundle.desiredExtraIds.map(id => `<@&${id}>`).join(', ')}` : ''}`));
    await refreshTeamList(interaction.guild).catch(error => console.warn('Teamliste konnte nicht automatisch aktualisiert werden:', error.message));
    return replyOk(interaction, `**${role.name}** wurde ${target.user.tag} zugewiesen. Der bisherige Teamrang wurde ersetzt, damit nur ein Rang aktiv ist.${extras}`);
  }
  if (!target.roles.cache.has(role.id)) return replyError(interaction, 'Das Mitglied besitzt diese Rolle nicht.');
  const linkedExtras = extrasForRank(role.id).filter(id => target.roles.cache.has(id));
  const removeIds = [role.id, ...linkedExtras];
  const removeValidation = await validateRoleListCanEdit(interaction.guild, target, removeIds);
  if (removeValidation) return replyError(interaction, removeValidation);
  await target.roles.remove(removeIds, reason);
  await sendLog(interaction.guild, config.channels.downRankLog, auditEmbed('TEAMROLLE ENTFERNT', target, interaction.user, reason, 0xD64545, `**ENTFERNTE ROLLE:** ${role}${linkedExtras.length ? `\n**ENTFERNTE NEBENROLLEN:** ${linkedExtras.map(id => `<@&${id}>`).join(', ')}` : ''}`));
  await refreshTeamList(interaction.guild).catch(error => console.warn('Teamliste konnte nicht automatisch aktualisiert werden:', error.message));
  return replyOk(interaction, `**${role.name}** wurde von ${target.user.tag} entfernt.`);
}

async function handleBestanden(interaction) {
  await deferEphemeral(interaction);
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canManageRanks(executor)) return replyError(interaction, `Dafür benötigst du die Rolle <@&${config.roles.commandManager}>.`);
  const user = interaction.options.getUser('mitglied', true);
  const target = await fetchGuildMember(interaction.guild, user);
  const validation = validateTarget(executor, target);
  if (validation) return replyError(interaction, validation);

  const primaryRole = interaction.options.getRole('rolle', true);
  const optionalRoles = [
    interaction.options.getRole('zusatzrolle1'),
    interaction.options.getRole('zusatzrolle2'),
    interaction.options.getRole('zusatzrolle3')
  ].filter(Boolean);
  const uniqueOptional = [...new Map(optionalRoles.map(role => [role.id, role])).values()];
  const reason = safeText(interaction.options.getString('grund') || 'Bewerbung bestanden', 450);
  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return replyError(interaction, 'Dem Bot fehlt die Berechtigung „Rollen verwalten“.');

  if (!isGuildOwner(executor) && primaryRole.position >= executor.roles.highest.position) return replyError(interaction, `Du kannst **${primaryRole.name}** nicht vergeben, weil die Rolle auf gleicher oder höherer Position als deine höchste Rolle liegt.`);
  const primaryValidation = await validateBotCanEdit(interaction.guild, target, primaryRole);
  if (primaryValidation) return replyError(interaction, primaryValidation);
  for (const role of uniqueOptional) {
    if (!isGuildOwner(executor) && role.position >= executor.roles.highest.position) return replyError(interaction, `Du kannst **${role.name}** nicht vergeben, weil die Rolle auf gleicher oder höherer Position als deine höchste Rolle liegt.`);
    const roleValidation = await validateBotCanEdit(interaction.guild, target, role);
    if (roleValidation) return replyError(interaction, roleValidation);
  }

  let autoExtras = [];
  try {
    if (rankRoleIds.includes(primaryRole.id)) {
      const bundle = await applyRankBundle(interaction.guild, target, primaryRole, `Bestanden durch ${interaction.user.tag}: ${reason}`);
      autoExtras = bundle.desiredExtraIds;
    } else if (!target.roles.cache.has(primaryRole.id)) {
      await target.roles.add(primaryRole, `Bestanden durch ${interaction.user.tag}: ${reason}`);
    }
    const missingOptional = uniqueOptional.filter(role => !target.roles.cache.has(role.id));
    if (missingOptional.length) await target.roles.add(missingOptional.map(role => role.id), `Bestanden durch ${interaction.user.tag}: ${reason}`);
  } catch (error) {
    return replyError(interaction, safeText(error.message || 'Die Rollen konnten nicht vollständig vergeben werden.', 300));
  }

  const assignedRoles = [...new Set([primaryRole.id, ...autoExtras, ...uniqueOptional.map(role => role.id)])];
  const roleList = assignedRoles.map(id => ` <@&${id}>`).join(', ');
  await sendLog(interaction.guild, config.channels.teamJoinedLog, auditEmbed('BESTANDEN', target, interaction.user, reason, 0x22A06B, `**NEUER RANG / ROLLE:** <@&${primaryRole.id}>`));
  await refreshTeamList(interaction.guild).catch(error => console.warn('Teamliste konnte nicht automatisch aktualisiert werden:', error.message));
  return replyOk(interaction, `${target.user.tag} hat **${primaryRole.name}** erhalten.${roleList ? `\nAutomatisch zugewiesene Rollen: ${roleList}` : ''}`);
}

const WARN_DURATION_MS = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '2d': 2 * 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '14d': 14 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000
};
function durationLabel(key) {
  return ({ '1h':'1 Stunde','6h':'6 Stunden','12h':'12 Stunden','1d':'1 Tag','2d':'2 Tage','3d':'3 Tage','7d':'7 Tage','14d':'14 Tage','30d':'30 Tage' })[key] || key;
}
async function syncWarnRoles(guild, member, reason = 'Teamwarn-Status aktualisiert') {
  const active = (state.teamWarns[member.id] || []).filter(w => w.expiresAt > Date.now());
  state.teamWarns[member.id] = active;
  const warnRoleIds = [config.roles.warn1, config.roles.warn2, config.roles.warn3, config.roles.permanentWarn].filter(Boolean);
  const botMember = guild.members.me || await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Dem Bot fehlt die Berechtigung „Rollen verwalten“.');
  const alreadyTeamKicked = Boolean(state.teamKicked?.[member.id]);
  const desired = alreadyTeamKicked ? [] : (active.length >= 4 ? [config.roles.warn3, config.roles.permanentWarn] : active.length === 3 ? [config.roles.warn3] : active.length === 2 ? [config.roles.warn2] : active.length === 1 ? [config.roles.warn1] : []);
  const relevantIds = [...new Set([...warnRoleIds, ...desired])];
  for (const id of relevantIds) {
    const role = guild.roles.cache.get(id);
    if (role && !role.editable) throw new Error(`Die Warn-Rolle ${role.name} ist nicht bearbeitbar. Verschiebe die Bot-Rolle über diese Rolle.`);
  }
  for (const id of relevantIds) {
    const role = guild.roles.cache.get(id);
    if (!role) continue;
    const has = member.roles.cache.has(id);
    const should = desired.includes(id);
    if (has && !should) {
      if (!role.editable) throw new Error(`Warn-Rolle ${role.name} ist für den Bot nicht bearbeitbar.`);
      await member.roles.remove(role, reason);
    } else if (!has && should) {
      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles) || !role.editable) throw new Error(`Warn-Rolle ${role.name} kann nicht vergeben werden. Bot-Rolle höher platzieren.`);
      await member.roles.add(role, reason);
    }
  }
  saveState();
  return active.length;
}
async function performTeamKick(guild, target, actor, reason, { automatic = false } = {}) {
  target = await guild.members.fetch(target.id).catch(() => target);
  const citizenRoleId = config.roles.citizen;
  const citizenRole = guild.roles.cache.get(citizenRoleId) || await guild.roles.fetch(citizenRoleId).catch(() => null);
  if (!citizenRole) throw new Error('Die Bürger-Rolle wurde nicht gefunden. Bitte prüfe config.roles.citizen.');

  const botMember = guild.members.me || await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('Dem Bot fehlt die Berechtigung „Rollen verwalten“.');
  }

  // Every member role except @everyone and Bürger is removed, including all
  // staff ranks, warning roles, permissions and any old Team-Kick marker.
  const rolesToRemove = target.roles.cache
    .filter(role => role.id !== guild.id && role.id !== citizenRoleId)
    .map(role => role);

  const uneditable = rolesToRemove.filter(role => !role.editable);
  if (uneditable.length) {
    throw new Error(`Der Bot kann folgende Rollen nicht entfernen: ${uneditable.map(role => role.name).join(', ')}. Verschiebe die Bot-Rolle über diese Rollen.`);
  }
  if (!target.roles.cache.has(citizenRoleId) && !citizenRole.editable) {
    throw new Error('Der Bot kann die Bürger-Rolle nicht vergeben. Verschiebe die Bot-Rolle über die Bürger-Rolle.');
  }

  const auditReason = automatic
    ? 'Automatischer Teamkick – 3/3 Warns erreicht'
    : `Teamkick durch ${actor?.tag || actor?.username || 'Teamleitung'}: ${reason}`;

  // Ensure Bürger remains assigned, then strip every other role.
  if (!target.roles.cache.has(citizenRoleId)) {
    await target.roles.add(citizenRole, auditReason);
  }
  if (rolesToRemove.length) {
    await target.roles.remove(rolesToRemove.map(role => role.id), auditReason);
  }

  state.teamKicked ||= {};
  state.teamKicked[target.id] = {
    at: Date.now(),
    actorId: actor?.id || client.user.id,
    automatic,
    reason: automatic ? 'Automatischer Teamkick – 3/3 Warns erreicht' : reason
  };
  saveState();

  const removedNames = rolesToRemove.map(role => role.name).sort((a, b) => a.localeCompare(b, 'de'));
  // Teamkicks werden bewusst nicht in einen separaten Log-Kanal gepostet.
  await refreshTeamList(guild).catch(error => console.warn('Teamliste konnte nach Teamkick nicht aktualisiert werden:', error.message));

  return { removedRoleNames: removedNames, citizenRole };
}

async function handleTeamWarn(interaction) {
  await deferEphemeral(interaction);
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canDiscipline(executor)) return replyError(interaction, `Dafür benötigst du die Rolle <@&${config.roles.commandManager}>.`);
  const user = interaction.options.getUser('mitglied', true);
  const target = await fetchGuildMember(interaction.guild, user);
  const validation = validateTarget(executor, target);
  if (validation) return replyError(interaction, validation);
  if (!config.rankRoles.some(r => target.roles.cache.has(r.id))) return replyError(interaction, 'Das ausgewählte Mitglied besitzt keinen verwalteten Teamrang.');
  const reason = safeText(interaction.options.getString('grund', true), 900);
  const duration = interaction.options.getString('dauer', true);
  const durationMs = WARN_DURATION_MS[duration];
  if (!durationMs) return replyError(interaction, 'Ungültige Warn-Dauer.');
  const warn = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    guildId: interaction.guildId,
    memberId: target.id,
    actorId: interaction.user.id,
    reason,
    createdAt: Date.now(),
    expiresAt: Date.now() + durationMs
  };
  state.teamWarns[target.id] ||= [];
  state.teamWarns[target.id].push(warn);
  let count;
  try { count = await syncWarnRoles(interaction.guild, target, `Teamwarn von ${interaction.user.tag}: ${reason}`); }
  catch (error) {
    state.teamWarns[target.id] = state.teamWarns[target.id].filter(w => w.id !== warn.id);
    saveState();
    return replyError(interaction, safeText(error.message, 250));
  }
  const expires = `<t:${Math.floor(warn.expiresAt / 1000)}:F> (<t:${Math.floor(warn.expiresAt / 1000)}:R>)`;
  // Teamwarns werden nur im Command bestätigt; es gibt keinen separaten Warn-Log-Kanal.

  if (count >= 3) {
    try {
      await performTeamKick(interaction.guild, target, client.user, 'Automatischer Teamkick – 3/3 Warns erreicht', { automatic: true });
    } catch (error) {
      return replyError(interaction, `Die dritte Teamwarn wurde gespeichert, aber der automatische Teamkick konnte nicht abgeschlossen werden: ${safeText(error.message, 300)}`);
    }
    return replyOk(interaction, `${target.user.tag} hat 3/3 aktive Teamwarns erreicht und wurde automatisch geteamkickt. Es bleibt nur die Bürger-Rolle erhalten.`);
  }

  return replyOk(interaction, `${target.user.tag} hat eine Teamwarnung erhalten (${Math.min(count, 3)}/3) für **${durationLabel(duration)}**. Sie läuft ${expires} automatisch ab.`);
}
async function handleDeleteWarn(interaction) {
  await deferEphemeral(interaction);
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canDiscipline(executor)) return replyError(interaction, `Dafür benötigst du die Rolle <@&${config.roles.commandManager}>.`);
  const user = interaction.options.getUser('mitglied', true);
  const target = await fetchGuildMember(interaction.guild, user);
  if (!target) return replyError(interaction, 'Das Mitglied ist nicht mehr auf dem Server.');
  const current = state.teamWarns[target.id] || [];
  const removed = current.length;
  state.teamWarns[target.id] = [];
  try { await syncWarnRoles(interaction.guild, target, `Teamwarns durch ${interaction.user.tag} gelöscht`); }
  catch (error) { return replyError(interaction, safeText(error.message, 250)); }
  return replyOk(interaction, `Alle Teamwarns von ${target.user.tag} wurden entfernt (${removed} Einträge).`);
}
async function processExpiredWarnings() {
  const now = Date.now();
  for (const [memberId, warns] of Object.entries(state.teamWarns || {})) {
    const expired = (warns || []).filter(w => w.expiresAt <= now);
    if (!expired.length) continue;
    state.teamWarns[memberId] = (warns || []).filter(w => w.expiresAt > now);
    saveState();
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) continue;
    const member = await guild.members.fetch(memberId).catch(() => null);
    if (!member) continue;
    try {
      await syncWarnRoles(guild, member, 'Teamwarn automatisch abgelaufen');
    } catch (error) { console.error(`Warn-Ablauf für ${memberId} fehlgeschlagen:`, error); }
  }
}

async function handleTeamKick(interaction) {
  await deferEphemeral(interaction);
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canManageRanks(executor)) return replyError(interaction, `Dafür benötigst du die Rolle <@&${config.roles.commandManager}>.`);
  const user = interaction.options.getUser('mitglied', true);
  const target = await fetchGuildMember(interaction.guild, user);
  const validation = validateTarget(executor, target);
  if (validation) return replyError(interaction, validation);
  if (!config.rankRoles.some(r => target.roles.cache.has(r.id))) return replyError(interaction, 'Das ausgewählte Mitglied besitzt keinen verwalteten Teamrang.');
  const reason = safeText(interaction.options.getString('grund', true), 900);
  try {
    await performTeamKick(interaction.guild, target, interaction.user, reason);
  } catch (error) {
    return replyError(interaction, safeText(error.message, 350));
  }
  return replyOk(interaction, `${target.user.tag} wurde geteamkickt. Alle Rollen außer Bürger wurden entfernt.`);
}

function teamListEmbeds(guild, color) {
  const allTeamRoles = [
    ...config.rankRoles,
    ...(config.teamListAdditionalRoles || [])
  ];
  const uniqueRoles = [...new Map(allTeamRoles.map(role => [role.id, role])).values()]
    .map((definition, index) => ({
      ...definition,
      index,
      role: guild.roles.cache.get(definition.id) || null
    }))
    .filter(entry => entry.role)
    .sort((a, b) => (b.role.position - a.role.position) || a.index - b.index);

  const blocks = uniqueRoles.map(entry => {
    const members = [...guild.members.cache.values()]
      .filter(member => member.roles.cache.has(entry.id))
      .sort((a, b) => a.user.username.localeCompare(b.user.username, 'de'));
    const roleName = cleanRoleDisplayName(entry.role.name);
    const header = `**${roleName} · ${members.length} ${members.length === 1 ? 'Mitglied' : 'Mitglieder'}**`;
    const memberLines = members.length ? members.map(member => `<@${member.id}>`) : ['Keine Mitglieder'];
    return [header, ...memberLines].join('\n');
  });

  // Discord descriptions are limited to 4096 characters. Split only between
  // role blocks so every configured team role remains visible in one message.
  const chunks = [];
  let current = '';
  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= 3900) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (block.length <= 3900) {
      current = block;
      continue;
    }
    // Extremely large role member lists are split safely while retaining the
    // role heading on each continuation chunk.
    const lines = block.split('\n');
    const heading = lines.shift();
    let sub = heading;
    for (const line of lines) {
      if ((sub + '\n' + line).length > 3800) {
        chunks.push(sub);
        sub = `${heading} (Fortsetzung)\n${line}`;
      } else {
        sub += `\n${line}`;
      }
    }
    current = sub;
  }
  if (current) chunks.push(current);

  return chunks.slice(0, 10).map((description, index) => {
    const embed = new EmbedBuilder().setColor(color).setDescription(description);
    if (index === 0) embed.setTitle('Bitcoin RP Teamliste');
    return embed;
  });
}
function teamListPayload(guild, colorName) {
  const refreshButton = new ButtonBuilder()
    .setCustomId('teamlist:refresh')
    .setLabel('Teamliste aktualisieren')
    .setStyle(ButtonStyle.Secondary);
  return {
    embeds: teamListEmbeds(guild, COLORS[colorName] || COLORS.gold),
    components: [new ActionRowBuilder().addComponents(refreshButton)]
  };
}
async function refreshTeamList(guild, sourceMessage = null) {
  const channel = await getTextChannel(guild, config.channels.teamList);
  if (!channel) return false;
  const colorName = state.teamListColor || 'gold';
  const payload = teamListPayload(guild, colorName);
  if (sourceMessage && sourceMessage.author?.id === client.user.id && sourceMessage.channelId === channel.id) {
    await sourceMessage.edit({ ...payload, attachments: [] });
    state.messages.teamList = sourceMessage.id;
    saveState();
    return true;
  }
  await upsertBotMessage(channel, 'teamList', payload);
  return true;
}
async function handleTeamList(interaction) {
  await deferEphemeral(interaction);
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canManageRanks(executor)) return replyError(interaction, `Dafür benötigst du die Rolle <@&${config.roles.commandManager}>.`);
  const colorName = interaction.options.getString('farbe', true);
  try {
    await interaction.guild.members.fetch();
  } catch (error) {
    return replyError(interaction, 'Ich konnte die Mitgliederliste nicht laden. Aktiviere im Developer Portal unter Bot den Server Members Intent und starte den Bot neu.');
  }
  state.teamListColor = colorName;
  delete state.teamListImageUrl;
  saveState();
  const channel = await getTextChannel(interaction.guild, config.channels.teamList);
  if (!channel) return replyError(interaction, 'Der Teamlisten-Kanal wurde nicht gefunden. Prüfe die ID in config.json.');
  await upsertBotMessage(channel, 'teamList', teamListPayload(interaction.guild, colorName));
  return replyOk(interaction, `Die Teamliste wurde in ${channel} aktualisiert.`);
}
const teamListButtonCooldowns = new Map();
async function handleTeamListRefresh(interaction) {
  const now = Date.now();
  const last = teamListButtonCooldowns.get(interaction.user.id) || 0;
  if (now - last < 10_000) return replyError(interaction, 'Bitte warte kurz, bevor du die Teamliste erneut aktualisierst.');
  teamListButtonCooldowns.set(interaction.user.id, now);
  await deferEphemeral(interaction);
  try {
    await interaction.guild.members.fetch();
    await refreshTeamList(interaction.guild, interaction.message);
    return replyOk(interaction, 'Die Teamliste wurde aktualisiert.');
  } catch (error) {
    console.error('Manuelle Teamlisten-Aktualisierung fehlgeschlagen:', error);
    return replyError(interaction, 'Die Teamliste konnte nicht aktualisiert werden. Prüfe die Bot-Berechtigungen und den Server Members Intent.');
  }
}

const teamListRefreshTimers = new Map();
function scheduleTeamListRefresh(guild, delay = 900) {
  if (!guild) return;
  const old = teamListRefreshTimers.get(guild.id);
  if (old) clearTimeout(old);
  const timer = setTimeout(() => {
    teamListRefreshTimers.delete(guild.id);
    refreshTeamList(guild).catch(error => console.warn('Automatische Teamlisten-Aktualisierung fehlgeschlagen:', error.message));
  }, delay);
  timer.unref?.();
  teamListRefreshTimers.set(guild.id, timer);
}

async function handleServerCode(interaction) {
  await deferEphemeral(interaction);
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canControlRp(executor)) return replyError(interaction, `Dafür benötigst du ausschließlich die Rolle <@&${config.roles.rpControl}>.`);
  const server1 = safeText(interaction.options.getString('server1', true).trim(), 32);
  const server2Raw = interaction.options.getString('server2');
  const server2 = server2Raw ? safeText(server2Raw.trim(), 32) : null;
  const validCode = code => /^[a-z0-9_-]{4,32}$/i.test(code);
  if (!validCode(server1)) return replyError(interaction, 'Der Code für Server 1 muss 4–32 Zeichen lang sein und darf nur Buchstaben, Zahlen, Bindestriche oder Unterstriche enthalten.');
  if (server2 && !validCode(server2)) return replyError(interaction, 'Der Code für Server 2 muss 4–32 Zeichen lang sein und darf nur Buchstaben, Zahlen, Bindestriche oder Unterstriche enthalten.');
  const channel = await getTextChannel(interaction.guild, config.channels.serverCode);
  if (!channel) return replyError(interaction, 'Der Server-Code-Kanal wurde nicht gefunden.');

  state.serverCodes = { server1, server2 };
  state.serverCode = server1;
  state.serverCodeUpdatedBy = interaction.user.id;
  state.serverCodeUpdatedAt = new Date().toISOString();
  saveState();

  const embed = makeEmbed('SERVERCODE', '━━━━━━━━━━━━━━━━━━', 0xD4AF37);
  embed.addFields(
    { name: 'SERVER 1', value: `\`${server1}\``, inline: Boolean(server2) },
    ...(server2 ? [{ name: 'SERVER 2', value: `\`${server2}\``, inline: true }] : [])
  );
  await upsertBotMessage(channel, 'serverCode', { content: '', embeds: [embed], components: [], attachments: [] });
  return replyOk(interaction, `Servercode(s) gespeichert. /rpstart zeigt ${server2 ? 'Server 1 und Server 2' : 'Server 1'} automatisch an.`);
}

async function handleRpStatus(interaction, started) {
  await deferEphemeral(interaction);
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canControlRp(executor)) return replyError(interaction, `Dafür benötigst du ausschließlich die Rolle <@&${config.roles.rpControl}>.`);
  if (started && !(state.serverCodes?.server1 || state.serverCode)) return replyError(interaction, 'Bitte speichere zuerst mit `/servercode` den Code für Server 1. Danach kannst du `/rpstart` ausführen.');

  const channel = await getTextChannel(interaction.guild, config.channels.rpStatus);
  if (!channel) return replyError(interaction, 'Der RP-Status-Kanal wurde nicht gefunden.');
  state.rp.started = started;
  state.rp.updatedBy = interaction.user.id;
  state.rp.updatedAt = new Date().toISOString();
  saveState();

  const codes = state.serverCodes || { server1: state.serverCode, server2: null };
  const codeLine = codes.server1
    ? `Servercode: \`${codes.server1}\`${codes.server2 ? `\nServercode 2: \`${codes.server2}\`` : ''}\n\n`
    : '';
  const description = started
    ? `ROLEPLAY ERÖFFNET\n\nDas Roleplay auf **Bitcoin RP** wurde offiziell gestartet.\n\n${codeLine}━━━━━━━━━━━━━━━━━━━━━━━━\n\n> **DIE STADT LEBT. DEINE GESCHICHTE BEGINNT.**\n>\n> Ob Staatsfraktion, Unternehmen, Zivilist oder Unterwelt – du entscheidest, welchen Weg du gehst.\n>\n> Erlebt einzigartiges Roleplay.\n> Schreibt eure eigene Geschichte.\n> Haltet euch an die Serverregeln.\n> Sorgt für faires und realistisches Roleplay.\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n**Bitcoin RP**\nDeine Stadt. Deine Entscheidungen. Deine Konsequenzen.`
    : `ROLEPLAY BEENDET\n\nDas Roleplay auf **Bitcoin RP** wurde offiziell beendet.\n\n${codeLine}━━━━━━━━━━━━━━━━━━━━━━━━\n\n> **DIE STADT SCHLIESST IHRE TORE.**\n>\n> Das heutige Roleplay ist beendet. Vielen Dank an alle, die dabei waren und für spannende RP-Situationen gesorgt haben.\n>\n> Danke für eure Teilnahme.\n> Danke für eure RP-Situationen.\n> Danke für euren Support.\n> Bitte beendet laufende RP-Situationen ordnungsgemäß.\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n**Bitcoin RP**\nDeine Stadt. Deine Entscheidungen. Deine Konsequenzen.`;
  const embed = makeEmbed(started ? 'Roleplay eröffnet' : 'Roleplay beendet', description, started ? 0x22A06B : 0xD64545);
  await upsertBotMessage(channel, 'rpStatus', applyBanner(embed));
  const savedCodes = state.serverCodes || { server1: state.serverCode, server2: null };
  return replyOk(interaction, started ? `RP wurde gestartet. Gespeicherte Servercodes: ${[savedCodes.server1, savedCodes.server2].filter(Boolean).join(' / ')}` : 'RP wurde beendet.');
}

async function fetchRobloxUser(input) {
  const trimmed = String(input).trim();
  let id = null;
  let user = null;
  if (/^\d{1,20}$/.test(trimmed)) {
    id = trimmed;
  } else {
    const response = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ usernames: [trimmed], excludeBannedUsers: false }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Roblox Username-API antwortete mit HTTP ${response.status}.`);
    const data = await response.json();
    user = data.data?.[0] || null;
    if (!user) return null;
    id = String(user.id);
  }
  const profileResponse = await fetch(`https://users.roblox.com/v1/users/${encodeURIComponent(id)}`, {
    headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(15000)
  });
  if (!profileResponse.ok) {
    if (profileResponse.status === 404) return null;
    throw new Error(`Roblox Profil-API antwortete mit HTTP ${profileResponse.status}.`);
  }
  const profile = await profileResponse.json();
  const thumbResponse = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${encodeURIComponent(id)}&size=150x150&format=Png&isCircular=false`, {
    headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(15000)
  }).catch(() => null);
  let avatarUrl = null;
  if (thumbResponse?.ok) {
    const thumb = await thumbResponse.json().catch(() => null);
    avatarUrl = thumb?.data?.[0]?.imageUrl || null;
  }
  return { ...profile, avatarUrl };
}
async function sendRobloxProfile(interaction, input) {
  let user;
  try { user = await fetchRobloxUser(input); }
  catch (error) { return replyError(interaction, `Roblox konnte gerade nicht abgefragt werden: ${safeText(error.message, 250)}`); }
  if (!user) return replyError(interaction, 'Ich konnte diesen Roblox-Benutzer nicht finden. Prüfe den Namen oder die ID.');
  const created = user.created ? new Date(user.created) : null;
  const createdText = created && !Number.isNaN(created.getTime()) ? `${created.toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' })}\n<t:${Math.floor(created.getTime() / 1000)}:R>` : 'Nicht verfügbar';
  const embed = new EmbedBuilder()
    .setColor(0xD4AF37)
    .setTitle(`Roblox-Profil: ${user.name || 'Unbekannt'}`)
    .setURL(`https://www.roblox.com/users/${user.id}/profile`)
    .setDescription(user.description ? safeText(user.description, 900) : 'Dieses Profil hat keine öffentliche Beschreibung.')
    .addFields(
      { name: 'Roblox-ID', value: `\`${user.id}\``, inline: true },
      { name: 'Benutzername', value: user.name || '—', inline: true },
      { name: 'Anzeigename', value: user.displayName || user.name || '—', inline: true },
      { name: 'Account erstellt', value: createdText, inline: false },
      { name: 'Verifiziert', value: user.hasVerifiedBadge ? 'Ja' : 'Nein', inline: true },
      { name: 'Gesperrt', value: user.isBanned ? 'Ja' : 'Nein', inline: true }
    )
    .setFooter({ text: 'Öffentlich verfügbare Roblox-Profilinformationen' })
    .setTimestamp();
  if (user.avatarUrl) embed.setThumbnail(user.avatarUrl);
  return interaction.editReply({ embeds: [embed] });
}
async function handleRobloxId(interaction, suppliedInput = null) {
  await deferEphemeral(interaction);
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canCheckRoblox(executor)) return replyError(interaction, `Dafür benötigst du die Rolle <@&${config.roles.robloxAccess}>.`);
  const input = suppliedInput || interaction.options.getString('benutzer', true);
  return sendRobloxProfile(interaction, input);
}
async function handleRobloxIdPanel(interaction) {
  await deferEphemeral(interaction);
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canCheckRoblox(executor)) return replyError(interaction, `Dafür benötigst du die Rolle <@&${config.roles.robloxAccess}>.`);
  const channel = await getTextChannel(interaction.guild, config.channels.robloxChecker);
  if (!channel) return replyError(interaction, 'Der Roblox-ID-Checker-Kanal wurde nicht gefunden.');
  const embed = makeEmbed('Roblox ID Checker', 'Drücke auf **Roblox ID prüfen** und schreibe den User hinein ^_^', 0xD4AF37);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('robloxid:open').setLabel('Roblox ID prüfen').setStyle(ButtonStyle.Primary)
  );
  await upsertBotMessage(channel, 'robloxIdPanel', { embeds: [embed], components: [row] });
  return replyOk(interaction, `Das Roblox-ID-Panel wurde in ${channel} veröffentlicht bzw. aktualisiert.`);
}

function robloxNamePanelPayload() {
  const embed = makeEmbed('Roblox Namen Angeben', 'Gib hier deinen Namen an ^_^', 0xD4AF37);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('robloxname:select')
    .setPlaceholder('Roblox Namen Angeben')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions([{ label: 'Name angeben', value: 'enter_name', description: 'Roblox-Benutzernamen eintragen' }]);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}
async function handleRobloxNamePanel(interaction) {
  await deferEphemeral(interaction);
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canManagePanels(executor)) return replyError(interaction, 'Dafür benötigst du eine freigegebene Teamleitungsrolle.');
  const channel = await getTextChannel(interaction.guild, config.channels.robloxName);
  if (!channel) return replyError(interaction, 'Der Roblox-Namen-Kanal wurde nicht gefunden.');
  await upsertBotMessage(channel, 'robloxNamePanel', robloxNamePanelPayload());
  return replyOk(interaction, `Das Roblox-Namen-Menü wurde in ${channel} veröffentlicht bzw. aktualisiert.`);
}
async function handleRobloxNameSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const member = await fetchInteractionMember(interaction);
  if (!member || !isTeamMember(member)) return replyError(interaction, 'Dieses Menü ist nur für Teammitglieder.');
  const input = safeText(interaction.fields.getTextInputValue('robloxname').trim(), 50);
  let user;
  try { user = await fetchRobloxUser(input); }
  catch (error) { return replyError(interaction, `Roblox konnte gerade nicht abgefragt werden: ${safeText(error.message, 250)}`); }
  if (!user) return replyError(interaction, 'Der Roblox-Benutzer wurde nicht gefunden. Bitte prüfe den Namen.');
  const channel = await getTextChannel(interaction.guild, config.channels.robloxName);
  if (!channel) return replyError(interaction, 'Der Roblox-Namen-Kanal wurde nicht gefunden.');
  const profileText = [
    '╭━━━━━━━━━━━━━━━━━━━━╮',
    'BENUTZERPROFIL',
    '╰━━━━━━━━━━━━━━━━━━━━╯',
    '',
    `**Name:** \`${safeText(user.name || input, 50)}\``,
    `**Anzeigename:** \`${safeText(user.displayName || user.name || '—', 50)}\``,
    `**Roblox-ID:** \`${user.id}\``,
    '',
    `**Angegeben von:** <@${member.id}>`
  ].join('\n');
  await channel.send({ content: profileText, allowedMentions: { users: [member.id] } });
  return replyOk(interaction, 'Dein Roblox-Profil wurde im Roblox-Namen-Kanal eingetragen.');
}

async function handleCustomEmbed(interaction) {
  await deferEphemeral(interaction);
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canManagePanels(executor)) return replyError(interaction, 'Dafür benötigst du eine freigegebene Teamleitungs-/Managementrolle.');

  const title = safeText(interaction.options.getString('titel', true), 256);
  const description = safeText(interaction.options.getString('text', true), 4000);
  const colorName = interaction.options.getString('farbe', true);
  const color = COLORS[colorName] || COLORS.gold;
  const targetChannel = interaction.options.getChannel('kanal') || interaction.channel;
  const image = interaction.options.getAttachment('bild');
  if (!targetChannel?.isTextBased() || typeof targetChannel.send !== 'function') return replyError(interaction, 'Der ausgewählte Zielkanal ist kein beschreibbarer Textkanal.');
  if (image && image.contentType && !image.contentType.startsWith('image/')) return replyError(interaction, 'Der Anhang muss eine Bilddatei sein.');
  if (image && image.size > 8 * 1024 * 1024) return replyError(interaction, 'Das Bild darf höchstens 8 MB groß sein.');

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `Erstellt von ${interaction.user.username}` })
    .setTimestamp();
  const files = [];
  if (image) {
    const response = await fetch(image.url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return replyError(interaction, 'Das hochgeladene Bild konnte nicht geladen werden.');
    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = path.basename(image.name || 'bitcoin-rp-image.png').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    files.push(new AttachmentBuilder(buffer, { name: filename }));
    embed.setImage(`attachment://${filename}`);
  }
  await targetChannel.send({ embeds: [embed], files });
  return replyOk(interaction, `Dein Embed wurde in ${targetChannel} veröffentlicht.`);
}

const TICKET_OPTIONS = [
  { type: 'faction', label: 'Fraktion beantragen', description: 'Antrag auf Aufnahme in eine Fraktion' },
  { type: 'weapons', label: 'Waffenschein beantragen', description: 'Antrag auf einen Waffenschein' },
  { type: 'unban', label: 'Entbannung beantragen', description: 'Antrag auf Überprüfung eines Banns' }
];
const COMPLAINT_OPTIONS = [
  { type: 'complaintGeneral', label: 'Allgemeine Beschwerde', description: 'Beschwerde zu einem allgemeinen Vorfall' },
  { type: 'complaintTeam', label: 'Teambeschwerde', description: 'Beschwerde über ein Teammitglied' }
];
function buildTicketSelect(customId, placeholder, options) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options.map(option => ({ label: option.label, value: option.type, description: option.description })));
  return new ActionRowBuilder().addComponents(menu);
}
function ticketPanelPayload() {
  const embed = makeEmbed('Bitcoin RP Tickets', 'Wähle hier dein Anliegen aus >_<', 0x5865F2);
  return { embeds: [embed], components: [buildTicketSelect('ticket:select', 'Wähle hier dein Anliegen aus', TICKET_OPTIONS)] };
}
function complaintPanelPayload() {
  const embed = makeEmbed('Bitcoin RP Beschwerden', 'Wähle hier deine Beschwerde aus >_<', 0x5865F2);
  return { embeds: [embed], components: [buildTicketSelect('complaint:select', 'Wähle hier deine Beschwerde aus', COMPLAINT_OPTIONS)] };
}

async function handleTicketOpen(interaction, type) {
  if (!config.ticketTypes[type]) return replyError(interaction, 'Unbekannte Ticket-Kategorie.');
  const existing = Object.values(tickets).find(t => t.guildId === interaction.guildId && t.ownerId === interaction.user.id && t.type === type && t.status === 'open');
  if (existing) {
    const ch = await interaction.guild.channels.fetch(existing.channelId).catch(() => null);
    if (ch) return replyError(interaction, `Du hast hier bereits ein offenes Ticket: ${ch}`);
    delete tickets[existing.channelId]; saveTickets();
  }
  return interaction.showModal(buildTicketModal(type));
}
function buildTicketModal(type) {
  const definition = config.ticketTypes[type];
  const modal = new ModalBuilder().setCustomId(`ticket:submit:${type}`).setTitle(definition.label.slice(0, 45));
  const rows = definition.fields.map(field => {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(field.label.slice(0, 45))
      .setPlaceholder(field.placeholder.slice(0, 100))
      .setRequired(Boolean(field.required))
      .setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short);
    if (field.required) input.setMinLength(2);
    return new ActionRowBuilder().addComponents(input);
  });
  modal.addComponents(...rows);
  return modal;
}
function slugify(value) {
  return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 35) || 'mitglied';
}
function ticketControlRow(channelId, ticket) {
  const actionButton = ticket.claimedBy
    ? new ButtonBuilder().setCustomId(`ticket:release:${channelId}`).setLabel('Ticket freigeben').setStyle(ButtonStyle.Secondary)
    : new ButtonBuilder().setCustomId(`ticket:claim:${channelId}`).setLabel('Ticket übernehmen').setStyle(ButtonStyle.Success);
  return new ActionRowBuilder().addComponents(
    actionButton,
    new ButtonBuilder().setCustomId(`ticket:close:${channelId}`).setLabel('Ticket schließen').setStyle(ButtonStyle.Danger)
  );
}

async function createTicketFromModal(interaction, type) {
  const definition = config.ticketTypes[type];
  if (!definition) return replyError(interaction, 'Unbekannte Ticket-Kategorie.');
  const existing = Object.values(tickets).find(t => t.guildId === interaction.guildId && t.ownerId === interaction.user.id && t.type === type && t.status === 'open');
  if (existing) {
    const existingChannel = await interaction.guild.channels.fetch(existing.channelId).catch(() => null);
    if (existingChannel) return replyError(interaction, `Du hast für diesen Bereich bereits ein offenes Ticket: ${existingChannel}`);
    delete tickets[existing.channelId]; saveTickets();
  }
  const category = await interaction.guild.channels.fetch(definition.categoryId).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) return replyError(interaction, `Die Ticket-Kategorie **${definition.label}** wurde nicht gefunden. Prüfe die ID in config.json.`);
  const fields = definition.fields.map(field => ({ name: field.label, value: safeText(interaction.fields.getTextInputValue(field.id) || '—', 1000) }));
  const channelName = `${definition.prefix}-${slugify(interaction.user.username)}`.slice(0, 90);
  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] }
  ];
  for (const roleId of ticketStaffRoleIds) {
    if (interaction.guild.roles.cache.has(roleId)) overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] });
  }
  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe();
  overwrites.push({ id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] });
  const channel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `TicketOwner=${interaction.user.id};TicketType=${type};Created=${Date.now()}`,
    permissionOverwrites: overwrites,
    reason: `Ticket von ${interaction.user.tag}: ${definition.label}`
  });
  tickets[channel.id] = { guildId: interaction.guildId, channelId: channel.id, ownerId: interaction.user.id, type, status: 'open', claimedBy: null, createdAt: new Date().toISOString() };
  saveTickets();
  const embed = makeEmbed(definition.label, `**Erstellt von:** ${interaction.user}\n**Kategorie:** ${definition.label}\n\n${fields.map(f => `**${f.name}:**\n${f.value}`).join('\n\n')}\n\nEin Teammitglied wird sich so bald wie möglich um dein Anliegen kümmern.`, 0x5865F2);
  const row = ticketControlRow(channel.id, tickets[channel.id]);
  const initialMessage = await channel.send({ content: `${interaction.user}`, ...applyBanner(embed), components: [row] });
  tickets[channel.id].messageId = initialMessage.id;
  saveTickets();
  await interaction.editReply({ content: `Dein Ticket wurde erstellt: ${channel}` });
}
async function handleTicketClaim(interaction, channelId) {
  const ticket = tickets[channelId];
  if (!ticket || ticket.status !== 'open') return replyError(interaction, 'Dieses Ticket ist nicht mehr offen oder wurde nicht vom Bot erstellt.');
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canHandleTickets(executor)) return replyError(interaction, 'Nur das zuständige Team kann ein Ticket übernehmen.');
  if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id) return replyError(interaction, `Dieses Ticket wurde bereits von <@${ticket.claimedBy}> übernommen.`);
  if (ticket.claimedBy === interaction.user.id) return replyError(interaction, 'Du hast dieses Ticket bereits übernommen.');

  ticket.claimedBy = interaction.user.id;
  ticket.claimedAt = new Date().toISOString();
  saveTickets();
  await interaction.deferUpdate();
  const channel = interaction.channel;
  const original = ticket.messageId ? await channel.messages.fetch(ticket.messageId).catch(() => null) : null;
  if (original) await original.edit({ components: [ticketControlRow(channelId, ticket)] });
  const claimEmbed = makeEmbed('Ticket übernommen', `Übernommen von ${interaction.user}`, 0x22A06B);
  await channel.send({ embeds: [claimEmbed], allowedMentions: { users: [interaction.user.id] } });
}
async function handleTicketRelease(interaction, channelId) {
  const ticket = tickets[channelId];
  if (!ticket || ticket.status !== 'open') return replyError(interaction, 'Dieses Ticket ist nicht mehr offen oder wurde nicht vom Bot erstellt.');
  if (!ticket.claimedBy) return replyError(interaction, 'Dieses Ticket ist aktuell nicht übernommen.');
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canHandleTickets(executor)) return replyError(interaction, 'Nur das zuständige Team kann ein Ticket freigeben.');
  if (ticket.claimedBy !== interaction.user.id && !isGuildOwner(executor)) return replyError(interaction, `Dieses Ticket wurde von <@${ticket.claimedBy}> übernommen. Nur diese Person oder die Serverleitung kann es freigeben.`);

  const previousClaimer = ticket.claimedBy;
  ticket.claimedBy = null;
  ticket.claimedAt = null;
  saveTickets();
  await interaction.deferUpdate();
  const channel = interaction.channel;
  const original = ticket.messageId ? await channel.messages.fetch(ticket.messageId).catch(() => null) : null;
  if (original) await original.edit({ components: [ticketControlRow(channelId, ticket)] });
  const releaseEmbed = makeEmbed(
    'Ticket freigegeben',
    `**Freigegeben von:** ${interaction.user}
**Zuvor übernommen von:** <@${previousClaimer}>

Das Ticket ist wieder für andere Teammitglieder verfügbar.`,
    0xA6A6A6
  );
  await channel.send({ embeds: [releaseEmbed], allowedMentions: { users: [interaction.user.id, previousClaimer] } });
}

async function handleTicketClose(interaction, channelId) {
  const ticket = tickets[channelId];
  if (!ticket || ticket.status !== 'open') return replyError(interaction, 'Dieses Ticket ist bereits geschlossen oder wurde nicht vom Bot erstellt.');
  const executor = await fetchInteractionMember(interaction);
  if (interaction.user.id !== ticket.ownerId && (!executor || !canHandleTickets(executor))) return replyError(interaction, 'Nur der Ticket-Ersteller oder das Support-Team kann dieses Ticket schließen.')
  const logChannel = await getTextChannel(interaction.guild, config.channels.ticketLog);
  if (!logChannel) return replyError(interaction, 'Der Ticket-Log-Kanal wurde nicht gefunden. Das Ticket bleibt offen, damit keine Unterhaltung verloren geht.');
  await interaction.deferUpdate();
  const channel = interaction.channel;
  ticket.status = 'closing';
  ticket.closedBy = interaction.user.id;
  ticket.closedAt = new Date().toISOString();
  saveTickets();
  const fetched = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const messages = fetched ? [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp) : [];
  const transcript = messages.map(m => {
    const attachments = [...m.attachments.values()].map(a => a.url).join(' ');
    return `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content || '[Embed/Anhang]'}${attachments ? ` | Anhänge: ${attachments}` : ''}`;
  }).join('\n');
  const file = new AttachmentBuilder(Buffer.from(transcript || 'Keine Nachrichten im Ticket vorhanden.', 'utf8'), { name: `transcript-${channel.id}.txt` });
  try {
    const closeEmbed = makeEmbed('Ticket geschlossen', `**Kanal:** #${channel.name}\n**Ersteller:** <@${ticket.ownerId}>\n**Geschlossen von:** ${interaction.user}\n**Übernommen von:** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Nicht übernommen'}\n**Nachrichten im Transcript:** ${messages.length}\n**Geschlossen am:** ${germanTimestamp()}`, 0xD64545);
    const branded = applyBanner(closeEmbed);
    await logChannel.send({ ...branded, files: [...(branded.files || []), file] });
  } catch (error) {
    ticket.status = 'open'; saveTickets();
    console.error('Ticket-Transcript konnte nicht gespeichert werden:', error);
    return interaction.followUp({ content: 'Der Transcript konnte nicht gespeichert werden. Das Ticket bleibt offen.', ephemeral: true }).catch(() => {});
  }
  await channel.send({ embeds: [makeEmbed('Ticket wird geschlossen', `Dieses Ticket wurde von ${interaction.user} geschlossen. Der Transcript wurde gespeichert.`, 0xD64545)] }).catch(() => {});
  setTimeout(async () => {
    try {
      ticket.status = 'closed';
      saveTickets();
      await channel.delete('Ticket geschlossen; Transcript erstellt.');
    } catch (error) {
      console.error('Ticket konnte nicht gelöscht werden:', error);
    }
  }, 3000);
}
async function handleTicketPanel(interaction) {
  await deferEphemeral(interaction);
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canManagePanels(executor)) return replyError(interaction, 'Nur die Serverleitung kann die Ticket-Panels veröffentlichen.');
  const channel = await getTextChannel(interaction.guild, config.channels.ticketPanel);
  if (!channel) return replyError(interaction, 'Der Ticket-Panel-Kanal wurde nicht gefunden.');
  const complaintChannel = await getTextChannel(interaction.guild, config.channels.complaintPanel);
  if (!complaintChannel) return replyError(interaction, 'Der Beschwerde-Panel-Kanal wurde nicht gefunden.');

  // Remove the previous complaint panel from the general ticket channel, if
  // an older bot version had published both panels in the same place.
  const oldComplaintMessageId = state.messages.complaintPanel;
  if (oldComplaintMessageId && channel.id !== complaintChannel.id) {
    const oldComplaintMessage = await channel.messages.fetch(oldComplaintMessageId).catch(() => null);
    if (oldComplaintMessage?.author?.id === client.user.id) {
      await oldComplaintMessage.delete().catch(error => console.warn('Altes Beschwerde-Panel konnte nicht gelöscht werden:', error.message));
    }
  }

  await upsertBotMessage(channel, 'ticketPanel', ticketPanelPayload());
  await upsertBotMessage(complaintChannel, 'complaintPanel', complaintPanelPayload());
  return replyOk(interaction, `Ticket-Menü in ${channel} und Beschwerde-Menü in ${complaintChannel} aktualisiert.`);
}
async function handleComplaintPanel(interaction) {
  await deferEphemeral(interaction);
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canManagePanels(executor)) return replyError(interaction, 'Nur die Serverleitung kann das Beschwerde-Menü veröffentlichen.');
  const channel = await getTextChannel(interaction.guild, config.channels.complaintPanel);
  if (!channel) return replyError(interaction, 'Der Beschwerde-Panel-Kanal wurde nicht gefunden.');
  await upsertBotMessage(channel, 'complaintPanel', complaintPanelPayload());
  return replyOk(interaction, `Das Beschwerde-Menü wurde in ${channel} aktualisiert.`);
}

function parseLocalDateTime(value) {
  const match = String(value || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, dd, mm, yyyy, hh, min] = match.map((v, i) => i === 0 ? v : Number(v));
  const date = new Date(yyyy, mm - 1, dd, hh, min, 0, 0);
  if (date.getFullYear() !== yyyy || date.getMonth() !== mm - 1 || date.getDate() !== dd || date.getHours() !== hh || date.getMinutes() !== min) return null;
  return date.getTime();
}
function teamAbsencePanelPayload() {
  const embed = makeEmbed('Bitcoin RP Abmeldung', 'Hier kannst du dich Ab/Anmelden ^_~', 0xD4AF37);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('absence:select')
    .setPlaceholder('Wähle deine Aktion aus')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      { label: 'Abmelden', value: 'off', description: 'Jetzt als Teammitglied abmelden' },
      { label: 'Anmelden', value: 'on', description: 'Wieder als Teammitglied anmelden' },
      { label: 'Abmeldung planen', value: 'plan', description: 'Eine zukünftige Abmeldung eintragen' }
    );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}
async function refreshStickyAbsencePanel(guild) {
  const channel = await getTextChannel(guild, config.channels.absencePanel);
  if (!channel) throw new Error('Der Abmeldungskanal wurde nicht gefunden.');
  const oldIds = [state.messages.absencePanel, state.messages[`absencePanel_${channel.id}`]].filter(Boolean);
  const panel = await channel.send(teamAbsencePanelPayload());
  state.messages.absencePanel = panel.id;
  delete state.messages[`absencePanel_${channel.id}`];
  saveState();
  await panel.pin('Aktuelles Bitcoin RP Abmeldungspanel').catch(error => console.warn('Abmeldungspanel konnte nicht angepinnt werden:', error.message));
  for (const id of new Set(oldIds)) {
    if (id === panel.id) continue;
    const old = await channel.messages.fetch(id).catch(() => null);
    if (old?.author?.id === client.user.id) await old.delete().catch(() => {});
  }
  return panel;
}
async function logAbsenceEvent(guild, member, action, record = null) {
  const channel = await getTextChannel(guild, config.channels.absencePanel);
  if (!channel) throw new Error('Der Abmeldungskanal wurde nicht gefunden.');
  const lines = [`**Mitglied:** <@${member.id}>`, `**Aktion:** ${action}`];
  if (record?.startAt) lines.push(`**Beginn:** <t:${Math.floor(record.startAt / 1000)}:F>`);
  if (record?.endAt) lines.push(`**Ende:** <t:${Math.floor(record.endAt / 1000)}:F>`);
  if (record?.reason) lines.push(`**Grund:** ${safeText(record.reason, 500)}`);
  await channel.send({ embeds: [makeEmbed('Abmeldung – Protokoll', lines.join('\n'), 0xD4AF37)] });
  await refreshStickyAbsencePanel(guild);
}
async function handleAbsencePanel(interaction) {
  await deferEphemeral(interaction);
  const executor = await fetchInteractionMember(interaction);
  if (!executor || !canManageRanks(executor)) return replyError(interaction, `Dafür benötigst du die Rolle <@&${config.roles.commandManager}>.`);
  try {
    const panel = await refreshStickyAbsencePanel(interaction.guild);
    return replyOk(interaction, `Das Abmeldungspanel wurde in ${panel.channel} veröffentlicht und angepinnt.`);
  } catch (error) { return replyError(interaction, safeText(error.message, 250)); }
}

function buildAbsencePlanModal() {
  const modal = new ModalBuilder().setCustomId('absence:plan:submit').setTitle('Abmeldung planen');
  const start = new TextInputBuilder().setCustomId('start').setLabel('Beginn (TT.MM.JJJJ HH:MM)').setPlaceholder('30.10.2026 18:00').setRequired(true).setStyle(TextInputStyle.Short);
  const end = new TextInputBuilder().setCustomId('end').setLabel('Ende (TT.MM.JJJJ HH:MM)').setPlaceholder('31.10.2026 22:00').setRequired(true).setStyle(TextInputStyle.Short);
  const reason = new TextInputBuilder().setCustomId('reason').setLabel('Grund (optional)').setPlaceholder('z. B. Urlaub, Schule, private Termine').setRequired(false).setStyle(TextInputStyle.Paragraph);
  modal.addComponents(new ActionRowBuilder().addComponents(start), new ActionRowBuilder().addComponents(end), new ActionRowBuilder().addComponents(reason));
  return modal;
}
async function setAbsent(member, record, reason = 'Teammitglied hat sich abgemeldet') {
  if (!member.manageable) throw new Error('Der Bot kann den Nicknamen nicht ändern. Prüfe „Spitznamen verwalten“ und die Rollenposition.');
  const role = member.guild.roles.cache.get(config.roles.absent);
  if (!role) throw new Error('Die Rolle „Abgemeldet“ wurde nicht gefunden.');
  if (!role.editable) throw new Error('Die Bot-Rolle muss in der Rollenliste über der Rolle „Abgemeldet“ stehen.');
  const botMember = member.guild.members.me || await member.guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('Dem Bot fehlt „Rollen verwalten“.');
  if (!record.nicknameCaptured) {
    record.originalNickname = member.nickname;
    record.nicknameCaptured = true;
  }
  if (!member.roles.cache.has(role.id)) await member.roles.add(role, reason);
  const baseName = (record.originalNickname || member.user.username).replace(/\s*\(abgemeldet\)$/i, '');
  const nickname = `${baseName.slice(0, 20)} (abgemeldet)`.slice(0, 32);
  await member.setNickname(nickname, reason);
  record.status = 'active';
  record.appliedAt = Date.now();
  state.absences[member.id] = record;
  saveState();
}
async function restoreFromAbsence(member, reason = 'Teammitglied hat sich wieder angemeldet') {
  if (!member.manageable) throw new Error('Der Bot kann deinen Nicknamen nicht zurücksetzen. Prüfe „Spitznamen verwalten“ und die Rollenposition.');
  const record = state.absences[member.id];
  const role = member.guild.roles.cache.get(config.roles.absent);
  if (role && member.roles.cache.has(role.id)) {
    if (!role.editable) throw new Error('Der Bot kann die Rolle „Abgemeldet“ nicht entfernen.');
    await member.roles.remove(role, reason);
  }
  const originalNickname = record?.nicknameCaptured ? record.originalNickname : (member.nickname || '').replace(/\s*\(abgemeldet\)$/i, '') || null;
  await member.setNickname(originalNickname, reason);
  delete state.absences[member.id];
  saveState();
}
async function ensureTeamMemberForAbsence(interaction) {
  const member = interaction.guild?.members.cache.get(interaction.user.id) || await fetchInteractionMember(interaction);
  if (!member || !isTeamMember(member)) {
    await replyError(interaction, 'Dieses Panel ist nur für Mitglieder des Bitcoin-RP-Teams.');
    return null;
  }
  return member;
}
async function handleAbsenceButton(interaction, action) {
  const member = await ensureTeamMemberForAbsence(interaction);
  if (!member) return;
  if (action === 'plan') return interaction.showModal(buildAbsencePlanModal());
  await deferEphemeral(interaction);
  try {
    if (action === 'off') {
      if (state.absences[member.id]?.status === 'active' && member.roles.cache.has(config.roles.absent)) return replyError(interaction, 'Du bist bereits abgemeldet.');
      const prior = state.absences[member.id];
      const record = prior?.status === 'scheduled' ? prior : { status: 'active', nicknameCaptured: false, originalNickname: null };
      delete record.startAt;
      delete record.endAt;
      await setAbsent(member, record, 'Manuelle Team-Abmeldung');
      await logAbsenceEvent(interaction.guild, member, 'Abgemeldet', state.absences[member.id]);
      return replyOk(interaction, 'Du bist jetzt abgemeldet. Deine Rolle und dein Nickname wurden angepasst.');
    }
    if (action === 'on') {
      if (!state.absences[member.id] && !member.roles.cache.has(config.roles.absent)) return replyError(interaction, 'Für dich ist keine Abmeldung aktiv oder geplant.');
      const oldRecord = state.absences[member.id] || null;
      await restoreFromAbsence(member);
      await logAbsenceEvent(interaction.guild, member, 'Wieder angemeldet', oldRecord);
      return replyOk(interaction, 'Du bist wieder angemeldet. Abgemeldet-Rolle und Nickname wurden zurückgesetzt.');
    }
  } catch (error) { return replyError(interaction, safeText(error.message, 250)); }
}
async function handleAbsencePlanSubmit(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const member = await fetchInteractionMember(interaction);
  if (!member || !isTeamMember(member)) return replyError(interaction, 'Nur Teammitglieder können eine Abmeldung planen.');
  const startAt = parseLocalDateTime(interaction.fields.getTextInputValue('start'));
  const endAt = parseLocalDateTime(interaction.fields.getTextInputValue('end'));
  if (!startAt || !endAt) return replyError(interaction, 'Bitte nutze das Format TT.MM.JJJJ HH:MM, z. B. 30.10.2026 18:00.');
  if (startAt < Date.now() + 60_000) return replyError(interaction, 'Der Beginn muss mindestens eine Minute in der Zukunft liegen.');
  if (endAt <= startAt) return replyError(interaction, 'Das Ende muss nach dem Beginn liegen.');
  if (state.absences[member.id]?.status === 'active' || member.roles.cache.has(config.roles.absent)) return replyError(interaction, 'Du bist bereits abgemeldet. Melde dich zuerst wieder an.');
  state.absences[member.id] = {
    status: 'scheduled',
    memberId: member.id,
    guildId: interaction.guildId,
    startAt,
    endAt,
    reason: safeText(interaction.fields.getTextInputValue('reason') || 'Keine Angabe', 500),
    originalNickname: member.nickname,
    nicknameCaptured: true,
    createdBy: interaction.user.id,
    createdAt: Date.now()
  };
  saveState();
  await logAbsenceEvent(interaction.guild, member, 'Abmeldung geplant', state.absences[member.id]);
  return replyOk(interaction, `Deine Abmeldung wurde geplant: Beginn <t:${Math.floor(startAt/1000)}:F>, Ende <t:${Math.floor(endAt/1000)}:F>. Die Rolle und der Nickname werden automatisch angepasst.`);
}
async function processScheduledAbsences() {
  const now = Date.now();
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;
  for (const [memberId, record] of Object.entries(state.absences || {})) {
    try {
      const member = await guild.members.fetch(memberId).catch(() => null);
      if (!member) continue;
      if (record.status === 'scheduled' && now >= record.startAt) {
        await setAbsent(member, record, `Geplante Abmeldung gestartet: ${record.reason || ''}`);
        await logAbsenceEvent(guild, member, 'Geplante Abmeldung gestartet', state.absences[memberId]);
      }
      const current = state.absences[memberId];
      if (current?.status === 'active' && current.endAt && now >= current.endAt) {
        await restoreFromAbsence(member, 'Geplante Abmeldung beendet');
        await logAbsenceEvent(guild, member, 'Geplante Abmeldung beendet – wieder angemeldet', current);
      }
    } catch (error) { console.error(`Geplante Abmeldung für ${memberId} fehlgeschlagen:`, error.message); }
  }
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`Bitcoin-RP-Bot online als ${readyClient.user.tag}`);
  console.log(`Verbunden mit Guild-ID ${GUILD_ID}`);
  const guild = readyClient.guilds.cache.get(GUILD_ID);
  if (guild) {
    await clearLegacyBrandingImages(guild).catch(error => console.warn('Alte Bannerbilder konnten nicht vollständig entfernt werden:', error.message));
    await syncAllTeamNametags(guild, true).catch(error => console.warn('Team-Nametags konnten nicht vollständig synchronisiert werden:', error.message));
    await refreshTeamList(guild).catch(error => console.warn('Teamliste konnte beim Start nicht aktualisiert werden:', error.message));
  }
  processExpiredWarnings().catch(error => console.error('Warn-Prüfung fehlgeschlagen:', error));
  processScheduledAbsences().catch(error => console.error('Abmelde-Prüfung fehlgeschlagen:', error));
  setInterval(() => processExpiredWarnings().catch(error => console.error('Warn-Prüfung fehlgeschlagen:', error)), 30_000).unref();
  setInterval(() => processScheduledAbsences().catch(error => console.error('Abmelde-Prüfung fehlgeschlagen:', error)), 30_000).unref();
  // Low-frequency cache-only safety reconciliation. Gateway events handle normal changes immediately.
  setInterval(() => {
    const activeGuild = client.guilds.cache.get(GUILD_ID);
    if (activeGuild) syncAllTeamNametags(activeGuild, false).catch(error => console.warn('Nametag-Sicherheitsabgleich fehlgeschlagen:', error.message));
  }, 30 * 60_000).unref();
});

// Debounce only within one short gateway tick, reuse the already-updated
// GuildMember object, and never refetch the member through REST for each change.
const nametagSyncTimers = new Map();
const nametagPendingMembers = new Map();
function scheduleNametagSync(member, delay = 100) {
  if (!member?.guild || !member?.id) return;
  const memberId = member.id;
  nametagPendingMembers.set(memberId, member);
  const existingTimer = nametagSyncTimers.get(memberId);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(async () => {
    nametagSyncTimers.delete(memberId);
    const latest = nametagPendingMembers.get(memberId);
    nametagPendingMembers.delete(memberId);
    try {
      if (latest) await syncTeamNametag(latest);
    } catch (error) {
      console.warn(`Automatischer Nametag für ${memberId} fehlgeschlagen: ${error.message}`);
    }
  }, delay);
  nametagSyncTimers.set(memberId, timer);
}

client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
  const trackedTeamListRoleIds = new Set([
    ...config.rankRoles.map(role => role.id),
    ...(config.teamListAdditionalRoles || []).map(role => role.id)
  ]);
  const changedRoleIds = new Set([...oldMember.roles.cache.keys(), ...newMember.roles.cache.keys()]);
  const teamRoleChanged = [...changedRoleIds].some(id =>
    trackedTeamListRoleIds.has(id) && oldMember.roles.cache.has(id) !== newMember.roles.cache.has(id)
  );
  if (teamRoleChanged) scheduleTeamListRefresh(newMember.guild);

  const currentRole = highestNicknameRole(newMember);
  const hasManagedState = Boolean(state.nametags[newMember.id]);
  if (!currentRole && !hasManagedState && !(config.roles.absent && newMember.roles.cache.has(config.roles.absent))) return;
  const desired = expectedRoleNickname(newMember);
  const oldRole = highestNicknameRole(oldMember);
  const roleChanged = oldRole?.role.id !== currentRole?.role.id;
  if (roleChanged || newMember.nickname !== desired) scheduleNametagSync(newMember);
});

client.on(Events.GuildMemberRemove, member => {
  if (config.rankRoles.some(role => member.roles.cache.has(role.id)) || (config.teamListAdditionalRoles || []).some(role => member.roles.cache.has(role.id))) {
    scheduleTeamListRefresh(member.guild);
  }
});

// Username changes are UserUpdate events, separate from nickname/role changes.
client.on(Events.UserUpdate, (oldUser, newUser) => {
  if (oldUser.username === newUser.username) return;
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;
  const member = guild.members.cache.get(newUser.id);
  if (member && (highestNicknameRole(member) || state.nametags[newUser.id] || (config.roles.absent && member.roles.cache.has(config.roles.absent)))) {
    scheduleNametagSync(member, 100);
  }
});

client.on(Events.GuildMemberAdd, member => {
  const isListedTeamMember = config.rankRoles.some(role => member.roles.cache.has(role.id)) || (config.teamListAdditionalRoles || []).some(role => member.roles.cache.has(role.id));
  if (isListedTeamMember) scheduleTeamListRefresh(member.guild);
  if (!member.user.bot && (highestNicknameRole(member) || (config.roles.absent && member.roles.cache.has(config.roles.absent)))) {
    scheduleNametagSync(member, 100);
  }
});

// If the server's role order changes, recalculate the winning display role for all managed members.
client.on(Events.GuildRoleUpdate, (oldRole, newRole) => {
  const guild = newRole.guild;
  const listed = config.rankRoles.some(item => item.id === newRole.id) || (config.teamListAdditionalRoles || []).some(item => item.id === newRole.id);
  if (listed) scheduleTeamListRefresh(guild);
  if (!nicknameRoleDefinitions().some(item => item.id === newRole.id)) return;
  syncAllTeamNametags(guild).catch(error => console.warn('Nametags nach Rollenänderung konnten nicht synchronisiert werden:', error.message));
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.guildId !== GUILD_ID) return replyError(interaction, 'Dieser Bot ist nicht für diesen Server konfiguriert.');
      switch (interaction.commandName) {
        case 'teammanagement': return handleTeamManagement(interaction);
        case 'bestanden': return handleBestanden(interaction);
        case 'uprank': return setMemberRank(interaction, 'up');
        case 'downrank': return setMemberRank(interaction, 'down');
        case 'teamwarn': return handleTeamWarn(interaction);
        case 'deletewarn': return handleDeleteWarn(interaction);
        case 'teamkick': return handleTeamKick(interaction);
        case 'rpstart': return handleRpStatus(interaction, true);
        case 'rpstop': return handleRpStatus(interaction, false);
        case 'servercode': return handleServerCode(interaction);
        case 'teamliste': return handleTeamList(interaction);
        case 'robloxid': return handleRobloxId(interaction);
        case 'robloxidpanel': return handleRobloxIdPanel(interaction);
        case 'robloxnamepanel': return handleRobloxNamePanel(interaction);
        case 'abmeldungspanel': return handleAbsencePanel(interaction);
        case 'embed': return handleCustomEmbed(interaction);
        case 'ticketpanel': return handleTicketPanel(interaction);
        case 'beschwerdepanel': return handleComplaintPanel(interaction);
        default: return;
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:select') {
      return handleTicketOpen(interaction, interaction.values[0]);
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'complaint:select') {
      return handleTicketOpen(interaction, interaction.values[0]);
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'absence:select') {
      return handleAbsenceButton(interaction, interaction.values[0]);
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'robloxname:select') {
      const member = await fetchInteractionMember(interaction);
      if (!member || !isTeamMember(member)) return replyError(interaction, 'Dieses Menü ist nur für Teammitglieder.');
      const modal = new ModalBuilder().setCustomId('robloxname:submit').setTitle('Roblox Namen Angeben');
      const input = new TextInputBuilder().setCustomId('robloxname').setLabel('Roblox-Benutzername').setPlaceholder('Gib hier deinen Roblox-Namen ein').setRequired(true).setMaxLength(50).setStyle(TextInputStyle.Short);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'teamlist:refresh') return handleTeamListRefresh(interaction);
      if (interaction.customId.startsWith('ticket:open:')) {
        return handleTicketOpen(interaction, interaction.customId.split(':')[2]);
      }
      if (interaction.customId.startsWith('ticket:claim:')) return handleTicketClaim(interaction, interaction.customId.split(':')[2]);
      if (interaction.customId.startsWith('ticket:close:')) return handleTicketClose(interaction, interaction.customId.split(':')[2]);
      if (interaction.customId.startsWith('ticket:release:')) return handleTicketRelease(interaction, interaction.customId.split(':')[2]);
      if (interaction.customId === 'robloxid:open') {
        const member = await fetchInteractionMember(interaction);
        if (!member || !canCheckRoblox(member)) return replyError(interaction, `Dafür benötigst du die Rolle <@&${config.roles.robloxAccess}>.`);
        const modal = new ModalBuilder().setCustomId('robloxid:submit').setTitle('Roblox-Profil prüfen');
        const input = new TextInputBuilder().setCustomId('benutzer').setLabel('Roblox-Benutzername oder ID').setPlaceholder('z. B. Builderman oder 156').setRequired(true).setStyle(TextInputStyle.Short);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }
      if (interaction.customId.startsWith('absence:')) return handleAbsenceButton(interaction, interaction.customId.split(':')[1]);
    }

    if (interaction.isModalSubmit() && interaction.customId === 'robloxid:submit') {
      const member = await fetchInteractionMember(interaction);
      if (!member || !canCheckRoblox(member)) return replyError(interaction, `Dafür benötigst du die Rolle <@&${config.roles.robloxAccess}>.`);
      await deferEphemeral(interaction);
      return sendRobloxProfile(interaction, interaction.fields.getTextInputValue('benutzer'));
    }
    if (interaction.isModalSubmit() && interaction.customId === 'absence:plan:submit') return handleAbsencePlanSubmit(interaction);
    if (interaction.isModalSubmit() && interaction.customId === 'robloxname:submit') return handleRobloxNameSubmit(interaction);

    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:submit:')) {
      const type = interaction.customId.split(':')[2];
      await interaction.deferReply({ ephemeral: true });
      return createTicketFromModal(interaction, type);
    }
  } catch (error) {
    console.error('Fehler bei Interaction:', error);
    await replyError(interaction, `Es ist ein Fehler aufgetreten: ${safeText(error.message || 'Unbekannter Fehler', 250)}`);
  }
});

process.on('unhandledRejection', error => console.error('Unhandled rejection:', error));
process.on('uncaughtException', error => console.error('Uncaught exception:', error));

client.login(TOKEN);
