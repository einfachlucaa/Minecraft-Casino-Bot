const mc = require('minecraft-protocol');
const readline = require('readline');
const dns = require('dns');
const config = require('./config');
const { setRl, log, printBanner, printHelp, printStatus, printStats } = require('./logger');
const { handleChatMessage } = require('./casino');

// STATE
let client = null;
let isConnected = false;
let reconnectTimer = null;
let reconnectScheduled = false;
let activeGames = {};
let stats = { wins: 0, losses: 0, totalPaid: 0, totalLost: 0 };

// CONSOLE
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.setPrompt('casino> ');
setRl(rl);

rl.on('line', (input) => {
  const args = input.trim().split(' ');
  const cmd = args[0].toLowerCase();
  switch (cmd) {
    case 'help': printHelp(); break;
    case 'status': printStatus(config, isConnected, activeGames); break;
    case 'stats': printStats(stats); break;
    case 'games': {
      const games = Object.entries(activeGames);
      if (!games.length) { console.log('📋 Keine aktiven Spiele.'); break; }
      console.log('📋 Aktive Spiele:');
      games.forEach(([p, b]) => console.log(`   ${p}: ${b.toLocaleString()}$`));
      break;
    }
    case 'say': {
      if (!isConnected) { console.log('❌ Bot nicht verbunden!'); break; }
      const text = args.slice(1).join(' ');
      if (!text) { console.log('❌ Benutzung: say <text>'); break; }
      sendChat(text);
      console.log(`📤 Chat: ${text}`);
      break;
    }
    case 'reconnect':
      console.log('🔄 Manueller Reconnect...');
      destroyClient();
      setTimeout(createBot, 1000);
      break;
    case 'stop':
      console.log('🛑 Bot wird gestoppt...');
      process.exit(0);
      break;
    case '': break;
    default: console.log(`❌ Unbekannt: "${cmd}" | Tippe "help"`);
  }
  rl.prompt(true);
});

// HELPERS
function writeVarInt(val) {
  val = val | 0;
  const buf = [];
  let unsigned = val >>> 0;
  do {
    let b = unsigned & 0x7F;
    unsigned >>>= 7;
    if (unsigned !== 0) b |= 0x80;
    buf.push(b);
  } while (unsigned !== 0);
  return Buffer.from(buf);
}

function writeString(str) {
  const strBuf = Buffer.from(str, 'utf8');
  return Buffer.concat([writeVarInt(strBuf.length), strBuf]);
}

function stripFormatting(str) {
  return str.replace(/§[0-9a-fk-or]/gi, '').trim();
}

function extractText(content) {
  try {
    if (typeof content === 'string') {
      try { return extractText(JSON.parse(content)); } catch { return stripFormatting(content); }
    }
    if (typeof content === 'object' && content !== null) {
      let text = '';
      if (typeof content.text === 'string') text += content.text;
      if (typeof content.value === 'string') text += content.value;
      if (typeof content.value === 'object') text += extractText(content.value);
      if (Array.isArray(content.extra)) for (const e of content.extra) text += extractText(e);
      if (typeof content.translate === 'string') text += content.translate;
      return stripFormatting(text);
    }
    return stripFormatting(String(content));
  } catch { return ''; }
}

function extractUsername(senderName) {
  if (!senderName) return '';
  if (typeof senderName === 'string') return stripFormatting(senderName);
  return stripFormatting(extractText(senderName));
}

// CHAT
function sendChat(message) {
  if (!client || !isConnected) return;
  try { client.write('chat', { message }); }
  catch (e) { log('❌', `Chat Fehler: ${e.message}`); }
}

// CLIENT CLEANUP
function destroyClient() {
  if (!client) return;
  try { client.removeAllListeners(); client.end(); } catch {}
  client = null;
  isConnected = false;
}

