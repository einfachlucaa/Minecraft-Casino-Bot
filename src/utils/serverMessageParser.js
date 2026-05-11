const { stripFormatting } = require('./text');
const { parseMoney, moneyPattern } = require('./money');

const PLAYER = String.raw`[.!]?[A-Za-z0-9_\-]{1,20}`;

function normalizeMessage(text) {
  return stripFormatting(text)
      .replace(/\u00bb/g, '»')
      .replace(/Â»/g, '»')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, ' ')
      .replace(/\s*:\s*/g, ': ')
      .trim();
}

function parsePrivateMessage(text, botName, config = {}) {
  const message = normalizeMessage(text);
  const custom = matchCustomPattern(message, config.privateMessagePatterns, ['player', 'message']);
  if (custom) return custom;

  const bot = escapeRegExp(botName || '');
  const target = `du|dir|mir|me|you|dich|ich|${bot}`;
  const arrow = String.raw`(?:->|>|»|<<|<-)`;
  const patterns = [
    // Accept bracketed MSG/PM lines like "[MSG] .player: message" or "MSG player: message"
    new RegExp(`^\\[?(?:MSG|PM|Nachricht)\\]?\\s*(${PLAYER})\\s*:?\\s*(.+)$`, 'i'),
    new RegExp(`^\\[?Nachricht\\]?\\s*(${PLAYER})\\s*${arrow}\\s*(?:${target})\\s*:?\\s*(.+)$`, 'i'),
    new RegExp(`^\\[?Nachricht\\]?\\s*(?:von|from)\\s+(${PLAYER})\\s*(?:an|to)\\s*(?:${target})\\s*:?\\s*(.+)$`, 'i'),
    new RegExp(`^\\[?MSG\\]?\\s*(${PLAYER})\\s*${arrow}\\s*(?:${target})\\s*:?\\s*(.+)$`, 'i'),
    new RegExp(`^\\[?MSG\\]?\\s*(?:von|from)\\s+(${PLAYER})\\s*(?:an|to)\\s*(?:${target})\\s*:?\\s*(.+)$`, 'i'),
    new RegExp(`^\\[?PM\\]?\\s*(${PLAYER})\\s*${arrow}\\s*(?:${target})\\s*:?\\s*(.+)$`, 'i'),
    new RegExp(`^\\[?(${PLAYER})\\s*${arrow}\\s*(?:${target})\\]?\\s*:?\\s*(.+)$`, 'i'),
    new RegExp(`^(?:From|Von)\\s+(${PLAYER})\\s*:?\\s*(.+)$`, 'i'),
    new RegExp(`^(?:Nachricht|MSG|PM)\\s+(?:von|from)\\s+(${PLAYER})(?:\\s+(?:an|to)\\s+(?:${target}))?\\s*:?\\s*(.+)$`, 'i'),
    new RegExp(`^(${PLAYER})\\s*(?:»|->|>)\\s*(?:${target})\\s*:?\\s*(.+)$`, 'i'),
    new RegExp(`^\\[(?:${PLAYER}\\s*)?(${PLAYER})\\s*(?:->|>|»)\\s*(?:${target})\\]\\s*(.+)$`, 'i'),
    new RegExp(`^(${PLAYER})\\s+(?:whispers?|fluestert|sagt dir|schreibt dir)\\s*:?\\s*(.+)$`, 'i')
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return { player: match[1], message: match[2].trim() };
  }

  return null;
}

function parsePayment(text, botName, config = {}) {
  const message = normalizeMessage(text);
  const custom = matchCustomPattern(message, config.paymentPatterns, ['player', 'amount']);
  if (custom) {
    const amount = parseMoney(custom.amount);
    return amount == null ? null : { player: custom.player, amount };
  }
  if (looksLikeChatLine(message)) return null;

  const broadPayment = parseBroadPayment(message);
  if (broadPayment) return broadPayment;

  const bot = escapeRegExp(botName || '');
  const amount = moneyPattern();
  const bracketedPayment = new RegExp(`^\\[?(?:Zahlung|Payment|Pay)\\]?\\s*:?\\s*(${PLAYER})\\s*(?:->|>|\\u00bb|»)\\s*(?:${bot}|dir|you)\\s*:?\\s*${amount}`, 'i');
  const arrow = String.raw`(?:->|>|»)`;
  const patterns = [
    bracketedPayment,
    new RegExp(`^(?:\\[[^\\]]+\\])?\\s*Du\\s*hast\\s*\\$?\\s*([0-9][0-9.,]*)\\s*von\\s*(${PLAYER})\\s*erhalten\\.?$`, 'i'),
    new RegExp(`^(?:\\[[^\\]]+\\])?\\s*Du\\s+hast\\s+${amount}\\s+(?:von|from)\\s+(${PLAYER})\\s*(?:erhalten|received|bekommen)?\\.?$`, 'i'),
    new RegExp(`^(?:\\[[^\\]]+\\])?\\s*(?:Zahlung|Payment|Pay)\\s*:?\\s*(${PLAYER})\\s*(?:->|>|»)\\s*(?:${bot}|dir|you)\\s*:?\\s*${amount}`, 'i'),
    new RegExp(`^(${PLAYER})\\s+(?:hat\\s+dir|paid\\s+you|sent\\s+you|ueberweist\\s+dir)\\s+${amount}`, 'i'),
    new RegExp(`^(${PLAYER})\\s+(?:hat|sendet|zahlt|ueberweist|\\u00fcberweist)\\s+(?:dir|an\\s+dich)\\s+${amount}`, 'i'),
    new RegExp(`^(?:Du\\s+hast|You\\s+received)\\s+${amount}\\s+(?:von|from)\\s+(${PLAYER})`, 'i'),
    new RegExp(`^\\+\\s*${amount}\\s+(?:von|from)\\s+(${PLAYER})`, 'i'),
    new RegExp(`^(${PLAYER})\\s*${arrow}\\s*(?:${bot}|dir|you)\\s*${amount}`, 'i')
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match) continue;

    const firstAmount = parseMoney(match[1]);
    if (firstAmount != null) {
      return { player: match[2], amount: firstAmount };
    }

    return { player: match[1], amount: parseMoney(match[2]) };
  }

  return null;
}

