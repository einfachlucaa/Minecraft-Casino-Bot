const mc = require('minecraft-protocol');
const readline = require('readline');
const dns = require('dns');
const config = require('./config');
const { setRl, log, printBanner, printHelp, printStatus, printStats } = require('./logger');
const { handleChatMessage } = require('./casino');

// ===== STATE =====
let client             = null;
let isConnected        = false;
let reconnectTimer     = null;
let reconnectScheduled = false;
let activeGames        = {};
let stats = { wins: 0, losses: 0, totalPaid: 0, totalLost: 0 };

// ===== CONSOLE =====
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.setPrompt('casino> ');
setRl(rl);

rl.on('line', (input) => {
  const args = input.trim().split(' ');
  const cmd  = args[0].toLowerCase();
  switch (cmd) {
    case 'help':   printHelp(); break;
    case 'status': printStatus(config, isConnected, activeGames); break;
    case 'stats':  printStats(stats); break;
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

// ===== HELPERS =====
function writeVarInt(val) {
  // Minecraft VarInt: signed 32-bit, no ZigZag, LEB128-style
  // Negative numbers werden als 5-byte VarInt kodiert (wie Java int)
  val = val | 0; // force signed 32-bit
  const buf = [];
  let unsigned = val >>> 0; // treat as unsigned for bit ops
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
      if (typeof content.text  === 'string') text += content.text;
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

// ===== RAW PACKET WRITER =====
// Nutzt client.socket (offizielle API laut mc-protocol Docs),
// nicht client._client.socket (interne undokumentierte Struktur).
// Schreibt UNKOMPRIMIERT / UNVERSCHLÜSSELT – nur vor Encryption-Handshake nutzbar.
// Nach Login ist Verschlüsselung aktiv → wir müssen writeChannel nutzen.
function writeRawTeleportConfirm(teleportId) {
  try {
    // mc-protocol exposed client.socket als direkte Property (laut API-Docs)
    // Aber nach Encryption ist raw socket write falsch – stattdessen
    // nutzen wir den internen write-Stream der Library.
    // Der korrekte Weg: client.write() mit dem richtigen Paketnamen.
    // In minecraft-protocol 1.66 heißt das Paket für 1.21.x:
    // "teleport_confirm" mit field "teleportId" als i32 (nicht varint!)
    // Wir probieren alle bekannten Feldnamen:
    const id = teleportId | 0; // signed 32-bit

    // Versuch 1: Standard
    try {
      client.write('teleport_confirm', { teleportId: id });
      log('✅', `teleport_confirm (ID: ${id})`);
      return;
    } catch {}

    // Versuch 2: accept_teleportation (neuerer Name)
    try {
      client.write('accept_teleportation', { teleportId: id });
      log('✅', `accept_teleportation (ID: ${id})`);
      return;
    } catch {}

    // Versuch 3: id als Feldname
    try {
      client.write('teleport_confirm', { id });
      log('✅', `teleport_confirm {id} (ID: ${id})`);
      return;
    } catch {}

    log('❌', `Alle teleport_confirm Versuche fehlgeschlagen für ID: ${id}`);
  } catch (e) {
    log('❌', `writeRawTeleportConfirm Fehler: ${e.message}`);
  }
}

// ===== CLIENT CLEANUP =====
function destroyClient() {
  if (!client) return;
  try { client.removeAllListeners(); client.end(); } catch {}
  client      = null;
  isConnected = false;
}

// ===== CHAT =====
function sendChat(message) {
  if (!client || !isConnected) return;
  try { client.write('chat', { message }); }
  catch (e) { log('❌', `Chat Fehler: ${e.message}`); }
}

// ===== ANTI-CHEAT =====
function answerAntiCheatCheck(checkName) {
  const channel = `${checkName}:check`;
  try {
    client.write('custom_payload', { channel, data: Buffer.alloc(1, 0x01) });
    log('✅', `Anti-Cheat beantwortet: ${channel}`);
  } catch (e) { log('❌', `Anti-Cheat Fehler (${channel}): ${e.message}`); }
}

// ===== BOT =====
function createBot() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectScheduled = false;
  destroyClient();

  log('🔌', `Verbinde mit ${config.host}:${config.port}...`);
  dns.lookup(config.host, (err, addr) => {
    if (err) log('⚠️', `DNS: ${err.message}`);
    else     log('🏓', `Server IP: ${addr}`);
  });

  try {
    client = mc.createClient({
      host: config.host, port: config.port,
      username: config.username, version: config.version,
      auth: false, hideErrors: false,
      // Deaktiviert den internen Keep-Alive Handler der Library
      // damit wir ihn selbst kontrollieren können
      keepAlive: false,
    });
  } catch (e) {
    log('❌', `Client Fehler: ${e.message}`);
    scheduleReconnect();
    return;
  }

  // Handlers fuer verbindung
  client.on('state', (newState, oldState) => {
    log('📡', `Status: ${oldState} → ${newState}`);
  });

  client.on('select_known_packs', (data) => {
    log('📦', 'select_known_packs empfangen');
    try {
      client.write('select_known_packs', { packs: [] });
      log('✅', 'select_known_packs gesendet');
    } catch (e) { log('❌', `Known Packs Fehler: ${e.message}`); }
  });

  client.on('add_resource_pack', (data) => {
    log('📦', 'Resource Pack empfangen');
    try { client.write('resource_pack_receive', { uuid: data.uuid, result: 3 }); log('📦', 'ACCEPTED'); } catch {}
    setTimeout(() => {
      try { client.write('resource_pack_receive', { uuid: data.uuid, result: 0 }); log('✅', 'LOADED'); } catch {}
    }, 1500);
  });

  client.on('finish_configuration', () => {
    log('⚙️', 'finish_configuration...');
    try { client.write('finish_configuration', {}); log('✅', 'Configuration abgeschlossen!'); }
    catch (e) { log('❌', `finish_configuration Fehler: ${e.message}`); }
  });

  client.on('keep_alive', (d) => {
    try { client.write('keep_alive', { keepAliveId: d.keepAliveId }); } catch {}
  });

  client.on('ping', (d) => {
    try { client.write('pong', { id: d.id }); } catch {}
  });

  client.on('login', (data) => {
    isConnected = true;
    log('✅', `Eingeloggt! Entity-ID: ${data.entityId}`);

    try {
      client.write('settings', {
        locale: 'de_DE', viewDistance: 8, chatFlags: 0, chatColors: true,
        skinParts: 127, mainHand: 1, enableTextFiltering: false, enableServerListing: true,
      });
      log('⚙️', 'Settings gesendet');
    } catch (e) { log('⚠️', `Settings Fehler: ${e.message}`); }

    try {
      client.write('custom_payload', { channel: 'minecraft:brand', data: writeString('vanilla') });
      log('✅', 'brand gesendet');
    } catch (e) { log('⚠️', `Brand Fehler: ${e.message}`); }

    try {
      const ch = ['xaeroworldmap:main','xaero:main','minimap:main',
                  'iip:main','iip:check','ix:main','ix:check',
                  'minimapa:check','fairxaero:check'].join('\0');
      client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from(ch,'utf8') });
      log('✅', 'Channels registriert');
    } catch (e) { log('⚠️', `Register Fehler: ${e.message}`); }

    setTimeout(() => {
      if (isConnected) sendChat('Casino-Bot ist online! Schreib !casino help');
    }, 20000);
  });

  // ── Position & Bewegungssimulation ──
  let lastPos      = { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 };
  let posHeartbeat = null;
  let tickCount    = 0;
  let sneaking     = false;

  client.on('position', (data) => {
    const id = data.teleportId;
    log('📍', `Pos: ${Math.round(data.x)}, ${Math.round(data.y)}, ${Math.round(data.z)} | TeleportID raw: ${id} (0x${(id>>>0).toString(16)})`);
    lastPos = { x: data.x, y: data.y, z: data.z, yaw: data.yaw, pitch: data.pitch };

    // Teleport bestätigen
    writeRawTeleportConfirm(id);

    // Eigene Position zurückschicken
    try {
      client.write('position_look', {
        x: data.x, y: data.y, z: data.z,
        yaw: data.yaw, pitch: data.pitch, flags: 0,
      });
      log('✅', 'position_look gesendet');
    } catch (e) { log('❌', `position_look Fehler: ${e.message}`); }

    // Tick-Loop: echter Client sendet jede Tick seine Position
    if (!posHeartbeat) {
      posHeartbeat = setInterval(() => {
        if (!isConnected) { clearInterval(posHeartbeat); posHeartbeat = null; return; }
        tickCount++;

        // Jeder Tick: Position senden
        try {
          client.write('position_look', {
            x: lastPos.x, y: lastPos.y, z: lastPos.z,
            yaw: lastPos.yaw, pitch: lastPos.pitch, flags: 0,
          });
        } catch {}

        // Alle 30 Ticks (1.5s): Sneak togglen
        if (tickCount % 30 === 0) {
          sneaking = !sneaking;
          try {
            client.write('entity_action', {
              entityId: 0, actionId: sneaking ? 0 : 1, jumpBoost: 0,
            });
          } catch {}
        }

        // Alle 200 Ticks (10s): kurzer Sprung
        if (tickCount % 200 === 0) {
          try {
            client.write('position_look', {
              x: lastPos.x, y: lastPos.y + 0.42, z: lastPos.z,
              yaw: lastPos.yaw, pitch: lastPos.pitch, flags: 0,
            });
          } catch {}
          setTimeout(() => {
            try {
              client.write('position_look', {
                x: lastPos.x, y: lastPos.y, z: lastPos.z,
                yaw: lastPos.yaw, pitch: lastPos.pitch, flags: 0,
              });
            } catch {}
          }, 400);
        }
      }, 50); // 20 TPS
    }
  });

  // Plugin-Channel Handshakes
  client.on('custom_payload', (data) => {
    const channel = data.channel || '';
    log('📡', `Custom Payload: ${channel}`);
    try {
      if (channel === 'minecraft:brand') {
        client.write('custom_payload', { channel: 'minecraft:brand', data: writeString('vanilla') });
        log('✅', 'brand beantwortet');
      } else if (channel === 'minecraft:register') {
        const ch = ['xaeroworldmap:main','xaero:main','minimap:main',
                    'iip:main','iip:check','ix:main','ix:check',
                    'minimapa:check','fairxaero:check'].join('\0');
        client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from(ch,'utf8') });
        log('✅', 'register beantwortet');
      } else if (['xaeroworldmap:main','xaero:main','minimap:main','iip:main','ix:main'].includes(channel)) {
        client.write('custom_payload', { channel, data: Buffer.alloc(1, 0x01) });
        log('✅', `Mod-Channel: ${channel}`);
      } else if (['iip:check','ix:check','minimapa:check','fairxaero:check'].includes(channel)) {
        client.write('custom_payload', { channel, data: Buffer.alloc(1, 0x01) });
        log('✅', `Anti-Cheat direct: ${channel}`);
      } else if (channel === 'vv:server_details') {
        log('ℹ️', 'vv:server_details ignoriert');
      } else {
        log('ℹ️', `Unbekannt: ${channel}`);
      }
    } catch (e) { log('❌', `custom_payload Fehler (${channel}): ${e.message}`); }
  });

  // System-Chat
  client.on('system_chat', (data) => {
    try {
      const text = extractText(data.content);
      if (text) log('📢', `System: ${text.substring(0, 120)}`);
      const norm = text.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const check of ['iip','ix','minimapa','fairxaero']) {
        if (norm === check) { answerAntiCheatCheck(check); return; }
      }
      const chatMatch = stripFormatting(text).match(/^<([^>]+)>\s+(.+)$/);
      if (chatMatch) {
        const username = chatMatch[1].trim();
        const message  = chatMatch[2].trim();
        if (username !== config.username) {
          log('💬', `${username}: ${message}`);
          handleChatMessage(username, message, sendChat, activeGames, stats, config);
        }
      }
    } catch {}
  });

  // Player-Chat
  client.on('player_chat', (data) => {
    try {
      const username = extractUsername(data.senderName);
      const message  = data.plainMessage || (typeof data.message === 'string' ? data.message : '') || '';
      if (!username || username === config.username) return;
      log('💬', `${username}: ${message}`);
      handleChatMessage(username, message, sendChat, activeGames, stats, config);
    } catch {}
  });

  // Disconnect
  client.on('kick_disconnect', (data) => {
    isConnected = false;
    log('⚠️', `Kick RAW: ${JSON.stringify(data.reason)}`);
    try {
      const reason = extractText(typeof data.reason === 'string' ? JSON.parse(data.reason) : data.reason);
      log('⚠️', `Gekickt: ${reason || JSON.stringify(data.reason)}`);
    } catch { log('⚠️', `Gekickt: ${JSON.stringify(data.reason)}`); }
    scheduleReconnect();
  });

  client.on('end', (reason) => {
    if (reconnectScheduled) return;
    isConnected = false;
    log('🔌', `Verbindung beendet${reason ? ': ' + reason : ''}`);
    scheduleReconnect();
  });

  client.on('error', (err) => {
    if (reconnectScheduled) return;
    isConnected = false;
    if (err.message && err.message.includes('inflate')) return;
    log('❌', `Fehler: ${err.message}`);
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

// ===== START =====
printBanner(config);
createBot();
rl.prompt(true);