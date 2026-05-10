'use strict';

const readline = require('readline');
const {
  printHelp, printStatus, printStats, printMainPanel,
  setReadline, setPanelRenderer, money, section, paint, colors,
  recentLogs, LOG_FILE,
} = require('../ui/logger');
const { parseMoney } = require('../utils/money');

class ConsoleController {
  constructor(config, bot, casino, logger) {
    this.config  = config;
    this.bot     = bot;
    this.casino  = casino;
    this.logger  = logger;

    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    this.rl.setPrompt('casino> ');

    this.panelTimer      = null;
    this.closed          = false;
    this.lastPanelAt     = 0;
    this.startedAt       = Date.now();
    this._feedbackSent   = false;

    this.rl.on('close', () => { this.closed = true; });
    setReadline(this.rl);
    if (this.config.panelEnabled) {
      setPanelRenderer((reason) => this._renderPanel(reason, { throttle: true }));
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  start() {
    this.rl.on('line', (input) => this._handleLine(input));
    this._renderPanel('start');
    if (this.config.panelEnabled) {
      this.panelTimer = setInterval(() => this._renderPanel('tick'), this.config.panelRefreshMs);
    }
  }

  stop() {
    this.bot.stop();
    if (this.panelTimer) clearInterval(this.panelTimer);
    if (!this.closed) this.rl.close();
    this.logger.log('INFO', 'Bot stopped. Goodbye.');
    process.exit(0);
  }

  // ── command dispatch ──────────────────────────────────────────────────────

  _handleLine(input) {
    const raw   = input.trim();
    const parts = raw.split(/\s+/).filter(Boolean);
    const cmd   = (parts.shift() || '').toLowerCase();
    this._feedbackSent = false;

    switch (cmd) {
      case '':
        break;

      case 'help':
        printHelp();
        break;

      case 'status':
        printStatus(this.config, this.bot.snapshot());
        break;

      case 'stats':
        printStats(this.casino.getStats());
        break;

      case 'panel':
      case 'refresh':
      case 'clear':
        this._renderPanel('manual');
        this._fb('Panel refreshed.');
        break;

      case 'games':
        this._printGames();
        break;

      case 'say':
        this._say(parts.join(' '));
        break;

      case 'command':
      case 'cmd':
        this._serverCommand(parts.join(' '));
        break;

      case 'msg':
        this._msg(parts);
        break;

      case 'pay':
        this._pay(parts);
        break;

      case 'balance':
      case 'bal':
        if (this.bot.requestBalance()) this._fb('Balance request sent.');
        else this._fb('Balance request NOT sent (bot offline or disabled).');
        break;

      case 'events':
        this._printEvents(parts[0]);
        break;

      case 'health':
        this._printHealth();
        break;

      case 'queue':
        this._printQueue();
        break;

      case 'config':
        this._handleConfig(parts);
        break;

      case 'cancel':
        this._cancelGame(parts[0]);
        break;

      case 'log':
        this._fb(`Current log file: ${LOG_FILE}`);
        break;

      case 'ideas':
        this._printIdeas();
        break;

      case 'reconnect':
        this.bot.reconnect();
        this._fb('Reconnect triggered.');
        break;

      case 'reload':
        this._reload();
        break;

      case 'stop':
      case 'exit':
      case 'quit':
        this.stop();
        return;

      default:
        this.logger.log('WARN', `Unknown command: "${cmd}". Type "help".`);
        break;
    }

    if (!this._feedbackSent) this._fb('Done.');
    this._prompt();
  }

  // ── individual command implementations ───────────────────────────────────

  _say(text) {
    if (!text) { this._fb('Usage: say <message>'); return; }
    const sent = this.bot.sendChat(text);
    this._fb(sent ? `Sent: ${text}` : 'Not connected.');
  }

  _serverCommand(text) {
    if (!text) { this._fb('Usage: command <cmd without />'); return; }
    const sent = this.bot.sendServerCommand(text);
    this._fb(sent ? `Command sent: /${text}` : 'Not connected.');
  }

  _msg(parts) {
    if (parts.length < 2) { this._fb('Usage: msg <player> <message>'); return; }
    const player  = parts.shift();
    const message = parts.join(' ');
    const sent    = this.bot.sendPrivateMessage(player, message);
    this._fb(sent ? `PM sent to ${player}: ${message}` : 'Not connected.');
  }

  _pay(parts) {
    if (parts.length < 2) { this._fb('Usage: pay <player> <amount>'); return; }
    const player = parts[0];
    const amount = parseMoney(parts[1]);
    if (amount == null || amount <= 0) { this._fb('Invalid amount.'); return; }
    const sent = this.bot.pay(player, amount);
    this._fb(sent ? `Pay sent: ${player} ${money(amount)}` : 'Not connected.');
  }

  _cancelGame(player) {
    if (!player) { this._fb('Usage: cancel <player>'); return; }
    const game = this.casino.cancelGame(player);
    if (game) this._fb(`Cancelled game for ${player}. Bet ${money(game.bet)} will be refunded.`);
    else this._fb(`No active game found for "${player}".`);
  }

  _printGames() {
    const games = this.casino.listActiveGames();
    if (!games.length) { console.log('  No active games.'); this._fb(''); return; }
    section('ACTIVE GAMES');
    games.forEach((g) => {
      const elapsed = Math.round((Date.now() - new Date(g.startedAt).getTime()) / 1000);
      console.log(`  ${paint(g.player.padEnd(20), colors.cyan)} Bet: ${money(g.bet).padEnd(15)} Running: ${elapsed}s`);
    });
    console.log('');
    this._fb('');
  }

  _printEvents(nStr) {
    const n    = Math.min(Math.max(parseInt(nStr, 10) || 20, 1), 60);
    const logs = recentLogs.slice(0, n);
    section(`LAST ${n} LOG ENTRIES`);
    if (!logs.length) { console.log('  (none)'); }
    logs.forEach((e) => {
      console.log(`  ${paint(e.time.toISOString().slice(11, 19), colors.dim)} ${e.level.padEnd(7)} ${e.message.substring(0, 100)}`);
    });
    console.log('');
    this._fb('');
  }

  _printHealth() {
    const snap = this.bot.snapshot();
    section('BOT HEALTH & FOOD');
    if (snap.health) {
      const h = snap.health;
      console.log(`  Health : ${h.health ?? '–'}  Food : ${h.food ?? '–'}  Saturation : ${h.saturation ?? '–'}`);
      if (h.heldItem) console.log(`  Held   : ${h.heldItem}`);
    } else {
      console.log('  (no health data)');
    }
    console.log('');
    this._fb('');
  }

  _printQueue() {
    const snap = this.bot.snapshot();
    section('OUTGOING QUEUE');
    console.log(`  Queue length : ${snap.queueLength}`);
    console.log('');
    this._fb('');
  }

  _handleConfig(parts) {
    if (!parts.length) {
      section('CONFIG SUMMARY');
      const keys = [
        ['host',              this.config.host],
        ['port',              this.config.port],
        ['username',          this.config.username],
        ['auth',              this.config.auth],
        ['version',           this.config.version],
        ['minBet',            money(this.config.minBet)],
        ['maxBet',            money(this.config.maxBet)],
        ['winChance',         `${Math.round(this.config.winChance * 100)}%`],
        ['payoutMultiplier',  this.config.payoutMultiplier],
        ['bankReserve',       money(this.config.bankReserve)],
        ['drawDelayMs',       `${this.config.drawDelayMs}ms`],
        ['playerCooldownMs',  `${this.config.playerCooldownMs}ms`],
        ['playerDailyLimit',  this.config.playerDailyLimit],
        ['casinoEnabled',     this.config.casinoEnabled],
        ['paymentsEnabled',   this.config.paymentsEnabled],
        ['balanceEnabled',    this.config.balanceEnabled],
      ];
      keys.forEach(([k, v]) => console.log(`  ${paint(String(k).padEnd(22), colors.bold)} ${v}`));
      console.log('');
      this._fb('');
      return;
    }

    if (parts[0] === 'set') {
      const key   = parts[1];
      const value = parts.slice(2).join(' ');
      if (!key || value === undefined) { this._fb('Usage: config set <key> <value>'); return; }
      const num = Number(value);
      if (key in this.config) {
        this.config[key]      = Number.isFinite(num) ? num : value;
        this.bot.config[key]  = this.config[key];
        this._fb(`config.${key} = ${this.config[key]}`);
      } else {
        this._fb(`Unknown config key: ${key}`);
      }
    } else {
      this._fb('Usage: config   OR   config set <key> <value>');
    }
  }

  _printIdeas() {
    section('TIPS & IDEAS');
    const tips = [
      'Use "config set winChance 0.35" to adjust win probability at runtime.',
      'Use "cancel <player>" to manually refund a stuck game.',
      'Use "reload" to hot-reload the config without disconnecting the bot.',
      'Use "events 30" to see the last 30 log events.',
      'Use "command money balance" to manually trigger a balance check.',
      'The bot supports Bedrock users – names with . or ! prefix work automatically.',
      'Check logs/ folder for full session logs including timestamps.',
    ];
    tips.forEach((t, i) => console.log(`  ${paint(String(i + 1).padEnd(3), colors.dim)} ${t}`));
    console.log('');
    this._fb('');
  }

  // ── hot reload ────────────────────────────────────────────────────────────

  _reload() {
    (async () => {
      try {
        // Reload config
        const configPath = require.resolve('../config');
        delete require.cache[configPath];
        const newConfig = require('../config');

        // Reload CasinoService
        const casinoPath = require.resolve('../casino/CasinoService');
        delete require.cache[casinoPath];
        const CasinoService = require('../casino/CasinoService');

        // Build new casino, migrate state
        const oldCasino = this.casino;
        const newCasino = new CasinoService(newConfig, this.logger);
        newCasino.activeGames    = oldCasino.activeGames    || new Map();
        newCasino.playerLimits   = oldCasino.playerLimits   || new Map();
        newCasino.tutorialPlayers= oldCasino.tutorialPlayers|| new Set();
        newCasino.recentEvents   = oldCasino.recentEvents   || [];
        newCasino.accountBalance = oldCasino.accountBalance;
        newCasino.stats          = { ...oldCasino.stats };

        // Swap references
        this.casino      = newCasino;
        this.bot.casino  = newCasino;
        this.config      = newConfig;
        this.bot.config  = newConfig;

        // Reload parser + utilities
        for (const mod of ['../utils/serverMessageParser', '../utils/text', '../utils/money']) {
          try { delete require.cache[require.resolve(mod)]; require(mod); } catch (_) {}
        }

        // Hot-swap bot methods
        try {
          const botPath = require.resolve('../core/MinecraftBot');
          delete require.cache[botPath];
          const NewBot = require('../core/MinecraftBot');
          const swapMethods = [
            'sendPrivateMessage', 'pay', 'handlePlayerChat',
            'handleCasinoSystemMessage', 'handleSystemChat',
          ];
          for (const name of swapMethods) {
            if (typeof NewBot.prototype[name] === 'function') {
              this.bot[name] = NewBot.prototype[name].bind(this.bot);
            }
          }
          this.logger.log('INFO', 'MinecraftBot methods hot-swapped.');
        } catch (err) {
          this.logger.log('WARN', `MinecraftBot hot-swap failed: ${err.message}`);
        }

        this._renderPanel('reload');
        this._fb('Reload successful: config, casino, and modules reloaded (bot stays connected).');
      } catch (err) {
        this.logger.log('ERROR', `Reload failed: ${err.message}`);
        this._fb(`Reload failed: ${err.message}`);
      }
    })();
  }

  // ── panel rendering ───────────────────────────────────────────────────────

  _renderPanel(reason, opts = {}) {
    if (opts.throttle) {
      const now = Date.now();
      if (now - this.lastPanelAt < 500) return false;
      this.lastPanelAt = now;
    }
    try {
      const snap  = this.bot.snapshot();
      const stats = this.casino.getStats();
      printMainPanel(this.config, snap, stats, recentLogs, Date.now() - this.startedAt);
      this._prompt();
      return true;
    } catch (_) {
      return false;
    }
  }

  _prompt() {
    try { this.rl.prompt(true); } catch (_) {}
  }

  _fb(msg) {
    this._feedbackSent = true;
    if (msg) this.logger.log('CMD', msg);
  }
}

module.exports = ConsoleController;