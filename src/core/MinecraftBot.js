const dns = require('dns');
const { EventEmitter } = require('events');
const mc = require('minecraft-protocol');
const minecraftData = require('minecraft-data');
const { extractText, extractUsername, stripFormatting } = require('../utils/text');
const {
  parsePrivateMessage,
  parsePayment,
  parseBalance,
  looksEconomyRelated
} = require('../utils/serverMessageParser');
const HealthFoodTracker = require('./HealthFoodTracker');

class MinecraftBot extends EventEmitter {
  constructor(config, casino, logger) {
    super();
    this.config = config;
    this.casino = casino;
    this.logger = logger;
    this.client = null;
    this.connected = false;
    this.phase = 'stopped';
    this.reconnectTimer = null;
    this.reconnectScheduled = false;
    this.accountName = config.username;
    this.lastDisconnectReason = '';
    this.outgoingQueue = [];
    this.outgoingTimer = null;
    this.healthFood = new HealthFoodTracker(config, logger);
    this.detectedVersion = config.version === 'auto' ? config.fallbackVersion : config.version;
    this.position = null;
    this.dimension = null;
    this.gameMode = null;
    this.entityId = null;
    this.lastPacketAt = null;
    this.balanceRequestExpiresAt = 0;
    // Track last targeted command to support retry when server replies "player not found"
    this.lastTargetedCommand = null;
    // pendingPlayerCheck holds an in-flight online-check promise to coordinate PM->pay flow
    this.pendingPlayerCheck = null;
  }

  start() {
    this.connect();
  }

  stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectScheduled = true;
    this.destroyClient();
    this.phase = 'stopped';
  }

  reconnect() {
    this.logger.log('INFO', 'Manueller Reconnect...');
    this.destroyClient();
    setTimeout(() => this.connect(), 1000);
  }

  snapshot() {
    return {
      connected: this.connected,
      phase: this.phase,
      accountName: this.accountName,
      server: `${this.config.host}:${this.config.port}`,
      version: this.detectedVersion,
      auth: this.config.auth,
      entityId: this.entityId,
      dimension: this.dimension,
      gameMode: this.gameMode,
      position: this.position,
      lastPacketAt: this.lastPacketAt,
      accountBalance: this.casino.getAccountBalance(),
      privateBalance: this.casino.getPrivateBalance(),
      playableBank: this.casino.getPlayableBank(),
      playableBalance: this.casino.getPlayableBalance(),
      activeGameCount: this.casino.getActiveGameCount(),
      queueLength: this.outgoingQueue.length + (this.outgoingTimer ? 1 : 0),
      health: this.healthFood.snapshot(),
      lastDisconnectReason: this.lastDisconnectReason
    };
  }

  sendChat(message) {
    if (!this.client || !this.connected) {
      this.logger.log('WARN', 'Chat kann nicht gesendet werden: Bot ist nicht verbunden.');
      return false;
    }

    this.outgoingQueue.push(message);
    this.processOutgoingQueue();
    return true;
  }

  sendServerCommand(command) {
    const cleanCommand = String(command || '').trim().replace(/^\/+/, '');
    if (!cleanCommand) {
      this.logger.log('WARN', 'Server-Befehl ist leer.');
      return false;
    }

    return this.sendChat(`/${cleanCommand}`);
  }

  processOutgoingQueue() {
    if (this.outgoingTimer || this.outgoingQueue.length === 0) return;
    if (!this.client || !this.connected) {
      this.logger.log('WARN', 'Nachrichten in Queue, aber Client nicht verbunden. Bewahre Nachrichten.');
      return;
    }

    const message = this.outgoingQueue.shift();

    try {
      if (typeof this.client.chat === 'function') {
        this.client.chat(message);
      } else {
        this.client.write('chat_message', {
          message,
          timestamp: BigInt(Date.now()),
          salt: 1n,
          signature: undefined,
          offset: 0,
          checksum: 0,
          acknowledged: Buffer.alloc(3)
        });
      }
    } catch (error) {
      this.logger.log('ERROR', `Chat Fehler: ${error.message}`);
    }

    this.outgoingTimer = setTimeout(() => {
      this.outgoingTimer = null;
      this.processOutgoingQueue();
    }, this.config.commandDelayMs);
  }

  sendPrivateMessage(player, message) {
    const text = String(message || '').trim();
    const prefix = this.config.chatPrefix || '';
    const botMessage = prefix && !text.startsWith(prefix) ? `${prefix} ${text}` : text;
    const original = String(player || '').trim();
    const stripped = this.stripBedrockPrefix(original);
    const candidates = this.buildPlayerCommandCandidates(original);
    const sendName = candidates[0] || stripped;

    // remember last targeted command so failures can be retried with the original form
    this.lastTargetedCommand = {
      type: 'msg',
      original,
      stripped,
      candidates,
      payload: botMessage,
      timestamp: Date.now(),
      retryCount: 0
    };

    const playerArg = this.quotePlayerArg(sendName);
    const formatted = this.formatCommand(this.config.privateMessageCommand, { player: playerArg, message: botMessage });
    this.logger.log('INFO', `Sende PrivateMessage: ${formatted.substring(0, 200)}`);
    return this.sendChat(formatted);
  }

  // Send a private message with priority (inserted at front of queue)
  sendImmediatePrivateMessage(player, message) {
    const text = String(message || '').trim();
    const prefix = this.config.chatPrefix || '';
    const botMessage = prefix && !text.startsWith(prefix) ? `${prefix} ${text}` : text;
    const original = String(player || '').trim();
    const stripped = this.stripBedrockPrefix(original);
    const candidates = this.buildPlayerCommandCandidates(original);
    const sendName = candidates[0] || stripped;

    this.lastTargetedCommand = {
      type: 'msg',
      original,
      stripped,
      candidates,
      payload: botMessage,
      timestamp: Date.now(),
      retryCount: 0
    };

    const playerArg = this.quotePlayerArg(sendName);
    const formatted = this.formatCommand(this.config.privateMessageCommand, { player: playerArg, message: botMessage });
    this.logger.log('INFO', `Sende PrivateMessage (immediate): ${formatted.substring(0, 200)}`);

    // Insert after any currently-processing message but before normal queue items
    // Using push keeps order correct when multiple messages are sent in sequence
    this.outgoingQueue.push(formatted);
    this.processOutgoingQueue();
    return true;
  }

  pay(player, amount) {
    const original = String(player || '').trim();
    const stripped = this.stripBedrockPrefix(original);
    const candidates = this.buildPlayerCommandCandidates(original);
    const sendName = candidates[0] || stripped;
    this.lastTargetedCommand = {
      type: 'pay',
      original,
      stripped,
      candidates,
      payload: amount,
      timestamp: Date.now(),
      retryCount: 0   // how many retries have been attempted
    };

    const playerArg = this.quotePlayerArg(sendName);
    const formatted = this.formatCommand(this.config.payCommand, { player: playerArg, amount });
    this.logger.log('INFO', `Sende Pay: ${formatted}`);
    return this.sendChat(formatted);
  }

  requestBalance() {
    if (!this.config.balanceEnabled || !this.connected || !this.config.moneyCommand) return false;
    this.logger.log('BAL', 'Frage Kontostand beim Server ab...');
    const sent = this.sendServerCommand(this.config.moneyCommand);
    if (sent) this.balanceRequestExpiresAt = Date.now() + this.config.balanceAcceptWindowMs;
    return sent;
  }

  formatCommand(template, values) {
    return String(template || '').replace(/\{(\w+)\}/g, (_, key) => {
      const value = values[key];
      return value == null ? '' : String(value);
    });
  }

  stripBedrockPrefix(player) {
    return String(player || '').trim().replace(/^[.!]/, '');
  }

  buildPlayerCommandCandidates(player) {
    const original = String(player || '').trim();
    const stripped = this.stripBedrockPrefix(original);
    const hasBedRockPrefix = original !== stripped; // starts with '.' or '!'
    const candidates = [];

    const add = (name) => {
      const value = String(name || '').trim();
      if (!value) return;
      if (candidates.some((entry) => entry.toLowerCase() === value.toLowerCase())) return;
      candidates.push(value);
    };

    if (hasBedRockPrefix) {
      // For Bedrock players (name starts with '.' or '!'):
      // Keep the original prefix form first – the server uses it to identify Bedrock players.
      // Fall back to stripped (no prefix) and the other prefix variant.
      add(original);          // e.g. ".zKingYzy1937"  ← try first (what the server sent us)
      add(stripped);          // e.g.  "zKingYzy1937"  ← fallback: some plugins strip prefix
      add(original.startsWith('.') ? `!${stripped}` : `.${stripped}`); // other prefix variant
    } else {
      // Java player: no prefix, try as-is.
      add(original);
    }

    return candidates;
  }

  quotePlayerArg(player) {
    const name = String(player || '').trim();
    if (!name) return '';
    // Allow names that consist of alphanumerics, underscores, hyphens, dots,
    // and optionally a leading '.' or '!' (Bedrock prefix) – all safe unquoted.
    if (/^[.!]?[A-Za-z0-9_.-]+$/.test(name)) return name;
    return `"${name.replace(/"/g, '\\"')}"`;
  }

  connect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectScheduled = false;
    this.destroyClient();

    this.phase = 'connecting';
    this.logger.log('INFO', `Verbinde mit ${this.config.host}:${this.config.port}...`);
    dns.lookup(this.config.host, (error, address) => {
      if (error) this.logger.log('WARN', `DNS Fehler: ${error.message}`);
      else this.logger.log('INFO', `Server IP: ${address}`);
    });

    if (this.config.version === 'auto') {
      this.detectServerVersion((version) => this.createClient(version));
      return;
    }

    this.createClient(this.config.version);
  }

  createClient(version) {
    this.detectedVersion = version || this.config.fallbackVersion;
    this.healthFood.setVersion(this.detectedVersion);

    try {
      this.client = mc.createClient({
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        version: this.detectedVersion,
        auth: this.config.auth,
        hideErrors: this.config.hideErrors,
        keepAlive: this.config.keepAlive
      });
    } catch (error) {
      this.logger.log('ERROR', `Client konnte nicht erstellt werden: ${error.message}`);
      this.scheduleReconnect();
      return;
    }

    this.attachHandlers();
  }

  detectServerVersion(callback) {
    mc.ping({ host: this.config.host, port: this.config.port }, (error, response) => {
      if (error) {
        this.logger.log('WARN', `Versionserkennung fehlgeschlagen: ${error.message}. Nutze Fallback ${this.config.fallbackVersion}.`);
        callback(this.config.fallbackVersion);
        return;
      }

      const protocol = response?.version?.protocol;
      const versionName = response?.version?.name;
      const exact = minecraftData.versions.pc.find((entry) => entry.version === protocol);
      const advertisedVersion = this.extractVersionName(versionName);
      const detected = this.chooseDetectedVersion(versionName, exact?.minecraftVersion, advertisedVersion);

      this.logger.log('INFO', `Server-Version erkannt: ${versionName || 'unbekannt'} (Protocol ${protocol || '?'}) -> ${detected}`);
      callback(detected);
    });
  }

  chooseDetectedVersion(versionName, protocolVersion, advertisedVersion) {
    if (protocolVersion) return protocolVersion;
    if (this.isProxyVersionName(versionName)) return this.config.fallbackVersion;
    return advertisedVersion || this.config.fallbackVersion;
  }

  isProxyVersionName(value) {
    return /\b(?:velocity|bungeecord|waterfall|travertine)\b/i.test(String(value || ''));
  }

  extractVersionName(value) {
    const match = String(value || '').match(/\b\d+\.\d+(?:\.\d+)?\b/);
    return match?.[0] || null;
  }

  attachHandlers() {
    const client = this.client;

    client.on('session', (session) => {
      this.accountName = session?.selectedProfile?.name || this.accountName;
      this.logger.log('AUTH', `Microsoft Login erfolgreich: ${this.accountName}`);
      if (this.accountName.toLowerCase() !== this.config.username.toLowerCase()) {
        this.logger.log('WARN', `Angemeldeter Account ist ${this.accountName}, Config erwartet ${this.config.username}.`);
      }
    });

    client.on('connect', () => {
      this.phase = 'tcp-connected';
      this.logger.log('INFO', 'TCP-Verbindung hergestellt.');
    });

    client.on('state', (newState, oldState) => {
      this.phase = String(newState);
      this.logger.log('STATE', `${oldState} -> ${newState}`);
    });

    client.on('packet', (data, metadata) => {
      this.lastPacketAt = new Date();
      this.handlePacketLog(metadata);
    });

    client.on('playerJoin', () => {
      this.connected = true;
      this.phase = 'play';
      this.accountName = client.username || this.accountName;
      this.lastDisconnectReason = '';
      this.logger.log('OK', `Bot ist online als ${this.accountName}.`);
      this.sendClientSettings();
      this.registerBrand();
      this.runJoinActions();
    });

    client.on('login', (data) => {
      this.entityId = data?.entityId ?? data?.entityID ?? this.entityId;
      this.dimension = data?.dimensionName || data?.dimension || this.dimension;
      this.gameMode = data?.gameMode ?? this.gameMode;
      this.logger.log('INFO', 'Login-Paket empfangen, warte auf Play-State...');
    });

    client.on('cookie_request', (data) => this.handleCookieRequest(data));
    client.on('add_resource_pack', (data) => this.handleResourcePack(data));
    client.on('remove_resource_pack', () => {
      this.logger.log('INFO', 'Resource-Pack wurde vom Server entfernt.');
    });
    client.on('custom_payload', (data) => this.handleCustomPayload(data));
    client.on('keep_alive', (data) => this.handleKeepAlive(data));
    client.on('ping', (data) => this.handlePing(data));
    client.on('systemChat', (data) => this.handleSystemChat(data));
    client.on('system_chat', (data) => this.handleSystemChat(data));
    client.on('playerChat', (data) => this.handlePlayerChat(data));
    client.on('player_chat', (data) => this.handlePlayerChat(data));
    client.on('update_health', (data) => this.healthFood.updateHealth(data, client));
    client.on('window_items', (data) => this.healthFood.updateWindowItems(data));
    client.on('set_slot', (data) => this.healthFood.updateSlot(data));
    client.on('held_item_slot', (data) => this.healthFood.updateSelectedSlot(data));

    client.on('position', (data) => {
      this.updatePosition(data);
      this.confirmTeleport(data);
    });

    client.on('respawn', (data) => {
      this.dimension = data?.dimensionName || data?.dimension || this.dimension;
      this.gameMode = data?.gameMode ?? this.gameMode;
    });

    client.on('kick_disconnect', (data) => {
      this.connected = false;
      this.lastDisconnectReason = this.readKickReason(data);
      this.logger.log('KICK', this.lastDisconnectReason || 'Server hat die Verbindung beendet.');
      this.scheduleReconnect();
    });

    client.on('disconnect', (data) => {
      this.connected = false;
      this.lastDisconnectReason = this.readKickReason(data);
      if (this.lastDisconnectReason) this.logger.log('KICK', this.lastDisconnectReason);
    });

    client.on('end', (reason) => {
      if (this.reconnectScheduled) return;
      this.connected = false;
      this.phase = 'ended';
      this.logger.log('INFO', `Verbindung beendet${reason ? `: ${reason}` : ''}.`);
      this.scheduleReconnect();
    });

    client.on('error', (error) => {
      if (this.reconnectScheduled) return;
      this.connected = false;
      this.logger.log('ERROR', error.message);
      this.scheduleReconnect();
    });
  }

  sendClientSettings() {
    try {
      this.client.write('settings', {
        locale: this.config.locale,
        viewDistance: this.config.viewDistance,
        chatFlags: 0,
        chatColors: this.config.chatColors,
        skinParts: this.config.skinParts,
        mainHand: this.config.mainHand,
        enableTextFiltering: this.config.enableTextFiltering,
        enableServerListing: this.config.enableServerListing,
        particleStatus: this.config.particleStatus
      });
    } catch (error) {
      this.logger.log('WARN', `Settings konnten nicht gesendet werden: ${error.message}`);
    }
  }

  registerBrand() {
    try {
      const brandName = this.config.brand || 'vanilla';
      const brand = Buffer.from([Buffer.byteLength(brandName), ...Buffer.from(brandName, 'utf8')]);
      this.client.write('custom_payload', {
        channel: 'minecraft:brand',
        data: brand
      });
    } catch (error) {
      this.logger.log('WARN', `Brand konnte nicht gesendet werden: ${error.message}`);
    }
  }

  runJoinActions() {
    setTimeout(() => {
      for (const command of this.config.joinCommands || []) {
        this.sendChat(this.formatCommand(command, this.commandContext()));
      }

      for (const message of this.config.joinMessages || []) {
        this.sendChat(this.formatCommand(message, this.commandContext()));
      }

      if (this.config.autoBalanceOnJoin) this.requestBalance();
    }, this.config.joinMessageDelayMs);
  }

  handleCookieRequest(data) {
    try {
      this.client.write('cookie_response', {
        key: data.cookie,
        value: Buffer.alloc(0)
      });
      this.logger.log('INFO', `Cookie-Request beantwortet: ${data.cookie}`);
    } catch (error) {
      this.logger.log('WARN', `Cookie-Request konnte nicht beantwortet werden: ${error.message}`);
    }
  }

  handleKeepAlive(data) {
    try {
      this.client.write('keep_alive', { keepAliveId: data.keepAliveId });
    } catch (error) {
      this.logger.log('WARN', `KeepAlive Antwort fehlgeschlagen: ${error.message}`);
    }
  }

  handlePing(data) {
    try {
      this.client.write('pong', { id: data.id });
    } catch (error) {
      this.logger.log('WARN', `Ping Antwort fehlgeschlagen: ${error.message}`);
    }
  }

  handlePacketLog(metadata) {
    if (!this.config.debugPackets) return;
    if (String(metadata?.state) !== 'configuration') return;
    if (['ping', 'keep_alive', 'registry_data'].includes(metadata.name)) return;
    this.logger.log('PACKET', `configuration.${metadata.name}`);
  }

  handleResourcePack(data) {
    const uuid = data?.uuid;
    if (!uuid || !this.config.resourcePackEnabled) return;

    try {
      this.client.write('resource_pack_receive', { uuid, result: this.config.resourcePackFirstResult });
      this.logger.log('INFO', `Resource-Pack akzeptiert: ${uuid}`);

      setTimeout(() => {
        try {
          if (this.client) {
            this.client.write('resource_pack_receive', { uuid, result: this.config.resourcePackFinalResult });
            this.logger.log('INFO', `Resource-Pack geladen: ${uuid}`);
          }
        } catch (error) {
          this.logger.log('WARN', `Resource-Pack Abschluss fehlgeschlagen: ${error.message}`);
        }
      }, this.config.resourcePackFinalDelayMs);
    } catch (error) {
      this.logger.log('WARN', `Resource-Pack konnte nicht beantwortet werden: ${error.message}`);
    }
  }

  handleCustomPayload(data) {
    const channel = data?.channel || '';
    if (!channel) return;

    this.logger.log('PLUGIN', channel);

    if (channel === 'minecraft:brand') {
      this.registerBrand();
      return;
    }

    if (channel === 'minecraft:register') {
      this.registerPluginChannels();
      return;
    }

    if ((this.config.pluginCheckChannels || []).includes(channel)) {
      this.answerPluginCheck(channel);
    }
  }

  registerPluginChannels() {
    const configuredChannels = this.config.pluginRegisterChannels || [];
    if (!configuredChannels.length) return;

    const channels = configuredChannels.join('\0');

    try {
      this.client.write('custom_payload', {
        channel: 'minecraft:register',
        data: Buffer.from(channels, 'utf8')
      });
      this.logger.log('PLUGIN', 'Channels registriert.');
    } catch (error) {
      this.logger.log('WARN', `Plugin-Channel Registrierung fehlgeschlagen: ${error.message}`);
    }
  }

  answerPluginCheck(channel) {
    try {
      this.client.write('custom_payload', {
        channel,
        data: Buffer.alloc(1, this.config.pluginCheckResponseValue)
      });
      this.logger.log('PLUGIN', `Check beantwortet: ${channel}`);
    } catch (error) {
      this.logger.log('WARN', `Plugin-Check fehlgeschlagen (${channel}): ${error.message}`);
    }
  }

  confirmTeleport(data) {
    const teleportId = data?.teleportId;
    if (teleportId == null) return;

    try {
      this.client.write('teleport_confirm', { teleportId });
    } catch (error) {
      this.logger.log('WARN', `Teleport konnte nicht bestaetigt werden: ${error.message}`);
    }
  }

  updatePosition(data) {
    const x = Number(data?.x);
    const y = Number(data?.y);
    const z = Number(data?.z);
    if (![x, y, z].every(Number.isFinite)) return;

    this.position = {
      x,
      y,
      z,
      yaw: Number.isFinite(Number(data?.yaw)) ? Number(data.yaw) : null,
      pitch: Number.isFinite(Number(data?.pitch)) ? Number(data.pitch) : null
    };
  }

  handleSystemChat(data) {
    const text = extractText(
        data?.formattedMessage
        ?? data?.content
        ?? data?.message
        ?? data?.unsignedContent
        ?? data?.unsignedChatContent
        ?? data
    );
    if (!text) return;

    // If anti-cheat message handled, stop
    if (this.config.antiCheatEnabled && this.handleAntiCheatText(text)) return;

    // If casino message handled (payments / private), clear pending targeted command only when it matches
    const casinoHandled = this.handleCasinoSystemMessage(text);
    if (casinoHandled?.handled) {
      try {
        const cmd = this.lastTargetedCommand;
        if (cmd && casinoHandled.player) {
          const normalized = (name) => String(name || '').replace(/^[.!]/, '').toLowerCase();
          const playerProcessed = normalized(casinoHandled.player);
          if (playerProcessed === normalized(cmd.stripped) || playerProcessed === normalized(cmd.original)) {
            this.lastTargetedCommand = null;
          }
        } else if (!casinoHandled.player) {
          this.lastTargetedCommand = null;
        }
      } catch (err) {
        this.lastTargetedCommand = null;
      }
      return;
    }

    // detect common "player not found" or "not online" replies and retry if needed
    try {
      const lowered = text.toLowerCase();
      const notOnline = /(player not found|player not found!|player not online)/i.test(lowered) || /spieler ist nicht online/i.test(lowered);
      if (notOnline && this.lastTargetedCommand && (this.lastTargetedCommand.retryCount || 0) < (this.lastTargetedCommand.candidates || []).length - 1 && (Date.now() - this.lastTargetedCommand.timestamp) < 8000) {
        const cmd = this.lastTargetedCommand;
        if (cmd.original) {
          try {
            const nameLower = String(cmd.stripped || '').toLowerCase();
            const origLower = String(cmd.original || '').toLowerCase();
            const mentionsTarget = (nameLower && lowered.includes(nameLower)) || (origLower && lowered.includes(origLower));
            const genericShortNotOnline = lowered.length <= 80 && /\b(player not found|spieler ist nicht online)\b/i.test(lowered);

            if (mentionsTarget || genericShortNotOnline) {
              const retryCount = (cmd.retryCount || 0) + 1;

              // Walk through the pre-built candidates list in order.
              // candidates[0] was the initial send, so pick candidates[retryCount] next.
              //   Bedrock ".Player" → candidates = [".Player", "Player", "!Player"]
              //   Bedrock "!Player" → candidates = ["!Player", "Player", ".Player"]
              //   Java    "Player"  → candidates = ["Player"]
              const candidates = cmd.candidates || [cmd.original];
              const retryName = candidates[retryCount] || cmd.original;

              let formatted;
              if (cmd.type === 'pay') {
                formatted = this.formatCommand(this.config.payCommand, { player: this.quotePlayerArg(retryName), amount: cmd.payload });
              } else {
                formatted = this.formatCommand(this.config.privateMessageCommand, { player: this.quotePlayerArg(retryName), message: cmd.payload });
              }

              this.logger.log('INFO', `Retry ${retryCount}/2 (player not online): ${formatted.substring(0, 200)}`);
              cmd.retryCount = retryCount;
              cmd.timestamp = Date.now();
              this.sendChat(formatted);
              return;
            }
          } catch (e) {
            // fall through
          }
        }
      }
    } catch (err) {
      // ignore
    }

    this.logger.log('CHAT', `System: ${text.substring(0, 160)}`);
    this.handlePossibleVanillaChat(text);
  }

  handleCasinoSystemMessage(text) {
    const payment = this.config.casinoEnabled && this.config.paymentsEnabled
        ? parsePayment(text, this.accountName, this.config)
        : null;
    if (payment?.player && payment.amount != null) {
      this.casino.handlePayment(payment.player, payment.amount, this.createCasinoActions());
      // return info so caller may decide whether to clear lastTargetedCommand
      return { handled: true, type: 'payment', player: payment.player };
    }

    const balance = this.canAcceptBalanceUpdate()
        ? parseBalance(text, this.config)
        : null;
    if (balance != null) {
      this.casino.setAccountBalance(balance, 'server');
      this.balanceRequestExpiresAt = 0;
      return { handled: true, type: 'balance' };
    }

    const privateMessage = this.config.casinoEnabled && this.config.privateMessagesEnabled
        ? parsePrivateMessage(text, this.accountName, this.config)
        : null;
    if (privateMessage?.player) {
      this.logger.log('MSG', `${privateMessage.player}: ${privateMessage.message}`);
      this.casino.handlePrivateMessage(privateMessage.player, privateMessage.message, this.createCasinoActions());
      return { handled: true, type: 'private', player: privateMessage.player };
    }

    if (looksEconomyRelated(text, this.config)) {
      this.logger.log('ECON', `Nicht erkannt: ${text.substring(0, 180)}`);
    }

    return { handled: false };
  }

  canAcceptBalanceUpdate() {
    if (!this.config.balanceEnabled) return false;
    if (this.config.passiveBalanceEnabled) return true;
    return Date.now() <= this.balanceRequestExpiresAt;
  }

  handleAntiCheatText(text) {
    const normalized = String(text).toLowerCase().replace(/[^a-z0-9]/g, '');
    const aliases = this.config.pluginCheckAliases || {};

    const check = aliases[normalized];
    if (!check) return false;
    this.answerPluginCheck(`${check}:check`);
    return true;
  }

  handlePlayerChat(data) {
    const username = extractUsername(data?.senderName);
    const message = stripFormatting(
        data?.plainMessage
        || data?.message
        || data?.unsignedContent
        || data?.unsignedChatContent
        || ''
    );
    if (!username || !message || username.toLowerCase() === this.accountName.toLowerCase()) return;

    // Detect explicit client-side PM commands sent in chat (some servers/clients may surface them here)
    const pmMatch = message.match(/^\/(?:msg|tell|w)\s+("?)([^\s"]+)\1\s+(.+)$/i);
    if (pmMatch) {
      const targetRaw = pmMatch[2];
      const target = targetRaw.replace(/^[.!]/, '');
      if (target.toLowerCase() === (this.accountName || this.config.username).toLowerCase()) {
        const pmText = pmMatch[3].trim();
        this.logger.log('MSG', `${username}: ${pmText}`);
        if (this.config.casinoEnabled && this.config.privateMessagesEnabled) {
          this.casino.handlePrivateMessage(username, pmText, this.createCasinoActions());
        }
        return;
      }
    }

    this.logger.log('CHAT', `${username}: ${message}`);
  }

  handlePossibleVanillaChat(text) {
    const match = stripFormatting(text).match(/^<([^>]+)>\s+(.+)$/);
    if (!match) return;

    const username = match[1].trim();
    const message = match[2].trim();
    if (username.toLowerCase() === this.accountName.toLowerCase()) return;

    this.logger.log('CHAT', `${username}: ${message}`);
  }

  createCasinoActions() {
    return {
      msg: (player, message) => this.sendImmediatePrivateMessage(player, message),
      pay: (player, amount) => {
        this.pay(player, amount);
      },
      payWithMsg: (player, amount, message) => {
        // Send message first, then pay after one command delay to avoid race conditions
        this.sendImmediatePrivateMessage(player, message);
        setTimeout(() => this.pay(player, amount), this.config.commandDelayMs || 1000);
      },
      balance: () => this.requestBalance()
    };
  }

  commandContext() {
    return {
      bot: this.accountName || this.config.username,
      username: this.accountName || this.config.username,
      host: this.config.host,
      port: this.config.port,
      server: `${this.config.host}:${this.config.port}`
    };
  }

  readKickReason(data) {
    try {
      if (typeof data === 'string') return extractText(data).substring(0, 180);
      if (data?.reason) return extractText(data.reason).substring(0, 180);
      return extractText(data).substring(0, 180);
    } catch {
      return 'Unbekannter Disconnect-Grund';
    }
  }

  scheduleReconnect() {
    if (this.reconnectScheduled) return;
    this.reconnectScheduled = true;
    this.destroyClient();
    this.phase = 'reconnect-wait';
    this.logger.log('INFO', `Reconnect in ${Math.round(this.config.reconnectDelayMs / 1000)} Sekunden...`);
    this.reconnectTimer = setTimeout(() => this.connect(), this.config.reconnectDelayMs);
  }

  destroyClient() {
    if (!this.client) {
      this.connected = false;
      return;
    }

    const oldClient = this.client;
    this.client = null;
    this.connected = false;
    this.outgoingQueue = [];
    if (this.outgoingTimer) clearTimeout(this.outgoingTimer);
    this.outgoingTimer = null;

    try {
      oldClient.removeAllListeners();
      oldClient.on('error', () => {});
      oldClient.end('client reset');
    } catch {
      // Best effort cleanup.
    }
  }
}

module.exports = MinecraftBot;