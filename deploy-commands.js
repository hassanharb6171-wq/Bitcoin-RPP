require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');
const config = require('./config.json');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID || config.guildId;
if (!token || !clientId || !guildId) {
  console.error('Bitte DISCORD_TOKEN, CLIENT_ID und GUILD_ID in deiner .env-Datei eintragen.');
  process.exit(1);
}

const colorChoices = [
  { name: 'Gold', value: 'gold' }, { name: 'Silber', value: 'silber' },
  { name: 'Blau', value: 'blau' }, { name: 'Rot', value: 'rot' },
  { name: 'Grün', value: 'gruen' }, { name: 'Lila', value: 'lila' },
  { name: 'Schwarz', value: 'schwarz' }
];
const warnDurations = [
  { name: '1 Stunde', value: '1h' }, { name: '6 Stunden', value: '6h' },
  { name: '12 Stunden', value: '12h' }, { name: '1 Tag', value: '1d' },
  { name: '2 Tage', value: '2d' }, { name: '3 Tage', value: '3d' },
  { name: '7 Tage', value: '7d' }, { name: '14 Tage', value: '14d' },
  { name: '30 Tage', value: '30d' }
];

const commands = [
  new SlashCommandBuilder().setName('teammanagement').setDescription('Verwaltet Team-Rangrollen.')
    .addSubcommand(s => s.setName('add').setDescription('Fügt einem Mitglied einen Teamrang hinzu.')
      .addUserOption(o => o.setName('mitglied').setDescription('Mitglied').setRequired(true))
      .addRoleOption(o => o.setName('rolle').setDescription('Zuzuweisender Teamrang').setRequired(true))
      .addStringOption(o => o.setName('grund').setDescription('Grund der Änderung').setRequired(false)))
    .addSubcommand(s => s.setName('remove').setDescription('Entfernt einen Teamrang von einem Mitglied.')
      .addUserOption(o => o.setName('mitglied').setDescription('Mitglied').setRequired(true))
      .addRoleOption(o => o.setName('rolle').setDescription('Zu entfernender Teamrang').setRequired(true))
      .addStringOption(o => o.setName('grund').setDescription('Grund der Änderung').setRequired(false))),
  new SlashCommandBuilder().setName('uprank').setDescription('Befördert ein Teammitglied auf einen ausgewählten Rang.')
    .addUserOption(o => o.setName('mitglied').setDescription('Teammitglied').setRequired(true))
    .addRoleOption(o => o.setName('neuer_rang').setDescription('Neuer höherer Teamrang').setRequired(true))
    .addStringOption(o => o.setName('grund').setDescription('Grund der Beförderung').setRequired(false)),
  new SlashCommandBuilder().setName('downrank').setDescription('Setzt ein Teammitglied auf einen ausgewählten niedrigeren Rang.')
    .addUserOption(o => o.setName('mitglied').setDescription('Teammitglied').setRequired(true))
    .addRoleOption(o => o.setName('neuer_rang').setDescription('Neuer niedrigerer Teamrang').setRequired(true))
    .addStringOption(o => o.setName('grund').setDescription('Grund der Herabstufung').setRequired(false)),
  new SlashCommandBuilder().setName('bestanden').setDescription('Vergibt die Bestanden-Rolle und optionale Zusatzrollen.')
    .addUserOption(o => o.setName('mitglied').setDescription('Mitglied, das bestanden hat').setRequired(true))
    .addRoleOption(o => o.setName('rolle').setDescription('Hauptrolle').setRequired(true))
    .addRoleOption(o => o.setName('zusatzrolle1').setDescription('Optionale Zusatzrolle 1').setRequired(false))
    .addRoleOption(o => o.setName('zusatzrolle2').setDescription('Optionale Zusatzrolle 2').setRequired(false))
    .addRoleOption(o => o.setName('zusatzrolle3').setDescription('Optionale Zusatzrolle 3').setRequired(false))
    .addStringOption(o => o.setName('grund').setDescription('Optionaler Vermerk').setRequired(false)),
  new SlashCommandBuilder().setName('teamwarn').setDescription('Erteilt eine zeitlich begrenzte Teamverwarnung.')
    .addUserOption(o => o.setName('mitglied').setDescription('Teammitglied').setRequired(true))
    .addStringOption(o => o.setName('grund').setDescription('Grund der Verwarnung').setRequired(true))
    .addStringOption(o => o.setName('dauer').setDescription('Wie lange soll die Warnung aktiv bleiben?').setRequired(true).addChoices(...warnDurations)),
  new SlashCommandBuilder().setName('deletewarn').setDescription('Entfernt alle aktiven Teamwarns eines Mitglieds.')
    .addUserOption(o => o.setName('mitglied').setDescription('Mitglied').setRequired(true)),
  new SlashCommandBuilder().setName('teamkick').setDescription('Entfernt ein Mitglied aus dem RP-Team.')
    .addUserOption(o => o.setName('mitglied').setDescription('Teammitglied').setRequired(true))
    .addStringOption(o => o.setName('grund').setDescription('Grund des Teamkicks').setRequired(true)),
  new SlashCommandBuilder().setName('rpstart').setDescription('Startet das Roleplay mit dem gespeicherten Servercode.'),
  new SlashCommandBuilder().setName('rpstop').setDescription('Beendet das Roleplay.'),
  new SlashCommandBuilder().setName('servercode').setDescription('Speichert die Servercodes für /rpstart.')
    .addStringOption(o => o.setName('server1').setDescription('Code für Server 1').setRequired(true).setMaxLength(32))
    .addStringOption(o => o.setName('server2').setDescription('Optionaler Code für Server 2').setRequired(false).setMaxLength(32)),
  new SlashCommandBuilder().setName('teamliste').setDescription('Aktualisiert die übersichtliche Teamliste.')
    .addStringOption(o => o.setName('farbe').setDescription('Farbe der Teamliste').setRequired(true).addChoices(...colorChoices)),
  new SlashCommandBuilder().setName('robloxid').setDescription('Zeigt öffentliche Informationen zu einem Roblox-Benutzer.')
    .addStringOption(o => o.setName('benutzer').setDescription('Roblox-Benutzername oder Roblox-ID').setRequired(true)),
  new SlashCommandBuilder().setName('robloxidpanel').setDescription('Veröffentlicht das Roblox-ID-Checker-Panel im Roblox-ID-Kanal.'),
  new SlashCommandBuilder().setName('robloxnamepanel').setDescription('Veröffentlicht das Roblox-Namen-Menü für Teammitglieder.'),
  new SlashCommandBuilder().setName('abmeldungspanel').setDescription('Veröffentlicht das Team-Abmeldungspanel in diesem Kanal.'),
  new SlashCommandBuilder().setName('embed').setDescription('Erstellt ein Embed mit auswählbarer Farbe und optionalem Bild.')
    .addStringOption(o => o.setName('titel').setDescription('Titel des Embeds').setRequired(true).setMaxLength(256))
    .addStringOption(o => o.setName('text').setDescription('Inhalt des Embeds').setRequired(true).setMaxLength(4000))
    .addStringOption(o => o.setName('farbe').setDescription('Embed-Farbe').setRequired(true).addChoices(...colorChoices))
    .addAttachmentOption(o => o.setName('bild').setDescription('Optionales Bild hochladen').setRequired(false))
    .addChannelOption(o => o.setName('kanal').setDescription('Zielkanal; leer = aktueller Kanal').addChannelTypes(ChannelType.GuildText).setRequired(false)),
  new SlashCommandBuilder().setName('ticketpanel').setDescription('Veröffentlicht Ticket- und Beschwerde-Menü.'),
  new SlashCommandBuilder().setName('beschwerdepanel').setDescription('Veröffentlicht nur das Beschwerde-Menü.')
].map(c => c.toJSON());

(async () => {
  try {
    const rest = new REST({ version: '10' }).setToken(token);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log(`${commands.length} Slash-Commands wurden in Bitcoin RP registriert.`);
  } catch (error) {
    console.error('Command-Registrierung fehlgeschlagen:', error);
    process.exitCode = 1;
  }
})();
