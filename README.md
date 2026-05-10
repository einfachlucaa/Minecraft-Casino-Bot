# Minecraft Casino Bot

An open-source casino bot for Minecraft Java servers. Fully configurable via YAML and not tied to any specific server — you can use HugoSMP, BlockBande, or any other Java server by editing `configs/config.yml`.

---

## Requirements

- Node.js 18 or newer
- A Minecraft Java account (for `auth: microsoft`)
- Access to a server that allows chat, private messages, and economy commands

---

## Installation

### 1. Install dependencies

```powershell
npm install
```

### 2. Copy the example config

```powershell
Copy-Item configs/config.example.yml configs/config.yml
```

### 3. Set your bot account

Open `configs/config.yml` and enter your bot account:

```yaml
account:
  username: YourBotName
  auth: microsoft
```

> With `auth: microsoft`, the bot will display a login code on first start.  
> Open the shown link, sign in with your Microsoft/Minecraft account, and confirm the code.  
> For offline/cracked servers, use `auth: offline` instead.

### 4. Select or create a server profile

```yaml
profile:
  active: blockbande
```

The name must exist under `serverProfiles`. Example built-in profile:

```yaml
serverProfiles:
  blockbande:
    server:
      host: blockbande.de
      port: 25565
      version: auto
      fallbackVersion: "1.21.4"
```

### 5. Adjust economy commands for your server

```yaml
commands:
  money: "/money"
  pay: "/pay {player} {amount}"
  privateMessage: "/msg {player} {message}"
```

### 6. Configure bet limits, win chance, and reserve

```yaml
casino:
  minBet: 100
  maxBet: 1000
  winChance: 0.30
  payoutMultiplier: 2
  reserve: 1000000
  requireKnownBalance: true
```

### 7. Start the bot

```powershell
npm start
```

### 8. Fetch the balance after joining

In the bot console, type:

```
balance
```

The panel will then display **Balance**, **Reserve**, and **Playable**. Live logs update automatically.

---

## Folder Structure

```
configs/
  config.yml             Your active configuration
  config.example.yml     Full template with all options
  servers/               Optional separate server profiles
src/
  config/                YAML loader
  core/                  Minecraft connection and protocol handler
  casino/                Casino logic
  console/               Console commands
  ui/                    Console output / panel
```

---

## Adding a Custom Server

Add a new block under `serverProfiles` in `configs/config.yml`:

```yaml
serverProfiles:
  myserver:
    server:
      host: play.myserver.net
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

Then activate it:

```yaml
profile:
  active: myserver
```

If the server uses different command formats, just adjust `commands`:

```yaml
commands:
  money: "/balance"
  pay: "/money pay {player} {amount}"
  privateMessage: "/tell {player} {message}"
```

---

## Chat and Economy Parsers

Every server formats payment and balance messages differently. If the bot fails to detect deposits, balances, or private messages, add regex patterns:

```yaml
parser:
  paymentPatterns:
    - "^(?<player>[A-Za-z0-9_]{3,16}) sent you (?<amount>[0-9.,]+) Coins"
  balancePatterns:
    - "^Coins: (?<amount>[0-9.,]+)"
  privateMessagePatterns:
    - "^From (?<player>[A-Za-z0-9_]{3,16}): (?<message>.+)$"
```

**Required capture groups:**

| Group | Meaning |
|-------|---------|
| `player` | Minecraft username of the player |
| `amount` | Monetary amount |
| `message` | Content of the private message |

---

## Plugin and Anti-Cheat Channels

Some servers query plugin channels. Responses are configurable per server profile:

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

---

## Casino Settings

Enable or disable individual systems:

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

> `passiveBalance: false` is the safe default. The bot only accepts balance lines shortly after its own `/money` query, preventing server messages like `You paid 250$ to PlayerName` from being misread as the bot's balance.

**Casino parameters explained:**

```yaml
casino:
  minBet: 10000          # Minimum bet amount
  maxBet: 1000000        # Maximum bet amount
  winChance: 0.30        # Win probability (0.30 = 30%)
  payoutMultiplier: 2    # Win pays out this multiple of the bet
  playerCooldownMs: 10000  # Cooldown between bets per player (ms)
  playerDailyLimit: 20   # Max games per player per day
  reserve: 1000000       # Amount always kept in the bot's account
  requireKnownBalance: true  # Require a known balance before accepting bets
```

**How the reserve works:**  
The bot has no separate bank system — it uses the real account balance from `commands.money` (e.g. `/money balance`). The reserve is always kept on the account. Example: if the account has `2,000,000$` and `reserve: 1000000`, then `1,000,000$` is playable. If a payout would push the balance below the reserve, the bot refuses the game or refunds the bet.

**`requireKnownBalance: true`** ensures the bot checks its balance before accepting bets. If the balance is unknown, it queries `/money balance` and safely refunds the bet until the balance is confirmed.

---

## In-Game Usage for Players

Players send a private message to the bot to receive instructions:

```
/msg YourBotName info
```

To place a bet, they send coins directly to the bot:

```
/pay YourBotName 10000
```

The exact commands depend on the active server profile.

---

## Console Commands

| Command | Description |
|---------|-------------|
| `help` | Show all available commands |
| `status` | Show bot connection status |
| `stats` | Show win/loss statistics |
| `games` | Show active or recent games |
| `health` | Show bot health info |
| `queue` | Show the current bet queue |
| `config` | Show current configuration |
| `config set <key> <value>` | Update a config value at runtime |
| `say <text>` | Send a public chat message |
| `msg <name> <text>` | Send a private message to a player |
| `pay <name> <amount>` | Pay a player |
| `balance` | Fetch and display the current balance |
| `events` | Show recent events/logs |
| `panel` | Toggle or refresh the dashboard panel |
| `cancel <player>` | Cancel an active game for a player |
| `reconnect` | Reconnect to the server |
| `stop` | Stop the bot |

---

## Starting With a Different Config

**Set the active profile once via terminal (temporary):**

```powershell
$env:CONFIG_PROFILE="hugosmp"
npm start
```

**Use a completely different config file:**

```powershell
$env:CONFIG_PATH="C:\Path\to\config.yml"
npm start
```

---

## Optional: Separate Server Profile Files

If a profile is not found in `configs/config.yml`, the bot automatically looks for:

```
configs/servers/<name>.yml
```

This is useful when managing many server profiles separately. For simple setups, a single `configs/config.yml` is sufficient.

---

## Lint / Type Check

```powershell
npm run check
```

---

## License

This project is open-source. See `LICENSE` for details.
