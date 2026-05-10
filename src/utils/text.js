function stripFormatting(value) {
  return String(value ?? '').replace(/\u00a7[0-9a-fk-or]/gi, '').trim();
}

function extractText(content) {
  if (content == null) return '';

  try {
    if (typeof content === 'string') {
      try {
        return extractText(JSON.parse(content));
      } catch {
        return stripFormatting(content);
      }
    }

    if (Buffer.isBuffer(content)) {
      return stripFormatting(content.toString('utf8'));
    }

    if (typeof content !== 'object') {
      return stripFormatting(content);
    }

    let text = '';
    if (typeof content.text === 'string') text += content.text;
    if (typeof content.value === 'string') text += content.value;
    if (content.value && typeof content.value === 'object') text += extractText(content.value);
    if (typeof content.translate === 'string' && !content.text && !content.extra) text += content.translate;
    if (Array.isArray(content.extra)) text += content.extra.map(extractText).join('');

    return stripFormatting(text);
  } catch {
    return '';
  }
}

function extractUsername(senderName) {
  return stripFormatting(extractText(senderName));
}

module.exports = {
  stripFormatting,
  extractText,
  extractUsername
};