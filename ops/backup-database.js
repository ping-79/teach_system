#!/usr/bin/env node
'use strict';

process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning && warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message || '')) {
    return;
  }
  console.error(warning && warning.stack ? warning.stack : String(warning));
});

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function usage() {
  console.error('Usage: node backup-database.js <source-db> <target-db>');
}

function sqliteString(value) {
  return String(value).replace(/'/g, "''");
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function main() {
  const [, , sourceDbArg, targetDbArg] = process.argv;
  if (!sourceDbArg || !targetDbArg) {
    usage();
    process.exitCode = 2;
    return;
  }

  const sourceDb = path.resolve(sourceDbArg);
  const targetDb = path.resolve(targetDbArg);

  if (!fs.existsSync(sourceDb)) {
    fail(`Source database does not exist: ${sourceDb}`);
    return;
  }

  const walPath = `${sourceDb}-wal`;
  const shmPath = `${sourceDb}-shm`;
  if (fs.existsSync(walPath) || fs.existsSync(shmPath)) {
    console.error(
      'Warning: live WAL/SHM sidecar files were found. This script uses SQLite VACUUM INTO for a consistent backup; do not copy the .db file directly while the app is running.'
    );
  }

  const targetDir = path.dirname(targetDb);
  fs.mkdirSync(targetDir, { recursive: true });

  if (fs.existsSync(targetDb)) {
    fs.unlinkSync(targetDb);
  }

  let db;
  try {
    db = new DatabaseSync(sourceDb, { readOnly: true });
    db.exec(`VACUUM INTO '${sqliteString(targetDb)}'`);
  } finally {
    if (db) {
      db.close();
    }
  }

  const stat = fs.statSync(targetDb);
  if (!stat.isFile() || stat.size <= 0) {
    fail(`Backup file was not created or is empty: ${targetDb}`);
    return;
  }

  console.log(`Backup created: ${targetDb}`);
}

try {
  main();
} catch (error) {
  fail(error && error.stack ? error.stack : String(error));
}
