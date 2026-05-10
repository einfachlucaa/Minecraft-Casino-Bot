let rl = null;
let panelRenderer = null;
const recentLogs = [];

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

const levelColors = {
  OK: colors.green,
  INFO: colors.cyan,
  AUTH: colors.magenta,
  STATE: colors.gray,
  WARN: colors.yellow,
  ERROR: colors.red,
  KICK: colors.red,
  BANK: colors.green,
  BAL: colors.green,
  PAY: colors.green,
  GAME: colors.magenta,
  WIN: colors.green,
  LOSS: colors.yellow,
  REFUND: colors.yellow,
  MSG: colors.cyan,
  CMD: colors.cyan,
  CHAT: colors.gray,
  PLUGIN: colors.gray,
  FOOD: colors.yellow,
  HP: colors.red,
  ECON: colors.yellow
};

function setReadline(readlineInterface) {
  rl = readlineInterface;
  rl?.on?.('close', () => {
    rl = null;
  });
}

function setPanelRenderer(renderer) {
  panelRenderer = renderer;
}

function paint(value, color) {
  if (!process.stdout.isTTY) return String(value);
  return `${color}${value}${colors.reset}`;
}

function line(message = '') {
  console.log(message);
}

function section(title) {
  line('');
  line(paint(`== ${title} ${'='.repeat(Math.max(0, 46 - title.length))}`, colors.bold + colors.cyan));
}

function log(level, message) {
  recentLogs.unshift({
    time: new Date(),
    level,
    message
  });
  recentLogs.splice(40);
  if (panelRenderer) {
    const rendered = panelRenderer(`Log: ${level}`);
    if (rendered) return;
  }

  process.stdout.clearLine?.(0);
  process.stdout.cursorTo?.(0);
  const color = levelColors[level] || colors.white;
  console.log(`${paint(`[${level.padEnd(6)}]`, color)} ${message}`);
  try {
    rl?.prompt(true);
  } catch {
    rl = null;
  }
}

function money(value) {
  return `${Number(value).toLocaleString('de-DE')}$`;
}

function printBanner(config) {
  line('');
  line(paint('+------------------------------------------------+', colors.cyan));
  line(paint('|              CASINO-BOT v4.1                  |', colors.cyan));
  line(paint('+------------------------------------------------+', colors.cyan));
  line(`| Account : ${String(config.username).padEnd(36)}|`);
  line(`| Server  : ${`${config.host}:${config.port}`.padEnd(36)}|`);
  line(`| Version : ${String(config.version).padEnd(36)}|`);
  line(`| Profil  : ${String(config.profileName || 'direkt').padEnd(36)}|`);
  line(`| Config  : ${String(config.configPath || 'configs/config.yml').slice(-36).padEnd(36)}|`);
  line(paint('+------------------------------------------------+', colors.cyan));
  line('| Konsole: help                                  |');
  line(paint('+------------------------------------------------+', colors.cyan));
  line('');
}

function printHelp() {
  section('Konsole');
  line('  panel               Main Panel neu zeichnen');
  line('  refresh             Main Panel neu zeichnen');
  line('  status              Verbindung, Kontostand, Bot-Werte');
  line('  stats               Casino-Zahlen');
  line('  games               Aktive Spiele');
  line('  cancel <spieler>    Aktives Spiel abbrechen und Einsatz erstatten');
  line('  events [anzahl]     Letzte Casino-Events');
  line('  health              Herzen, Hunger, Essen');
  line('  queue               Ausgehende Chat-Queue');
  line('  balance             /money abfragen');
  line('  msg <name> <text>   Private Nachricht');
  line('  pay <name> <sum>    Manuell auszahlen');
  line('  command <befehl>    Server-Befehl senden, Beispiel: command money');
  line('  say <text>          Chat-Nachricht senden');
  line('  reconnect           Neu verbinden');
  line('  clear               Konsole leeren');
  line('  config              Aktuelle Limits');
  line('  config set <key> <wert> Limit live aendern');
  line('                      Beispiel: config set maxBet 5000');
  line('                      Aendert nur den laufenden Bot, nicht die config.yml.');
  line('  ideas               Erweiterungs-Ideen');
  line('  stop                Beenden');
  line('');
}

