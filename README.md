# Bitcoin RP Discord Bot – Version 1.6.1

## Änderungen dieser Version
- Servercode wird als Embed mit Titel `SERVERCODE` und den gespeicherten Codes ausgegeben; keine Kopieranleitung.
- Teamliste aktualisiert sich automatisch bei relevanten Rollenänderungen, zeigt alle konfigurierten Teamränge mit Abstand und enthält einen grauen Button „Teamliste aktualisieren“.
- Haupt-Ticketmenü: Fraktion, Waffenschein und Entbannung.
- Eigenes Beschwerde-Dropdown in Kanal `1564975776812498981`: Allgemeine Beschwerde und Teambeschwerde.
- Die gewünschten Paneltexte sind kurz und ohne Emojis.
- Roblox-ID-Checker mit kurzem Hinweis und Button.
- Roblox-Namen-Panel: Teammitglieder können den Roblox-Namen über ein Modal eintragen; der Bot veröffentlicht Benutzername, Anzeigename und ID.
- Abmeldungspanel mit Dropdown, Protokollierung und Sticky-Aktualisierung.
- Ticket-Claim kann freigegeben werden; die Freigabe wird als eigene Nachricht im Ticket angezeigt. Danach kann ein anderes Teammitglied übernehmen.
- Keine automatisch angehängten KI-/Branding-Bilder.

## Wichtige Slash-Commands
- `/ticketpanel` – veröffentlicht das Haupt-Ticketmenü und das separate Beschwerde-Menü.
- `/beschwerdepanel` – aktualisiert nur das Beschwerde-Menü.
- `/robloxidpanel` – veröffentlicht den Roblox-ID-Checker.
- `/robloxnamepanel` – veröffentlicht das Roblox-Namen-Menü.
- `/abmeldungspanel` – veröffentlicht und pinnt das Abmeldungspanel.

## Bestehende IDs
- Guild: `1564975773473972294`
- Servercode: `1564975775290097664`
- RP-Status: `1564975775290097665`
- Teamliste: `1564975775290097670`
- Ticketpanel: `1564975776812498980`
- Ticket-Logs / Discord-Logs: `1564975778536620168`
- Beschwerde-Panel: `1564975776812498981`
- Roblox-ID-Checker: `1564975777584390254`
- Roblox-Namen: `1564975777978519613`
- Abmeldung: `1564975777978519614`

## Installation
1. Bestehende `.env` und `data/state.json` / `data/tickets.json` beibehalten.
2. `npm install`
3. `npm run deploy`
4. `npm start`

Der Bot benötigt Server Members Intent sowie die Discord-Berechtigungen, die für die aktivierten Funktionen verwendet werden: Rollen verwalten, Spitznamen verwalten, Kanäle verwalten, Nachrichten senden, Embeds, Dateien anhängen, Nachrichtenverlauf lesen und Nachrichten verwalten (für Sticky-Panels).

## Update 1.6.1
- Das Beschwerde-Panel wird in `1564975776812498981` veröffentlicht; ein altes Panel im Haupt-Ticketkanal wird beim Aktualisieren entfernt.
- Ticket-Transcripts werden in `1564975778536620168` gespeichert.
- Freigabe eines Tickets sendet eine eigene Nachricht mit Freigeber und vorherigem Bearbeiter.
- Servercode wird als Embed veröffentlicht.
- Teamliste hat größere Abstände und einen grauen Button zur manuellen Aktualisierung; automatische Aktualisierung bleibt aktiv.