function parseBroadPayment(message) {
  const moneyValue = String.raw`(?<amount>\$?\s*[0-9][0-9.,]*\s*(?:\$|\u20ac|dollar|coins?)?)`;
  const playerValue = String.raw`(?<player>[.!]?[A-Za-z0-9_]{3,16})`;
  const patterns = [
    new RegExp(`(?:Du\\s+hast|Du\\s+erh(?:a|\\u00e4)ltst|Du\\s+bekommst|You\\s+received).*?${moneyValue}\\s+(?:von|from)\\s+${playerValue}`, 'i'),
    new RegExp(`${playerValue}.*?(?:hat\\s+dir|sendet\\s+dir|zahlt\\s+dir|ueberweist\\s+dir|\\u00fcberweist\\s+dir|paid\\s+you|sent\\s+you).*?${moneyValue}`, 'i'),
    new RegExp(`${playerValue}.*?(?:hat|sendet|zahlt|ueberweist|\\u00fcberweist).*?(?:dir|an\\s+dich).*?${moneyValue}`, 'i'),
    new RegExp(`(?:Zahlung|Payment).*?(?:von|from)\\s+${playerValue}.*?${moneyValue}`, 'i')
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match?.groups) continue;

    const amount = parseMoney(match.groups.amount);
    const player = match.groups.player;
    if (player && amount != null) return { player, amount };
  }

  return null;
}

function parseBalance(text, config = {}) {
  const message = normalizeMessage(text);
  if (looksLikePaymentText(message)) return null;
  if (looksLikeOutgoingPaymentText(message)) return null;
  if (looksLikeBankText(message)) return null;
  if (looksLikeChatLine(message)) return null;

  const custom = matchCustomPattern(message, config.balancePatterns, ['amount']);
  if (custom) return parseMoney(custom.amount);

  const amount = moneyPattern();
  const requiredMoney = requiredMoneyPattern();
  const patterns = [
    // NitroMC format: "NITROMC»Kontostand: $89,942.456" or similar server-prefixed formats
    new RegExp(`»\\s*(?:Kontostand|Balance|Guthaben|Money|Konto|Geld|Coins?)\\s*:\\s*${amount}`, 'i'),
    new RegExp(`(?:Kontostand|Balance|Guthaben|Money|Konto|Geld|Coins?)\\s*:\\s*${amount}`, 'i'),
    new RegExp(`(?:Kontostand|Balance|Guthaben|Money|Konto|Privatkonto|Geld|Coins?)\\s*(?:von|for)?\\s*[^0-9$\\u20ac]{0,60}\\s*${amount}`, 'i'),
    new RegExp(`(?:Dein\\s+Kontostand|Dein\\s+Guthaben|Your\\s+balance)\\s*(?:betr(?:\\u00e4|ae)gt|ist|is)?\\s*:?\\s*${amount}`, 'i'),
    new RegExp(`(?:Dein\\s+Geld|Deine\\s+Coins?|Your\\s+money)\\s*(?:betr(?:\\u00e4|ae)gt|ist|is)?\\s*:?\\s*${amount}`, 'i'),
    new RegExp(`(?:Du\\s+hast|Du\\s+besitzt|Du\\s+verf(?:\\u00fc|ue)gst\\s+(?:ueber|\\u00fcber)|You\\s+have)\\s+${requiredMoney}`, 'i')
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return parseMoney(match.find((part, index) => index > 0 && part != null));
  }

  const singleEconomyAmount = parseSingleEconomyAmount(message);
  if (singleEconomyAmount != null) return singleEconomyAmount;

  return null;
}