function printStatus(config, snapshot) {
  section('Bot Status');
  line(`  Account      : ${snapshot.accountName || config.username}`);
  line(`  Server       : ${config.host}:${config.port}`);
  line(`  Verbindung   : ${snapshot.connected ? paint('Verbunden', colors.green) : paint('Nicht verbunden', colors.red)}`);
  line(`  Phase        : ${snapshot.phase}`);
  line(`  Queue        : ${snapshot.queueLength || 0}`);
  line(`  Aktive Spiele: ${snapshot.activeGameCount}`);
  line(`  Kontostand   : ${snapshot.accountBalance == null ? paint('Unbekannt', colors.yellow) : money(snapshot.accountBalance)} (${config.moneyCommand || '/money balance'})`);
  line(`  Reserve      : ${money(config.bankReserve)}`);
  line(`  Spielbar     : ${snapshot.playableBank == null ? 'Unbekannt' : money(snapshot.playableBank)}`);
  line(`  Herzen       : ${snapshot.health?.healthText || 'Unbekannt'}`);
  line(`  Hunger       : ${snapshot.health?.foodText || 'Unbekannt'}`);
  line(`  Essen        : ${snapshot.health?.foodItems || 0} Items`);
  if (snapshot.position) {
    line(`  Position     : ${snapshot.position.x.toFixed(1)} / ${snapshot.position.y.toFixed(1)} / ${snapshot.position.z.toFixed(1)}`);
  }
  line(`  Min/Max      : ${money(config.minBet)} - ${money(config.maxBet)}`);
  line(`  Gewinnchance : ${Math.round(config.winChance * 100)}%`);
  if (snapshot.lastDisconnectReason) line(`  Letzter Kick : ${snapshot.lastDisconnectReason}`);
  line('');
}

function printStats(stats) {
  const total = stats.wins + stats.losses;
  const winRate = total > 0 ? ((stats.wins / total) * 100).toFixed(1) : '0.0';

  section('Casino Statistik');
  line(`  Spiele gesamt: ${total}`);
  line(`  Gewonnen     : ${stats.wins} (${winRate}%)`);
  line(`  Verloren     : ${stats.losses}`);
  line(`  Refunds      : ${stats.refunds}`);
  line(`  Einzahlungen : ${stats.deposits}`);
  line(`  Ausgezahlt   : ${money(stats.totalPaid)}`);
  line(`  Eingenommen  : ${money(stats.totalLost)}`);
  line(`  Zurückgez.   : ${money(stats.totalRefunded)}`);
  line(`  Bilanz       : ${money(stats.totalLost - stats.totalPaid)}`);
  line(`  Kontostand   : ${stats.accountBalance == null ? 'Unbekannt' : money(stats.accountBalance)}`);
  line(`  Reserve      : ${money(stats.bankReserve)}`);
  line(`  Spielbar     : ${stats.playableBank == null ? 'Unbekannt' : money(stats.playableBank)}`);
  line('');
}

