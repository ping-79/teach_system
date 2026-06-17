const net = require("net");

const databaseUrl = process.env.DATABASE_URL || "";
const timeoutMs = 120000;
const retryDelayMs = 2000;

function parseDatabaseUrl(url) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 3306)
    };
  } catch (_error) {
    return {
      host: "db",
      port: 3306
    };
  }
}

async function waitForPort({ host, port }) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const connected = await tryConnect(host, port);
    if (connected) {
      console.log(`Database is reachable at ${host}:${port}`);
      return;
    }

    console.log(`Waiting for database at ${host}:${port}...`);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  console.error(`Timed out waiting for database at ${host}:${port}`);
  process.exit(1);
}

function tryConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });

    socket.on("connect", () => {
      socket.end();
      resolve(true);
    });

    socket.on("error", () => {
      resolve(false);
    });

    socket.setTimeout(2000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

waitForPort(parseDatabaseUrl(databaseUrl));