// BOT MAIN
function createBot() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectScheduled = false;
  destroyClient();

  log('🔌', `Verbinde mit ${config.host}:${config.port}...`);
  dns.lookup(config.host, (err, addr) => {
    if (err) log('⚠️', `DNS: ${err.message}`);
    else log('🏓', `Server IP: ${addr}`);
  });

  try {
    log('🔐', 'Starte Microsoft-Authentifizierung...');
    client = mc.createClient({
      host: config.host,
      port: config.port,
      username: config.username,
      version: config.version,
      auth: 'microsoft',
      hideErrors: true
    });
  } catch (e) {
    log('❌', `Client Error: ${e.message}`);
    scheduleReconnect();
    return;
  }

  client.on('connect', () => {
    log('🔗', 'TCP-Verbindung hergestellt!');
  });

  client.on('login', (data) => {
    isConnected = true;
    log('✅', `Eingeloggt! Entity-ID: ${data.entityId}`);

    try {
      client.write('settings', {
        locale: 'de_DE',
        viewDistance: 8,
        chatMode: 0,
        chatColors: true,
        displayedSkinParts: 127,
        mainHand: 1,
        enableTextFiltering: false,
        allowListing: true
      });
      log('⚙️', 'Settings gesendet');
    } catch (e) { log('⚠️', `Settings Fehler: ${e.message}`); }

    try {
      client.write('custom_payload', {
        channel: 'minecraft:brand',
        data: writeString('vanilla')
      });
      log('✅', 'Brand gesendet');
    } catch (e) { log('⚠️', `Brand Fehler: ${e.message}`); }

    setTimeout(() => {
      if (isConnected) {
        try {
          sendChat('Casino-Bot ist online! Schreib !casino help');
        } catch (e) { log('⚠️', `Initial message Fehler: ${e.message}`); }
      }
    }, 2000);
  });

  client.on('error', (err) => {
    log('❌', `Error: ${err.message}`);
  });

  client.on('end', (reason) => {
    if (reconnectScheduled) return;
    isConnected = false;
    log('🔌', `Verbindung beendet: ${reason || 'unbekannt'}`);
    scheduleReconnect();
  });

  client.on('disconnect', (data) => {
    try {
      let reason = '';
      if (typeof data === 'string') {
        reason = extractText(JSON.parse(data));
      } else if (data && typeof data === 'object') {
        reason = extractText(data.reason || data);
      } else {
        reason = String(data);
      }
      if (reason) {
        log('⚠️', `Gekickt: ${reason.substring(0, 120)}`);
      }
    } catch (e) {
      log('⚠️', `Gekickt (Parse Error): ${String(data).substring(0, 80)}`);
    }
  });

  client.on('kick_disconnect', (data) => {
    try {
      let reason = '';
      if (typeof data.reason === 'string') {
        reason = extractText(JSON.parse(data.reason));
      } else {
        reason = extractText(data.reason || data);
      }
      log('🔴', `Server Kick: ${reason.substring(0, 120)}`);
    } catch (e) {
      log('🔴', `Server Kick: ${JSON.stringify(data).substring(0, 80)}`);
    }
  });

  // PACKETS
  client.on('keep_alive', (d) => {
    try { client.write('keep_alive', { keepAliveId: d.keepAliveId }); } catch {}
  });

  client.on('ping', (d) => {
    try { client.write('pong', { id: d.id }); } catch {}
  });

  client.on('teleport', (d) => {
    try { 
      client.write('teleport_confirm', { teleportId: d.teleportId }); 
    } catch {}
  });

  // CHAT MESSAGES
  client.on('system_chat', (data) => {
    try {
      const text = extractText(data.content);
      if (text) log('📢', `System: ${text.substring(0, 120)}`);
      
      const chatMatch = stripFormatting(text).match(/^<([^>]+)>\s+(.+)$/);
      if (chatMatch) {
        const username = chatMatch[1].trim();
        const message = chatMatch[2].trim();
        if (username !== config.username) {
          log('💬', `${username}: ${message}`);
          handleChatMessage(username, message, sendChat, activeGames, stats, config);
        }
      }
    } catch {}
  });

  client.on('player_chat', (data) => {
    try {
      const username = extractUsername(data.senderName);
      const message = data.plainMessage || (typeof data.message === 'string' ? data.message : '') || '';
      if (!username || username === config.username) return;
      log('💬', `${username}: ${message}`);
      handleChatMessage(username, message, sendChat, activeGames, stats, config);
    } catch {}
  });

  // DISCONNECT
  client.on('kick_disconnect', (data) => {
    isConnected = false;
    try {
      const reason = extractText(typeof data.reason === 'string' ? JSON.parse(data.reason) : data.reason);
      log('⚠️', `Gekickt: ${reason || JSON.stringify(data.reason)}`);
    } catch { log('⚠️', `Gekickt: ${JSON.stringify(data.reason)}`); }
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectScheduled) return;
  reconnectScheduled = true;
  destroyClient();
  log('🔄', 'Reconnect in 5 Sekunden...');
  reconnectTimer = setTimeout(createBot, 5000);
}

// START
printBanner(config);
createBot();
rl.prompt(true);