function printMainPanel(config, snapshot, stats, reason = 'Auto-Update') {
  const total = stats.wins + stats.losses;
  const winRate = total > 0 ? ((stats.wins / total) * 100).toFixed(1) : '0.0';
  const updatedAt = new Date().toLocaleTimeString('de-DE');

  if (process.stdout.isTTY) process.stdout.write('\x1b[3J\x1b[2J\x1b[H');
  else console.clear();
  line(paint('+------------------------------------------------------------+', colors.cyan));
  line(paint('| Minecraft Casino Bot - Main Panel                          |', colors.cyan));
  line(paint('+------------------------------------------------------------+', colors.cyan));
  line(`  Update       : ${updatedAt} (${reason})`);
  line(`  Account      : ${snapshot.accountName || config.username}`);
  line(`  Server       : ${snapshot.server || `${config.host}:${config.port}`} | Version ${snapshot.version || config.version} | Auth ${snapshot.auth || config.auth}`);
  line(`  Verbindung   : ${snapshot.connected ? paint('Verbunden', colors.green) : paint('Nicht verbunden', colors.red)}`);
  line(`  Phase        : ${snapshot.phase}`);
  line(`  Entity       : ${snapshot.entityId ?? '-'} | Dimension ${snapshot.dimension ?? '-'} | GameMode ${snapshot.gameMode ?? '-'}`);
  if (snapshot.position) {
    line(`  Position     : X ${snapshot.position.x.toFixed(1)} | Y ${snapshot.position.y.toFixed(1)} | Z ${snapshot.position.z.toFixed(1)} | Yaw ${snapshot.position.yaw?.toFixed?.(1) ?? '-'}`);
  } else {
    line('  Position     : Unbekannt');
  }
  line(`  Letztes Paket: ${snapshot.lastPacketAt ? snapshot.lastPacketAt.toLocaleTimeString('de-DE') : '-'}`);
  line(`  Letzter Kick : ${snapshot.lastDisconnectReason || '-'}`);
  line('');
  line(paint('Casino', colors.bold + colors.cyan));
  line(`  Kontostand   : ${stats.accountBalance == null ? paint('Unbekannt', colors.yellow) : money(stats.accountBalance)} (${config.moneyCommand || '/money balance'})`);
  line(`  Reserve      : ${money(config.bankReserve)}`);
  line(`  Spielbar     : ${stats.playableBank == null ? 'Unbekannt' : money(stats.playableBank)}`);
  line(`  Einsatz      : ${money(config.minBet)} - ${money(config.maxBet)}`);
  line(`  Chance       : ${Math.round(config.winChance * 100)}% | Cooldown ${Math.round(config.playerCooldownMs / 1000)}s | Tageslimit ${config.playerDailyLimit}`);
  line(`  Spiele       : ${total} gesamt, ${stats.wins} gewonnen (${winRate}%), ${stats.losses} verloren, ${stats.refunds} Refunds`);
  line(`  Ausgezahlt   : ${money(stats.totalPaid)} | Eingenommen ${money(stats.totalLost)} | Rueckzahlungen ${money(stats.totalRefunded)}`);
  line('');
  line(paint('Bot', colors.bold + colors.cyan));
  line(`  Queue        : ${snapshot.queueLength || 0} Nachrichten`);
  line(`  Aktive Games : ${snapshot.activeGameCount}`);
  line(`  Herzen       : ${snapshot.health?.healthText || 'Unbekannt'}`);
  line(`  Hunger       : ${snapshot.health?.foodText || 'Unbekannt'}`);
  line(`  Saettigung   : ${snapshot.health?.saturation ?? 'Unbekannt'}`);
  line(`  Essen        : ${snapshot.health?.foodItems || 0} Items | Bestes Essen ${snapshot.health?.bestFood || '-'} | Auto-Essen ${config.autoEat ? 'an' : 'aus'}`);
  line('');
  line(paint('Letzte Casino-Events', colors.bold + colors.cyan));
  for (const event of stats.recentEvents.slice(0, 6)) {
    line(`  ${event.time.toLocaleTimeString('de-DE')} [${event.type}] ${shorten(event.message, 96)}`);
  }
  if (!stats.recentEvents.length) line('  Noch keine Casino-Events.');
  line('');
  line(paint('Letzte Logs', colors.bold + colors.cyan));
  for (const entry of recentLogs.slice(0, 8)) {
    line(`  ${entry.time.toLocaleTimeString('de-DE')} [${entry.level}] ${shorten(entry.message, 96)}`);
  }
  if (!recentLogs.length) line('  Noch keine Logs.');
  line('');
  line('  Befehle: help | panel | refresh | status | stats | balance | command money | config set <key> <wert> | reconnect | stop');
  line('');
}

function shorten(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

module.exports = {
  setReadline,
  setPanelRenderer,
  log,
  printBanner,
  printHelp,
  printStatus,
  printStats,
  printMainPanel,
  money,
  section,
  paint,
  colors
};