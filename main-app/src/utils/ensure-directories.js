const fs = require("fs");

function ensureDirectories(paths) {
  paths.forEach((directoryPath) => {
    if (!fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }
  });
}

module.exports = { ensureDirectories };
