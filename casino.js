const { log } = require('./logger');

function handleChatMessage(username, message, sendChat, activeGames, stats, config) {
  const args = message.trim().split(' ');
  if (args[0] !== '!casino') return;

  if (!args[1] || args[1] === 'help') {
    sendHelp(username, sendChat, config);
  } else if (args[1] === 'bet') {
    handleBet(username, parseInt(args[2]), sendChat, activeGames, stats, config);
  }
}

function sendHelp(username, sendChat, config) {
  sendChat(`[Casino] Hallo ${username}! Willkommen im Casino!`);
  sendChat(`[Casino] Gewinnchance: ${config.winChance * 100}% | Verlust: ${100 - config.winChance * 100}%`);
  sendChat(`[Casino] Einsatz: min. ${config.minBet}$ bis max. ${config.maxBet}$`);
  sendChat(`[Casino] Befehl: !casino bet <betrag>`);
  sendChat(`[Casino] Gewinn = doppelter Einsatz!`);
}

function handleBet(username, betrag, sendChat, activeGames, stats, config) {
  if (isNaN(betrag) || betrag <= 0) {
    sendChat(`[Casino] ${username}: Ungültiger Betrag!`); return;
  }
  if (betrag < config.minBet) {
    sendChat(`[Casino] ${username}: Mindest-Einsatz: ${config.minBet}$! (Du: ${betrag}$)`); return;
  }
  if (betrag > config.maxBet) {
    sendChat(`[Casino] ${username}: Maximum: ${config.maxBet}$!`); return;
  }
  if (activeGames[username]) {
    sendChat(`[Casino] ${username}: Warte bis dein aktuelles Spiel endet!`); return;
  }

  activeGames[username] = betrag;
  log('🎲', `${username} setzt ${betrag.toLocaleString()}$`);
  sendChat(`[Casino] ${username} setzt ${betrag}$... Wuerfle!`);
  setTimeout(() => resolveGame(username, betrag, sendChat, activeGames, stats, config), 2500);
}

function resolveGame(username, betrag, sendChat, activeGames, stats, config) {
  const gewonnen = Math.random() < config.winChance;
  const auszahlung = betrag * 2;

  if (gewonnen) {
    stats.wins++;
    stats.totalPaid += auszahlung;
    sendChat(`[Casino] Glueckwunsch ${username}! Du hast gewonnen!`);
    sendChat(`[Casino] Auszahlung: ${auszahlung}$!`);
    sendChat(`/pay ${username} ${auszahlung}`);
    log('💰', `GEWINN: ${username} bekommt ${auszahlung.toLocaleString()}$`);
  } else {
    stats.losses++;
    stats.totalLost += betrag;
    sendChat(`[Casino] ${username} hat leider ${betrag}$ verloren!`);
    sendChat(`[Casino] Viel Glueck beim naechsten Mal!`);
    log('📉', `VERLUST: ${username} verliert ${betrag.toLocaleString()}$`);
  }

  delete activeGames[username];
}

module.exports = { handleChatMessage };