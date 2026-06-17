function decodeUploadedFilename(filename) {
  const raw = String(filename || "").trim();
  if (!raw) {
    return "";
  }

  try {
    const decoded = Buffer.from(raw, "latin1").toString("utf8");
    return shouldUseDecoded(raw, decoded) ? decoded : raw;
  } catch (_error) {
    return raw;
  }
}

function shouldUseDecoded(raw, decoded) {
  if (!decoded) {
    return false;
  }

  if (countCjk(decoded) > countCjk(raw)) {
    return true;
  }

  // Common mojibake markers after UTF-8 bytes were interpreted as Latin-1.
  return /Ã|å|ä|æ|ç|è|é|ê|ë|ì|í|î|ï|ð|ñ|ò|ó|ô|õ|ö|ù|ú|û|ü/.test(raw) &&
    !/Ã|å|ä|æ|ç|è|é|ê|ë|ì|í|î|ï|ð|ñ|ò|ó|ô|õ|ö|ù|ú|û|ü/.test(decoded);
}

function countCjk(value) {
  const matches = String(value || "").match(/[\u3400-\u9fff]/g);
  return matches ? matches.length : 0;
}

module.exports = {
  decodeUploadedFilename
};
