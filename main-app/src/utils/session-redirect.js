function redirectWithSession(req, res, targetPath) {
  if (!req.session || typeof req.session.save !== "function") {
    return res.redirect(targetPath);
  }

  return req.session.save(() => {
    res.redirect(targetPath);
  });
}

module.exports = { redirectWithSession };
