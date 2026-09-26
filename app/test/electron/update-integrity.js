'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { app } = require('electron');

const ROOT = path.join(__dirname, '..', '..');
const CONTENT = Buffer.from('verified updater fixture');
const DIGEST = crypto.createHash('sha256').update(CONTENT).digest('hex');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

app.whenReady().then(async () => {
  const updater = require(path.join(ROOT, 'src', 'main', 'updater.js'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-update-integrity-'));
  const target = path.join(root, 'FeedbackRecorder-test.exe');
  const checks = [];
  const check = (name, passed, detail) => checks.push({ name, passed, detail });

  const server = http.createServer((request, response) => {
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': CONTENT.length
    });
    response.end(request.url === '/tampered' ? Buffer.from('tampered updater fixture') : CONTENT);
  });

  try {
    const address = await listen(server);
    let progress = 0;
    await updater.download(
      `http://127.0.0.1:${address.port}/valid`,
      target,
      DIGEST,
      (fraction) => {
        progress = fraction;
      }
    );

    check('a verified download is promoted from its partial file', fs.readFileSync(target).equals(CONTENT));
    check('verified progress reaches the end', progress === 1, String(progress));
    check('a successful download leaves no partial file', !fs.existsSync(`${target}.part`));

    fs.writeFileSync(target, Buffer.from('stale installer'));
    let mismatch = '';
    try {
      await updater.download(
        `http://127.0.0.1:${address.port}/tampered`,
        target,
        DIGEST
      );
    } catch (error) {
      mismatch = error.message;
    }
    check('a checksum mismatch is visible', /did not match/.test(mismatch), mismatch);
    check('a mismatch removes the target', !fs.existsSync(target));
    check('a mismatch removes the partial file', !fs.existsSync(`${target}.part`));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }

  checks.forEach((item) => {
    console.log(`${item.passed ? 'ok  ' : 'FAIL'} ${item.name}${item.detail ? ` - ${item.detail}` : ''}`);
  });
  const passed = checks.filter((item) => item.passed).length;
  console.log(`\n${passed}/${checks.length} checks passed`);
  app.exit(passed === checks.length ? 0 : 1);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
