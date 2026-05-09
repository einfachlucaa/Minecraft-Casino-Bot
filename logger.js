let _rl = null;

function setRl(rl) { _rl = rl; }

function log(symbol, msg) {
  process.stdout.clearLine?.(0);
  process.stdout.cursorTo?.(0);
  console.log(`${symbol} ${msg}`);
  _rl?.prompt(true);
}

function printBanner(config) {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║        🎰  CASINO-BOT  v4.0  🎰              ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Account  : ${config.username.padEnd(33)}║`);
  console.log(`║  Server   : ${(config.host + ':' + config.port).padEnd(33)}║`);
  console.log(`║  Version  : ${config.version.padEnd(33)}║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Tippe "help" fuer alle Befehle              ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
}

function printHelp() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║           CASINO-BOT KONSOLE HILFE           ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  help          - Diese Hilfe                 ║');
  console.log('║  status        - Bot & Server Status         ║');
  console.log('║  stats         - Gewinn/Verlust Statistik    ║');
  console.log('║  games         - Aktive Spiele anzeigen      ║');
  console.log('║  say <text>    - Nachricht im Chat senden    ║');
  console.log('║  reconnect     - Neu verbinden               ║');
  console.log('║  stop          - Bot beenden                 ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
}

function printStatus(config, isConnected, activeGames) {
  console.log('');
  console.log('┌─ BOT STATUS ──────────────────────────────────┐');
  console.log(`│  Account   : ${config.username}`);
  console.log(`│  Server    : ${config.host}:${config.port}`);
  console.log(`│  Version   : ${config.version}`);
  console.log(`│  Online    : ${isConnected ? '✅ Verbunden' : '❌ Nicht verbunden'}`);
  console.log(`│  Spiele    : ${Object.keys(activeGames).length} aktiv`);
  console.log(`│  Min-Bet   : ${config.minBet.toLocaleString()}$`);
  console.log(`│  Max-Bet   : ${config.maxBet.toLocaleString()}$`);
  console.log(`│  Gewinn%   : ${config.winChance * 100}%`);
  console.log('└───────────────────────────────────────────────┘');
  console.log('');
}

function printStats(stats) {
  const total = stats.wins + stats.losses;
  const winRate = total > 0 ? ((stats.wins / total) * 100).toFixed(1) : '0.0';
  console.log('');
  console.log('┌─ STATISTIK ───────────────────────────────────┐');
  console.log(`│  Spiele gesamt : ${total}`);
  console.log(`│  Gewonnen      : ${stats.wins} (${winRate}%)`);
  console.log(`│  Verloren      : ${stats.losses}`);
  console.log(`│  Ausgezahlt    : ${stats.totalPaid.toLocaleString()}$`);
  console.log(`│  Eingenommen   : ${stats.totalLost.toLocaleString()}$`);
  console.log(`│  Bilanz        : ${(stats.totalLost - stats.totalPaid).toLocaleString()}$`);
  console.log('└───────────────────────────────────────────────┘');
  console.log('');
}

module.exports = { setRl, log, printBanner, printHelp, printStatus, printStats };