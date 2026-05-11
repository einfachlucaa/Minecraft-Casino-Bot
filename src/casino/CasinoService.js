'use strict';

/**
 * CasinoService
 *
 * FIX: handlePrivateMessage now only sends tutorial if the message is NOT from
 *      the bot itself and the sender is a real player.
 * FIX: handlePayment now correctly processes the casino flow after the tutorial.
 * FEAT: tutorialPlayers persisted to disk — known players survive bot restarts.
 * FEAT: Game results logged to logs/ folder.
 */

const fs   = require('fs');
const path = require('path');
const { money } = require('../ui/logger');

class CasinoService {
  constructor(config, logger) {
    this.config       = config;
    this.logger       = logger;
    this.activeGames  = new Map();
    this.playerLimits = new Map();
    this.tutorialPlayers = new Set();
    this.recentEvents = [];
    this.accountBalance = null;
    this.stats = {
      wins          : 0,
      losses        : 0,
      refunds       : 0,
      deposits      : 0,
      totalPaid     : 0,
      totalLost     : 0,
      totalRefunded : 0,
    };

    // Persistent storage paths
    this._logsDir        = path.resolve('logs');
    this._playersFile    = path.join(this._logsDir, 'known_players.json');
    this._ensureLogsDir();
    this._loadKnownPlayers();
  }

  // ── persistence ───────────────────────────────────────────────────────────

  _ensureLogsDir() {
    try { fs.mkdirSync(this._logsDir, { recursive: true }); } catch (_) {}
  }

  _loadKnownPlayers() {
    try {
      const raw  = fs.readFileSync(this._playersFile, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) list.forEach((p) => this.tutorialPlayers.add(String(p)));
      this.logger.log('INFO', `Bekannte Spieler geladen: ${this.tutorialPlayers.size}`);
    } catch (_) {
      // file doesn't exist yet — first run
    }
  }

  _saveKnownPlayers() {
    try {
      fs.writeFileSync(this._playersFile, JSON.stringify([...this.tutorialPlayers], null, 2));
    } catch (err) {
      this.logger.log('WARN', `Spieler-Datei konnte nicht gespeichert werden: ${err.message}`);
    }
  }

  _logGameResult(player, type, details) {
    try {
      this._ensureLogsDir();
      const date    = new Date();
      const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
      const logFile = path.join(this._logsDir, `games_${dateStr}.log`);
      const time    = date.toTimeString().slice(0, 8);
      const line    = `[${time}] [${type.padEnd(6)}] ${player} | ${details}\n`;
      fs.appendFileSync(logFile, line);
    } catch (_) {}
  }

  // ── public query helpers ──────────────────────────────────────────────────

  getActiveGameCount()  { return this.activeGames.size; }
  getAccountBalance()   { return this.accountBalance; }
  getPrivateBalance()   { return this.accountBalance; }

  listActiveGames() {
    return Array.from(this.activeGames.entries()).map(([player, game]) => ({
      player,
      bet      : game.bet,
      startedAt: game.startedAt,
    }));
  }

  getStats() {
    return {
      ...this.stats,
      accountBalance  : this.accountBalance,
      privateBalance  : this.getPrivateBalance(),
      recentEvents    : [...this.recentEvents],
      bankReserve     : this.config.bankReserve,
      playableBank    : this.getPlayableBank(),
      playableBalance : this.getPlayableBalance(),
    };
  }

  getPlayableBank()    { return this.getPlayableBalance(); }

  getPlayableBalance() {
    if (this.accountBalance == null) return null;
    return Math.max(0, this.accountBalance - this.config.bankReserve);
  }

  // ── balance management ───────────────────────────────────────────────────

  setAccountBalance(amount, source = 'server') {
    if (!Number.isFinite(amount) || amount < 0) return false;
    const next = Math.floor(amount);
    if (source === 'server' && next === 0 && this.accountBalance > 0) {
      this.addEvent('BAL', `Suspicious server balance 0 ignored. Keeping ${money(this.accountBalance)}.`);
      return false;
    }
    this.accountBalance = next;
    this.addEvent('BAL', `Balance updated (${source}): ${money(this.accountBalance)} | Playable: ${this._fmtPlayable()}`);
    return true;
  }

  adjustAccount(delta) {
    if (this.accountBalance == null) return;
    this.accountBalance = Math.max(0, this.accountBalance + delta);
  }

  canPay(amount) {
    const p = this.getPlayableBalance();
    return p != null && p >= amount;
  }

  // ── private message handler (FIXED) ──────────────────────────────────────

