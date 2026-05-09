# Minecraft Casino Bot

Open-Source Casino-Bot fuer Minecraft Java Server. Der Bot ist komplett ueber YAML konfigurierbar und nicht mehr an HugoSMP gebunden. Du kannst HugoSMP, BlockBande oder jeden anderen Java-Server in `configs/config.yml` eintragen.

## Voraussetzungen

- Node.js 18 oder neuer
- Ein Minecraft Java Account fuer `auth: microsoft`
- Zugriff auf einen Server, auf dem Chat, private Nachrichten und Economy-Befehle erlaubt sind

## Installation

```powershell
npm install
Copy-Item configs/config.example.yml configs/config.yml
npm start
```

Beim ersten Start mit `auth: microsoft` zeigt der Bot einen Login-Code. Oeffne den angezeigten Link, melde dich mit deinem Microsoft-/Minecraft-Account an und bestaetige den Code.

## Ordnerstruktur

```text
configs/
  config.yml             Deine aktive Konfiguration
  config.example.yml     Vollstaendige Vorlage
  servers/               Optionale ausgelagerte Serverprofile
src/
  config/                YAML-Loader
  core/                  Minecraft-Verbindung und Protokollhandler
  casino/                Casino-Logik
  console/               Konsolenbefehle
  ui/                    Konsolenausgabe
```

## Einen Server Auswaehlen

In `configs/config.yml` steht der aktive Server:

```yaml
profile:
  active: blockbande
```

Der Name muss unter `serverProfiles` existieren:

```yaml
serverProfiles:
  blockbande:
    server:
      host: blockbande.de
      port: 25565
      version: auto
      fallbackVersion: "1.21.4"
```

Zum Wechseln setzt du nur `profile.active` auf ein anderes Profil, zum Beispiel `hugosmp` oder `meinserver`.

## Eigenen Server Hinzufuegen

Fuege unter `serverProfiles` einen neuen Block ein:

```yaml
serverProfiles:
  meinserver:
    server:
      host: play.meinserver.net
      port: 25565
      version: auto
      fallbackVersion: "1.21.8"
    commands:
      money: "/money"
      pay: "/pay {player} {amount}"
      privateMessage: "/msg {player} {message}"
      chatPrefix: "[BOT]"
      join:
        # - "/server citybuild"
      joinMessages:
        # - "Casino Bot online."
    parser:
      privateMessagePatterns: []
      paymentPatterns: []
      balancePatterns: []
```

Danach:

```yaml
profile:
  active: meinserver
```

Wenn ein Server andere Befehle nutzt, passt du nur `commands` an:

```yaml
commands:
  money: "/balance"
  pay: "/money pay {player} {amount}"
  privateMessage: "/tell {player} {message}"
```

## Chat- Und Economy-Parser

Jeder Server formatiert Zahlungen anders. Wenn der Bot Einzahlungen, Kontostand oder private Nachrichten nicht erkennt, trage Regex-Patterns ein.

```yaml
parser:
  paymentPatterns:
    - "^(?<player>[A-Za-z0-9_]{3,16}) hat dir (?<amount>[0-9.,]+) Coins gesendet"
  balancePatterns:
    - "^Coins: (?<amount>[0-9.,]+)"
  privateMessagePatterns:
    - "^Von (?<player>[A-Za-z0-9_]{3,16}): (?<message>.+)$"
```

Wichtige Gruppen:

- `player`: Minecraft-Name des Spielers
- `amount`: Geldbetrag
- `message`: Inhalt der privaten Nachricht

## Plugin- Und Anticheat-Channels

Manche Server fragen Plugin-Channels ab. Diese Antworten sind pro Server konfigurierbar:

```yaml
minecraftClient:
  pluginChannels:
    register:
      - example:main
      - example:check
    checks:
      - example:check
    aliases:
      example: example
    responseValue: 1
```

## Account Und Auth

```yaml
account:
  username: DeinBotName
  auth: microsoft
```

Bei `auth: microsoft` muss der angemeldete Microsoft-Account den Minecraft Java Namen aus `username` besitzen. Fuer Offline-/Cracked-Server kannst du `auth: offline` setzen.

## Casino Einstellen

Systeme kannst du einzeln aktivieren oder deaktivieren:

