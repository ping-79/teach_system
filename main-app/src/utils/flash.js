function pushFlash(req, type, message) {
  if (!req.session.flash) {
    req.session.flash = [];
  }

  req.session.flash.push({ type, message });
}

function consumeFlash(req) {
  const messages = req.session.flash || [];
  req.session.flash = [];
  return messages;
}

module.exports = { pushFlash, consumeFlash };