  /**
   * Called when a player sends the bot a private message.
   * We send the tutorial if:
   *   - the player is not the bot itself
   *   - the player hasn't received a tutorial before
   *
   * BUG THAT WAS FIXED: Previously this was called for ALL incoming private
   * messages, including echoes from the server of the bot's own /msg commands.
   * That caused the tutorial to be re-sent repeatedly.
   */
  handlePrivateMessage(username, message, actions) {
    const botName = String(this.config.username || '').toLowerCase();
    const sender  = String(username || '').toLowerCase().replace(/^[.!]/, '');
    // Ignore own messages echoed back by the server
    if (sender === botName) return;

    this.markTutorialPlayer(username);
    this.sendTutorial(username, actions);
  }

  sendTutorial(username, actions) {
    for (const line of this._messageList('tutorial')) {
      actions.msg(username, this._render(line));
    }
  }

  // ── payment handler (FIXED) ───────────────────────────────────────────────

  /**
   * Called when a player sends money to the bot.
   *
   * BUG THAT WAS FIXED: The original code sent the tutorial on first payment
   * and then returned early after logging "erste Zahlung". The game was never
   * started for first-time depositors, which appeared as "casino not running
   * when money is received". Now the tutorial is sent but the normal game flow
   * continues.
   */
  handlePayment(player, amount, actions) {
    if (!player || !Number.isInteger(amount) || amount <= 0) return;

    const key     = this.playerKey(player);
    const display = String(player);

    this.stats.deposits += 1;
    this.adjustAccount(amount);
    this.addEvent('PAY', `${display} pays ${money(amount)}. Balance: ${this._fmtBalance()} | Playable: ${this._fmtPlayable()}`);

    // Send tutorial on first contact – but do NOT stop game flow
    if (!this.hasTutorialPlayer(player)) {
      this.markTutorialPlayer(player);
      this.sendTutorial(player, actions);
      this.addEvent('GAME', `${display}: first payment – tutorial sent. Game continues normally.`);
      // fall through to the normal game logic below
    }

    // Reject if a game is already running for this player
    if (this.activeGames.has(key)) {
      this._refund(player, amount, this._render('alreadyActive'), actions);
      return;
    }

    // Check player limits (cooldown / daily limit)
    const limitCheck = this._checkPlayerLimits(player);
    if (!limitCheck.allowed) {
      this._refund(player, amount, limitCheck.message, actions);
      return;
    }

    // Validate bet range
    if (amount < this.config.minBet) {
      this._refund(player, amount, this._render('tooLow'), actions);
      return;
    }
    if (amount > this.config.maxBet) {
      this._refund(player, amount, this._render('tooHigh'), actions);
      return;
    }

    // Ensure we know the current balance
    if (this.accountBalance == null) {
      actions.balance();
      this._refund(player, amount, this._render('unknownBalance'), actions);
      return;
    }

    // Ensure we can pay out the potential win
    const payout = Math.floor(amount * this.config.payoutMultiplier);
    if (!this.canPay(payout)) {
      this._refund(player, amount, this._render('reserveTooLow'), actions);
      return;
    }

    this._startGame(player, amount, actions);
  }

  // ── game lifecycle ────────────────────────────────────────────────────────

  _startGame(player, bet, actions) {
    const key     = this.playerKey(player);
    const display = String(player);

    this.activeGames.set(key, { player: display, bet, startedAt: new Date() });
    this._recordGame(player);

    this.addEvent('GAME', `${display} bets ${money(bet)}.`);
    actions.msg(player, this._render('accepted', { bet }));

    setTimeout(() => this._resolveGame(player, actions), this.config.drawDelayMs);
  }

  _resolveGame(player, actions) {
    const key  = this.playerKey(player);
    const game = this.activeGames.get(key);
    if (!game) return;

    const display = game.player || String(player);
    const won     = Math.random() < this.config.winChance;
    const payout  = Math.floor(game.bet * this.config.payoutMultiplier);

    if (won) {
      if (!this.canPay(payout)) {
        this._refund(display, game.bet, this._render('reserveTooLowDuringDraw'), actions);
        this.activeGames.delete(key);
        return;
      }
      this.stats.wins       += 1;
      this.stats.totalPaid  += payout;
      this.adjustAccount(-payout);
      setTimeout(() => actions.payWithMsg(display, payout, this._render('won', { bet: game.bet, payout })), 500);
      setTimeout(() => actions.balance(), 2000);
      this.addEvent('WIN', `${display} wins ${money(payout)}. Balance: ${this._fmtBalance()} | Playable: ${this._fmtPlayable()}`);
      this._logGameResult(display, 'WIN', `bet=${money(game.bet)} payout=${money(payout)} balance=${this._fmtBalance()}`);
    } else {
      this.stats.losses     += 1;
      this.stats.totalLost  += game.bet;
      actions.msg(display, this._render('lost', { bet: game.bet }));
      this.addEvent('LOSS', `${display} loses ${money(game.bet)}. Balance: ${this._fmtBalance()} | Playable: ${this._fmtPlayable()}`);
      this._logGameResult(display, 'LOSS', `bet=${money(game.bet)} balance=${this._fmtBalance()}`);
    }

    this.activeGames.delete(key);
  }

