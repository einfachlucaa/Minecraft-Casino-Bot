const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const rootDir = path.resolve(__dirname, '..', '..');
const defaultConfigPath = path.join(rootDir, 'configs', 'config.yml');
const configPath = process.env.CONFIG_PATH
    ? path.resolve(process.env.CONFIG_PATH)
    : defaultConfigPath;

const defaults = {
  profile: {
    active: '',
    serverDirectory: 'configs/servers'
  },
  serverProfiles: {},
  server: {
    host: 'example.net',
    port: 25565,
    version: 'auto',
    fallbackVersion: '1.21.8'
  },
  account: {
    username: 'DeinBotName',
    auth: 'microsoft'
  },
  commands: {
    money: '/money balance',
    pay: '/pay {player} {amount}',
    privateMessage: '/msg {player} {message}',
    chatPrefix: '[BOT]',
    join: [],
    joinMessages: []
  },
  parser: {
    privateMessagePatterns: [],
    paymentPatterns: [],
    balancePatterns: [],
    economyKeywords: ['pay', 'geld', 'money', 'balance', 'kontostand', 'guthaben', 'konto', 'zahlung', 'received', 'gezahlt', 'ueberweis']
  },
  support: {
    discord: 'dein_discord_name'
  },
  systems: {
    casino: true,
    payments: true,
    privateMessages: true,
    balance: true,
    passiveBalance: false,
    antiCheat: true,
    autoBalanceOnJoin: true,
    panel: true,
    panelRefreshMs: 5000,
    balanceAcceptWindowMs: 15000
  },
  casino: {
    minBet: 10000,
    maxBet: 1000000,
    winChance: 0.30,
    drawDelayMs: 2500,
    playerCooldownMs: 10000,
    playerDailyLimit: 20,
    reserve: 1000000,
    requireKnownBalance: true,
    payoutMultiplier: 2
  },
  messages: {
    tutorial: [
      'So spielst du: Sende Geld an {bot} mit einem Einsatz von {minBet} bis {maxBet}.',
      'Chance: {winChance}%. Wenn du gewinnst, zahlt der Bot dir {payoutMultiplier}x deinen Einsatz aus.',
      'Bei falschem Betrag, Cooldown, Tageslimit oder zu wenig spielbarem Guthaben bekommst du deinen Einsatz automatisch zurueck. Support auf Discord: {supportDiscord}.'
    ],
    accepted: 'Einsatz {bet} angenommen. Die Ziehung startet jetzt, bitte kurz warten.',
    won: 'Gewonnen. Deine Auszahlung betraegt {payout} und wird jetzt gesendet.',
    lost: 'Leider verloren. Dein Einsatz von {bet} bleibt auf dem Bot-Konto.',
    refund: 'Rueckzahlung: {amount}. Der Bot sendet dir den Betrag jetzt automatisch zurueck.',
    firstPaymentTutorial: 'Erste Zahlung: Du bekommst dein Geld zurueck. Das Tutorial wurde gesendet, ab jetzt kannst du normal spielen.',
    alreadyActive: 'Du hast bereits ein laufendes Spiel. Bitte warte auf die aktuelle Ziehung.',
    cooldown: 'Cooldown aktiv: Bitte warte noch {seconds} Sekunden, bevor du erneut spielst.',
    dailyLimit: 'Tageslimit erreicht: Du hast heute bereits {count}/{limit} Spiele gespielt.',
    tooLow: 'Dein Einsatz ist zu niedrig. Das Minimum liegt bei {minBet}.',
    tooHigh: 'Dein Einsatz ist zu hoch. Das Maximum liegt bei {maxBet}.',
    unknownBalance: 'Der Bot kennt den aktuellen Kontostand gerade nicht sicher und fragt ihn neu ab.',
    reserveTooLow: 'Der Bot hat nicht genug spielbares Guthaben oberhalb der Reserve.',
    reserveTooLowDuringDraw: 'Das spielbare Guthaben wurde waehrend der Ziehung zu niedrig. Dein Einsatz wird sicher zurueckgezahlt.'
  },
  bot: {
    reconnectDelayMs: 5000,
    joinMessageDelayMs: 2500,
    commandDelayMs: 1000,
    autoEat: true,
    autoEatFoodBelow: 20,
    autoEatHealthBelow: 20
  },
  minecraftClient: {
    locale: 'de_DE',
    viewDistance: 8,
    chatColors: true,
    skinParts: 127,
    mainHand: 1,
    enableTextFiltering: false,
    enableServerListing: true,
    particleStatus: 0,
    brand: 'vanilla',
    keepAlive: false,
    hideErrors: false,
    resourcePack: {
      enabled: true,
      firstResult: 3,
      finalResult: 0,
      finalDelayMs: 1000
    },
    pluginChannels: {
      register: [],
      checks: [],
      aliases: {},
      responseValue: 1
    }
  },
  debug: {
    packets: false
  }
};

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeDeep(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function readYamlFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  return YAML.parse(raw) || {};
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'ja', '1', 'on'].includes(normalized)) return true;
    if (['false', 'no', 'nein', '0', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function string(value, fallback) {
  return value == null || String(value).trim() === '' ? fallback : String(value).trim();
}

function stringOrEmpty(value) {
  return value == null ? '' : String(value).trim();
}

function stringArray(value, fallback = []) {
  return Array.isArray(value) ? value.map((entry) => String(entry)).filter(Boolean) : fallback;
}

function object(value, fallback = {}) {
  return isPlainObject(value) ? value : fallback;
}

function resolveProfilePath(config) {
  const activeProfile = stringOrEmpty(process.env.CONFIG_PROFILE || config.profile?.active);
  if (!activeProfile) {
    return {
      activeProfile: '',
      profilePath: '',
      inlineProfile: {},
      source: 'direct'
    };
  }

  const inlineProfiles = object(config.serverProfiles);
  const hasInlineProfile = Object.prototype.hasOwnProperty.call(inlineProfiles, activeProfile);
  const profileDirectory = path.resolve(rootDir, string(config.profile?.serverDirectory, defaults.profile.serverDirectory));
  const profilePath = path.join(profileDirectory, `${activeProfile}.yml`);

  return {
    activeProfile,
    profilePath,
    inlineProfile: object(inlineProfiles[activeProfile]),
    hasInlineProfile,
    source: hasInlineProfile ? 'config.yml' : profilePath
  };
}

function buildRuntimeConfig(config, profileMeta) {
  return {
    configPath,
    profileName: profileMeta.activeProfile,
    profilePath: profileMeta.source === 'config.yml' ? '' : profileMeta.profilePath,
    profileSource: profileMeta.source,

    host: string(config.server.host, defaults.server.host),
    port: number(config.server.port, defaults.server.port),
    version: string(config.server.version, defaults.server.version),
    fallbackVersion: string(config.server.fallbackVersion, defaults.server.fallbackVersion),
    username: string(config.account.username, defaults.account.username),
    auth: string(config.account.auth, defaults.account.auth),

    moneyCommand: stringOrEmpty(config.commands.money),
    payCommand: string(config.commands.pay, defaults.commands.pay),
    privateMessageCommand: string(config.commands.privateMessage, defaults.commands.privateMessage),
    chatPrefix: stringOrEmpty(config.commands.chatPrefix),
    joinCommands: stringArray(config.commands.join),
    joinMessages: stringArray(config.commands.joinMessages),
    privateMessagePatterns: stringArray(config.parser.privateMessagePatterns),
    paymentPatterns: stringArray(config.parser.paymentPatterns),
    balancePatterns: stringArray(config.parser.balancePatterns),
    economyKeywords: stringArray(config.parser.economyKeywords, defaults.parser.economyKeywords),
    supportDiscord: string(config.support.discord, defaults.support.discord),

    casinoEnabled: boolean(config.systems?.casino, defaults.systems.casino),
    paymentsEnabled: boolean(config.systems?.payments, defaults.systems.payments),
    privateMessagesEnabled: boolean(config.systems?.privateMessages, defaults.systems.privateMessages),
    balanceEnabled: boolean(config.systems?.balance, defaults.systems.balance),
    passiveBalanceEnabled: boolean(config.systems?.passiveBalance, defaults.systems.passiveBalance),
    antiCheatEnabled: boolean(config.systems?.antiCheat, defaults.systems.antiCheat),
    autoBalanceOnJoin: boolean(config.systems?.autoBalanceOnJoin, defaults.systems.autoBalanceOnJoin),
    panelEnabled: boolean(config.systems?.panel, defaults.systems.panel),
    panelRefreshMs: number(config.systems?.panelRefreshMs, defaults.systems.panelRefreshMs),
    balanceAcceptWindowMs: number(config.systems?.balanceAcceptWindowMs, defaults.systems.balanceAcceptWindowMs),

    minBet: number(config.casino.minBet, defaults.casino.minBet),
    maxBet: number(config.casino.maxBet, defaults.casino.maxBet),
    winChance: number(config.casino.winChance, defaults.casino.winChance),
    drawDelayMs: number(config.casino.drawDelayMs, defaults.casino.drawDelayMs),
    playerCooldownMs: number(config.casino.playerCooldownMs, defaults.casino.playerCooldownMs),
    playerDailyLimit: number(config.casino.playerDailyLimit, defaults.casino.playerDailyLimit),
    bankReserve: number(config.casino.reserve ?? config.casino.bankReserve, defaults.casino.reserve),
    requireKnownBalance: boolean(config.casino.requireKnownBalance, defaults.casino.requireKnownBalance),
    payoutMultiplier: number(config.casino.payoutMultiplier, defaults.casino.payoutMultiplier),
    messages: object(config.messages, defaults.messages),

    reconnectDelayMs: number(config.bot.reconnectDelayMs, defaults.bot.reconnectDelayMs),
    joinMessageDelayMs: number(config.bot.joinMessageDelayMs, defaults.bot.joinMessageDelayMs),
    commandDelayMs: number(config.bot.commandDelayMs, defaults.bot.commandDelayMs),
    autoEat: boolean(config.bot.autoEat, defaults.bot.autoEat),
    autoEatFoodBelow: number(config.bot.autoEatFoodBelow, defaults.bot.autoEatFoodBelow),
    autoEatHealthBelow: number(config.bot.autoEatHealthBelow, defaults.bot.autoEatHealthBelow),

    locale: string(config.minecraftClient.locale, defaults.minecraftClient.locale),
    viewDistance: number(config.minecraftClient.viewDistance, defaults.minecraftClient.viewDistance),
    chatColors: boolean(config.minecraftClient.chatColors, defaults.minecraftClient.chatColors),
    skinParts: number(config.minecraftClient.skinParts, defaults.minecraftClient.skinParts),
    mainHand: number(config.minecraftClient.mainHand, defaults.minecraftClient.mainHand),
    enableTextFiltering: boolean(config.minecraftClient.enableTextFiltering, defaults.minecraftClient.enableTextFiltering),
    enableServerListing: boolean(config.minecraftClient.enableServerListing, defaults.minecraftClient.enableServerListing),
    particleStatus: number(config.minecraftClient.particleStatus, defaults.minecraftClient.particleStatus),
    brand: string(config.minecraftClient.brand, defaults.minecraftClient.brand),
    keepAlive: boolean(config.minecraftClient.keepAlive, defaults.minecraftClient.keepAlive),
    hideErrors: boolean(config.minecraftClient.hideErrors, defaults.minecraftClient.hideErrors),
    resourcePackEnabled: boolean(config.minecraftClient.resourcePack?.enabled, defaults.minecraftClient.resourcePack.enabled),
    resourcePackFirstResult: number(config.minecraftClient.resourcePack?.firstResult, defaults.minecraftClient.resourcePack.firstResult),
    resourcePackFinalResult: number(config.minecraftClient.resourcePack?.finalResult, defaults.minecraftClient.resourcePack.finalResult),
    resourcePackFinalDelayMs: number(config.minecraftClient.resourcePack?.finalDelayMs, defaults.minecraftClient.resourcePack.finalDelayMs),
    pluginRegisterChannels: stringArray(config.minecraftClient.pluginChannels?.register),
    pluginCheckChannels: stringArray(config.minecraftClient.pluginChannels?.checks),
    pluginCheckAliases: object(config.minecraftClient.pluginChannels?.aliases),
    pluginCheckResponseValue: number(config.minecraftClient.pluginChannels?.responseValue, defaults.minecraftClient.pluginChannels.responseValue),

    debugPackets: boolean(config.debug.packets, defaults.debug.packets)
  };
}

const baseConfig = mergeDeep(defaults, readYamlFile(configPath));
const profileMeta = resolveProfilePath(baseConfig);
const hasExternalProfile = !profileMeta.hasInlineProfile && profileMeta.profilePath && fs.existsSync(profileMeta.profilePath);
if (profileMeta.activeProfile && !profileMeta.hasInlineProfile && !hasExternalProfile) {
  throw new Error(`Config-Profil "${profileMeta.activeProfile}" nicht gefunden. Lege serverProfiles.${profileMeta.activeProfile} in configs/config.yml an oder erstelle ${profileMeta.profilePath}.`);
}

const externalProfile = hasExternalProfile
    ? readYamlFile(profileMeta.profilePath)
    : {};
const loadedConfig = mergeDeep(baseConfig, profileMeta.hasInlineProfile ? profileMeta.inlineProfile : externalProfile);

module.exports = buildRuntimeConfig(loadedConfig, profileMeta);