function looksLikePaymentText(message) {
  return /(?:\bvon\b|\bfrom\b).{0,40}(?:erhalten|received|bekommen)/i.test(message)
      || /(?:hat\s+dir|sendet\s+dir|zahlt\s+dir|ueberweist\s+dir|\u00fcberweist\s+dir|paid\s+you|sent\s+you)/i.test(message)
      || /(?:hat|sendet|zahlt|ueberweist|\u00fcberweist).{0,30}(?:dir|an\s+dich)/i.test(message)
      || /(?:zahlung|payment).{0,80}(?:\bvon\b|\bfrom\b)/i.test(message);
}

function looksLikeOutgoingPaymentText(message) {
  return /(?:du|you)\s*hast\s*\$?\s*[0-9][0-9.,]*\s*(?:\$|\u20ac|dollar|coins?)?\s*(?:an|to)\s*[.!]?[a-z0-9_]{3,16}\s*(?:gezahlt|gesendet|ueberwiesen|\u00fcberwiesen|paid|sent)?\.?$/i.test(message)
      || /(?:gezahlt|gesendet|ueberwiesen|\u00fcberwiesen|paid|sent).{0,80}(?:an|to)\s*[.!]?[a-z0-9_]{3,16}/i.test(message);
}

function looksLikeBankText(message) {
  const normalized = message.toLowerCase();
  return /\bbank\b|bankkonto|bank-guthaben|bankguthaben/.test(normalized);
}

function requiredMoneyPattern() {
  const number = String.raw`([0-9][0-9.,]*)`;
  return String.raw`(?:\$\s*${number}|${number}\s*(?:\$|\u20ac|dollar|coins?))`;
}

function looksLikeChatLine(message) {
  const firstColon = message.indexOf(':');
  if (firstColon <= 0) return false;

  const header = message.slice(0, firstColon).trim().toLowerCase();

  // If the header contains economy keywords it's a balance message, not chat
  if (/(privatkonto|kontostand|balance|guthaben|money|konto|geld|coins?|dollar|zahlung|payment|pay)/.test(header)) return false;

  // Handle server-prefixed formats like "NITROMC»Kontostand: $..." — check part after » too
  const arrowIdx = header.indexOf('»');
  if (arrowIdx >= 0) {
    const afterArrow = header.slice(arrowIdx + 1).trim();
    if (/(kontostand|balance|guthaben|money|konto|geld|coins?)/.test(afterArrow)) return false;
  }

  return firstColon <= 80 && /[a-z0-9_]/i.test(header);
}

function parseSingleEconomyAmount(message) {
  const normalized = message.toLowerCase();
  if (!/(privatkonto|kontostand|balance|guthaben|money|konto|geld|coins?|dollar|\$)/i.test(normalized)) return null;

  const matches = [...message.matchAll(/(?:\$\s*)?[0-9][0-9.,]*(?:\s*(?:\$|\u20ac|dollar|coins?))?/gi)]
      .map((match) => match[0])
      .filter((value) => parseMoney(value) != null);

  if (matches.length !== 1) return null;
  return parseMoney(matches[0]);
}

function looksEconomyRelated(text, config = {}) {
  const message = normalizeMessage(text).toLowerCase();
  if (/^\[nachricht\]\s*du\s*(?:->|>)/i.test(message)) return false;
  if (/^\[(?:msg|pm|nachricht)\]/i.test(message)) return true;
  if (/^\[[^\]]+\]\s*du\s*hast\s*\$?[0-9][0-9.,]*\s*an\s*[.!]?[a-z0-9_]{3,16}\s*gezahlt\.?$/i.test(message)) return false;
  const keywords = Array.isArray(config.economyKeywords) && config.economyKeywords.length
      ? config.economyKeywords
      : ['pay', 'geld', 'money', 'balance', 'kontostand', 'guthaben', 'konto', 'zahlung', 'received', 'gezahlt', 'ueberweis'];
  return keywords.some((keyword) => message.includes(String(keyword).toLowerCase()));
}

function matchCustomPattern(message, patterns, fields) {
  if (!Array.isArray(patterns)) return null;

  for (const rawPattern of patterns) {
    try {
      const pattern = new RegExp(String(rawPattern), 'i');
      const match = message.match(pattern);
      if (!match) continue;

      const groups = match.groups || {};
      const result = {};
      for (const field of fields) {
        result[field] = groups[field];
      }

      if (!result.player && fields.includes('player')) result.player = match[1];
      if (!result.amount && fields.includes('amount')) result.amount = match[2] || match[1];
      if (!result.message && fields.includes('message')) result.message = match[2] || match[1];

      if (fields.every((field) => result[field] != null && String(result[field]).trim() !== '')) {
        return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, String(value).trim()]));
      }
    } catch {
      continue;
    }
  }

  return null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  normalizeMessage,
  parsePrivateMessage,
  parsePayment,
  parseBalance,
  looksEconomyRelated
};