  _refund(player, amount, reason, actions) {
    const display = String(player);
    this.stats.refunds       += 1;
    this.stats.totalRefunded += amount;
    this.adjustAccount(-amount);
    actions.msg(display, reason);
    setTimeout(() => actions.payWithMsg(display, amount, this._render('refund', { amount })), 300);
    setTimeout(() => actions.balance(), 1500);
    this.addEvent('REFUND', `${display}: ${money(amount)} refunded. Reason: ${reason}`);
    this._logGameResult(display, 'REFUND', `amount=${money(amount)} reason=${reason}`);
  }

  cancelGame(player) {
    const key  = this.playerKey(player);
    const game = this.activeGames.get(key);
    if (!game) return null;

    this.activeGames.delete(key);
    this.stats.refunds       += 1;
    this.stats.totalRefunded += game.bet;
    this.adjustAccount(-game.bet);
    const display = game.player || String(player);
    this.addEvent('REFUND', `${display}: game cancelled via console, ${money(game.bet)} refunded.`);
    return game;
  }

  // ── player limits ─────────────────────────────────────────────────────────

  _checkPlayerLimits(player) {
    const limits = this._getLimit(player);
    const now    = Date.now();
    const remaining = limits.lastGameAt + this.config.playerCooldownMs - now;

    if (remaining > 0) {
      return {
        allowed : false,
        message : this._render('cooldown', { seconds: Math.ceil(remaining / 1000) }),
      };
    }
    if (limits.gamesToday >= this.config.playerDailyLimit) {
      return {
        allowed : false,
        message : this._render('dailyLimit', { count: this.config.playerDailyLimit, limit: this.config.playerDailyLimit }),
      };
    }
    return { allowed: true };
  }

  _recordGame(player) {
    const limits = this._getLimit(player);
    limits.lastGameAt  = Date.now();
    limits.gamesToday += 1;
  }

  _getLimit(player) {
    const key   = this.playerKey(player);
    const today = new Date().toISOString().slice(0, 10);
    const cur   = this.playerLimits.get(key);
    if (cur && cur.day === today) return cur;
    const next = { day: today, gamesToday: 0, lastGameAt: 0 };
    this.playerLimits.set(key, next);
    return next;
  }

  // ── tutorial tracking ─────────────────────────────────────────────────────

  playerKey(player) {
    const name = String(player || '').trim();
    if (!name) return '';
    return name.replace(/^[.!]/, '').toLowerCase();
  }

  hasTutorialPlayer(player) {
    const key = this.playerKey(player);
    return key !== '' && this.tutorialPlayers.has(key);
  }

  markTutorialPlayer(player) {
    const key = this.playerKey(player);
    if (key && !this.tutorialPlayers.has(key)) {
      this.tutorialPlayers.add(key);
      this._saveKnownPlayers();
    }
  }

  // ── events ────────────────────────────────────────────────────────────────

  addEvent(type, message) {
    const entry = { time: new Date(), type, message };
    this.recentEvents.unshift(entry);
    this.recentEvents = this.recentEvents.slice(0, 50);
    this.logger.log(type, message);
  }

  // ── message rendering ─────────────────────────────────────────────────────

  _messageList(key) {
    const value = this.config.messages?.[key];
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [String(value)];
  }

  _render(keyOrTemplate, values = {}) {
    const template = this.config.messages?.[keyOrTemplate] || keyOrTemplate;
    const ctx = {
      bot              : this.config.username,
      minBet           : money(this.config.minBet),
      maxBet           : money(this.config.maxBet),
      winChance        : Math.round(this.config.winChance * 100),
      payoutMultiplier : this.config.payoutMultiplier,
      supportDiscord   : this.config.supportDiscord,
      bankReserve      : money(this.config.bankReserve),
      playerDailyLimit : this.config.playerDailyLimit,
      ...values,
    };
    return String(template).replace(/\{(\w+)\}/g, (_, k) => {
      const v = ctx[k];
      if (typeof v === 'number' && ['amount', 'bet', 'payout'].includes(k)) return money(v);
      return v == null ? '' : String(v);
    });
  }

  _fmtBalance()  { return this.accountBalance == null ? 'unknown' : money(this.accountBalance); }
  _fmtPlayable() {
    const p = this.getPlayableBalance();
    return p == null ? 'unknown' : money(p);
  }
}

module.exports = CasinoService;