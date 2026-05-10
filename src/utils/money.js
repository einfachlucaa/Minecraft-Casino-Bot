function parseMoney(value) {
  if (value == null) return null;

  const raw = String(value)
      .toLowerCase()
      .replace(/\s/g, '')
      .replace(/\$/g, '')
      .replace(/\u20ac/g, '');

  if (!raw) return null;

  const suffixMatch = raw.match(/^(.*?)(mio|millionen|million|kk|k|m)$/);
  const suffix = suffixMatch?.[2] || '';
  let normalized = suffixMatch ? suffixMatch[1] : raw;
  normalized = normalized.replace(/[.,]+$/, '');
  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');

  if (hasComma && hasDot) {
    const lastComma = normalized.lastIndexOf(',');
    const lastDot = normalized.lastIndexOf('.');
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = normalized.split(',');
    normalized = suffix || parts[parts.length - 1]?.length === 2
        ? normalized.replace(',', '.')
        : normalized.replace(/,/g, '');
  } else if (hasDot) {
    const parts = normalized.split('.');
    normalized = (suffix && parts.length === 2) || (parts[parts.length - 1]?.length === 2 && parts.length === 2)
        ? normalized
        : normalized.replace(/\./g, '');
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;

  const multiplier = {
    k: 1000,
    m: 1000000,
    mio: 1000000,
    million: 1000000,
    millionen: 1000000,
    kk: 1000000
  }[suffix] || 1;

  return Math.floor(amount * multiplier);
}

function moneyPattern() {
  return String.raw`(?:\$?\s*)?([0-9][0-9.,]*)\s*(?:\$|\u20ac|dollar|coins?)?`;
}

module.exports = {
  parseMoney,
  moneyPattern
};