```yaml
systems:
  casino: true
  payments: true
  privateMessages: true
  balance: true
  passiveBalance: false
  antiCheat: true
  autoBalanceOnJoin: true
  panel: true
  panelRefreshMs: 5000
  balanceAcceptWindowMs: 15000
```

`passiveBalance: false` ist absichtlich der sichere Standard. Der Bot akzeptiert Kontostand-Zeilen dann nur kurz nach einer eigenen `/money`-Abfrage. Dadurch werden Servermeldungen wie `Du hast 250$ an Spieler gezahlt` nicht mehr falsch als Bot-Kontostand gespeichert.

```yaml
casino:
  minBet: 10000
  maxBet: 1000000
  winChance: 0.30
  payoutMultiplier: 2
  playerCooldownMs: 10000
  playerDailyLimit: 20
  reserve: 1000000
  requireKnownBalance: true
```

Der Bot nutzt kein getrenntes Bank-System mehr. Es zaehlt nur der echte Kontostand aus `commands.money`, also zum Beispiel `/money balance`.

Die Reserve bleibt immer auf dem Bot-Konto. Beispiel: Der Account hat `2.000.000$` und `reserve: 1000000`. Dann sind `1.000.000$` spielbar. Wenn ein Gewinn oder eine Rueckzahlung den Kontostand unter `1.000.000$` druecken wuerde, nimmt der Bot das Spiel nicht an oder zahlt den Einsatz zurueck.

Wichtig: `requireKnownBalance: true` sorgt dafuer, dass der Bot vor Spielen einen bekannten Kontostand braucht. Ist der Kontostand unbekannt, fragt er `/money balance` ab und zahlt den Einsatz sicher zurueck.

## Setup Tutorial

1. Installiere die Abhaengigkeiten:

```powershell
npm install
```

2. Kopiere die Beispiel-Konfiguration:

```powershell
Copy-Item configs/config.example.yml configs/config.yml
```

3. Trage in `configs/config.yml` deinen Bot-Account ein:

```yaml
account:
  username: DeinBotName
  auth: microsoft
```

4. Waehle oder erstelle ein Serverprofil:

```yaml
profile:
  active: blockbande
```

5. Passe die Economy-Befehle an deinen Server an:

```yaml
commands:
  money: "/money"
  pay: "/pay {player} {amount}"
  privateMessage: "/msg {player} {message}"
```

6. Stelle Einsatz, Gewinnchance und Reserve ein:

```yaml
casino:
  minBet: 100
  maxBet: 1000
  winChance: 0.30
  payoutMultiplier: 2
  reserve: 1000000
  requireKnownBalance: true
```

7. Starte den Bot:

```powershell
npm start
```

8. Frage nach dem Join einmal den Kontostand ab:

```text
balance
```

Danach zeigt das Panel `Kontostand`, `Reserve` und `Spielbar`. Die Live-Logs im Panel aktualisieren sich automatisch.

## Nutzung Im Spiel

Spieler schreiben dem Bot eine private Nachricht, um die Anleitung zu bekommen:

```text
/msg DeinBotName info
```

Zum Spielen senden sie Geld an den Bot:

```text
/pay DeinBotName 10000
```

Die Befehle sind serverabhaengig und kommen aus dem aktiven Profil.

## Konsolenbefehle

```text
help
status
stats
games
health
queue
config
config set <key> <wert>
say <text>
msg <name> <text>
pay <name> <betrag>
balance
events
panel
cancel <spieler>
reconnect
stop
```

## Start Mit Anderer Config

Aktives Profil einmalig per Terminal setzen:

```powershell
$env:CONFIG_PROFILE="hugosmp"
npm start
```

Komplett andere Config-Datei nutzen:

```powershell
$env:CONFIG_PATH="C:\Pfad\zu\config.yml"
npm start
```

## Optional: Ausgelagerte Serverprofile

Wenn `serverProfiles.<name>` nicht in `configs/config.yml` existiert, sucht der Bot automatisch nach:

```text
configs/servers/<name>.yml
```

Das ist praktisch, wenn du sehr viele Serverprofile getrennt versionieren willst. Fuer einfache Setups reicht eine einzige `configs/config.yml`.

## Pruefen

```powershell
npm run check
```
