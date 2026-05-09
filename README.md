# Minecraft Casino Bot

Ein Node.js Casino-Bot fuer Minecraft Java Server. Der Bot meldet sich per Microsoft-Account an, bleibt online, beantwortet private Nachrichten und verarbeitet Casino-Einsaetze ueber `/pay`.

## Start

```powershell
npm start
```

Beim ersten Start zeigt Microsoft einen Login-Code an. Oeffne den Link, melde dich mit dem Minecraft Java Account an und bestaetige den Code.

Wichtig: Der angemeldete Microsoft-Account muss den Minecraft Java Namen `Einfachlucaa` besitzen. Wenn Microsoft nach dem Login einen anderen Profilnamen liefert, war der falsche Account angemeldet.

## Nutzung im Spiel

```text
/msg EinfachLucaa !help
/pay EinfachLucaa 10000
```

Wenn ein Spieler dem Bot irgendeine private Nachricht schreibt, antwortet der Bot mit einer Casino-Erklaerung. Bei `!help` sendet er eine kurze Anleitung.

Regeln:

```text
Mindesteinsatz: 10.000$
Maximaleinsatz: 1.000.000$
Gewinnchance: 30%
Gewinn: 2x Einsatz
Cooldown: 30 Sekunden pro Spieler
Tageslimit: 20 Spiele pro Spieler
Bankreserve: 2.000.000$
```

Ungueltige Einsaetze werden automatisch zurueckgezahlt. Wenn die Bank nicht genug Geld fuer die moegliche Auszahlung hat oder die Reserve unterschritten wuerde, wird der Einsatz ebenfalls zurueckgezahlt.

## Konsolenbefehle

```text
help
status
stats
bank
setbank <betrag>
games
health
queue
config
ideas
say <text>
msg <name> <text>
pay <name> <betrag>
balance
events
reconnect
stop
```

## Konfiguration

Defaults stehen in `src/config/index.js`. Du kannst sie ueber Umgebungsvariablen ueberschreiben:

```powershell
$env:MC_USERNAME="Einfachlucaa"
$env:MC_HOST="java.hugosmp.net"
$env:MC_PORT="25565"
$env:MC_VERSION="1.21.8"
$env:CASINO_MIN_BET="10000"
$env:CASINO_MAX_BET="1000000"
$env:CASINO_WIN_CHANCE="0.30"
$env:CASINO_PLAYER_COOLDOWN_MS="30000"
$env:CASINO_PLAYER_DAILY_LIMIT="20"
$env:CASINO_BANK_RESERVE="2000000"
npm start
```

Der Bot fragt beim Join mit `/money` seinen Kontostand ab. Falls dein Server den Kontostand anders formatiert und der Bot die Bank nicht erkennt, nutze in der Konsole:

```text
setbank <betrag>
```

Auto-Essen ist standardmaessig aktiv. Der Bot trackt Herzen/Hunger und versucht Essen aus der Hotbar zu nutzen, wenn Hunger oder Herzen niedrig sind. Essen im Inventar wird erkannt; fuer zuverlaessiges Auto-Essen sollte es in Slot 1-9 liegen.

## Struktur

```text
bot.js                       Startpunkt
src/config/index.js          Konfiguration
src/core/MinecraftBot.js     Verbindung, Reconnect, Chat, Protokollhandler
src/casino/CasinoService.js  Casino-Logik und Statistik
src/console/ConsoleController.js
src/ui/logger.js             Konsolenausgabe
src/utils/text.js            Minecraft-Textparser
```

## Pruefung

```powershell
npm run check
```
