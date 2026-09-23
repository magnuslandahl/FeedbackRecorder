'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

// Draws the app icon and writes build/icon.png plus build/icon.ico.
//
//   npx electron scripts/make-icon.js
//
// The mark is a recorded screen inside a written handoff: the complete product
// promise, rather than a generic camera or microphone. The speech-bubble tail
// reads as narration at large sizes and as a distinctive document silhouette at
// taskbar sizes. Small renders are deliberately simplified instead of relying
// on a detailed 1024px drawing to survive downscaling.

const OUT = path.join(__dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const DRAW = `(size) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  const u = size / 1024; // design at 1024 and scale
  const small = size <= 64;

  // A cool blue-to-violet tile ties the icon to the app's accent without using
  // the flat mid-blue slab of the old mark.
  const r = 224 * u;
  const bg = c.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#1769f5');
  bg.addColorStop(0.52, '#4167ee');
  bg.addColorStop(1, '#7654e8');
  c.fillStyle = bg;
  c.beginPath();
  c.roundRect(0, 0, size, size, r);
  c.fill();

  // Lighting is clipped to the tile so transparent corners stay clean in the
  // Dock, taskbar and installer.
  c.save();
  c.beginPath();
  c.roundRect(0, 0, size, size, r);
  c.clip();
  const light = c.createRadialGradient(250 * u, 90 * u, 0, 250 * u, 90 * u, 860 * u);
  light.addColorStop(0, 'rgba(255,255,255,0.30)');
  light.addColorStop(0.55, 'rgba(255,255,255,0.07)');
  light.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = light;
  c.fillRect(0, 0, size, size);
  if (!small) {
    c.strokeStyle = 'rgba(255,255,255,0.16)';
    c.lineWidth = 64 * u;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(104 * u, 206 * u);
    c.bezierCurveTo(326 * u, 40 * u, 710 * u, 55 * u, 916 * u, 260 * u);
    c.stroke();
  }
  c.restore();

  const card = small
    ? { x: 148, y: 158, width: 710, height: 660, radius: 108 }
    : { x: 174, y: 170, width: 676, height: 636, radius: 94 };
  const x = card.x * u;
  const y = card.y * u;
  const width = card.width * u;
  const height = card.height * u;
  const radius = card.radius * u;

  // One continuous bubble/document silhouette. The tail says "spoken
  // walkthrough"; the two lines below the screen say "written handoff".
  const bubble = () => {
    c.beginPath();
    c.moveTo(x + radius, y);
    c.lineTo(x + width - radius, y);
    c.quadraticCurveTo(x + width, y, x + width, y + radius);
    c.lineTo(x + width, y + height - radius);
    c.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    c.lineTo((card.x + 300) * u, y + height);
    c.lineTo((card.x + 176) * u, (card.y + card.height + 112) * u);
    c.lineTo((card.x + 176) * u, y + height);
    c.lineTo(x + radius, y + height);
    c.quadraticCurveTo(x, y + height, x, y + height - radius);
    c.lineTo(x, y + radius);
    c.quadraticCurveTo(x, y, x + radius, y);
    c.closePath();
  };

  c.save();
  if (!small) {
    c.shadowColor = 'rgba(8,20,54,0.30)';
    c.shadowBlur = 34 * u;
    c.shadowOffsetY = 18 * u;
  }
  const paper = c.createLinearGradient(0, y, 0, y + height);
  paper.addColorStop(0, '#ffffff');
  paper.addColorStop(1, '#e9efff');
  c.fillStyle = paper;
  bubble();
  c.fill();
  c.restore();

  // The captured screen. It is deliberately dark so the waveform keeps enough
  // contrast in both the full icon and the 16px Windows resource.
  const screen = small
    ? { x: 210, y: 224, width: 604, height: 362, radius: 76 }
    : { x: 242, y: 236, width: 540, height: 330, radius: 64 };
  const screenBg = c.createLinearGradient(screen.x * u, screen.y * u, (screen.x + screen.width) * u, (screen.y + screen.height) * u);
  screenBg.addColorStop(0, '#172b59');
  screenBg.addColorStop(1, '#101a38');
  c.fillStyle = screenBg;
  c.beginPath();
  c.roundRect(screen.x * u, screen.y * u, screen.width * u, screen.height * u, screen.radius * u);
  c.fill();

  const wave = small
    ? [[262, 420], [354, 420], [401, 338], [456, 500], [514, 372], [568, 454], [622, 408], [750, 408]]
    : [[286, 410], [360, 410], [405, 338], [456, 490], [508, 374], [558, 448], [610, 404], [720, 404]];
  const waveStroke = c.createLinearGradient(wave[0][0] * u, 0, wave[wave.length - 1][0] * u, 0);
  waveStroke.addColorStop(0, '#9fe8ff');
  waveStroke.addColorStop(1, '#ffffff');
  c.strokeStyle = waveStroke;
  c.lineWidth = Math.max(1.25, (small ? 56 : 28) * u);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  wave.forEach(([pointX, pointY], index) => {
    if (index === 0) c.moveTo(pointX * u, pointY * u);
    else c.lineTo(pointX * u, pointY * u);
  });
  c.stroke();

  // Abstract text remains legible as text structure without pretending that the
  // icon contains words which disappear outside the 1024px marketing render.
  c.fillStyle = '#7990bd';
  c.beginPath();
  c.roundRect((small ? 240 : 252) * u, (small ? 644 : 646) * u, (small ? 390 : 368) * u, (small ? 34 : 24) * u, 20 * u);
  c.fill();
  c.fillStyle = '#a2b2d3';
  c.beginPath();
  c.roundRect((small ? 240 : 252) * u, (small ? 708 : 704) * u, (small ? 286 : 270) * u, (small ? 34 : 24) * u, 20 * u);
  c.fill();

  // The sole warm colour is the record state. A white keyline prevents it from
  // merging into either the paper or the violet background at small sizes.
  const dot = small
    ? { x: 786, y: 746, radius: 96, ring: 40 }
    : { x: 782, y: 744, radius: 82, ring: 25 };
  c.save();
  if (!small) {
    c.shadowColor = 'rgba(255,63,89,0.46)';
    c.shadowBlur = 30 * u;
  }
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.arc(dot.x * u, dot.y * u, (dot.radius + dot.ring) * u, 0, Math.PI * 2);
  c.fill();
  const red = c.createLinearGradient((dot.x - dot.radius) * u, (dot.y - dot.radius) * u, (dot.x + dot.radius) * u, (dot.y + dot.radius) * u);
  red.addColorStop(0, '#ff746f');
  red.addColorStop(1, '#ff3f5d');
  c.fillStyle = red;
  c.beginPath();
  c.arc(dot.x * u, dot.y * u, dot.radius * u, 0, Math.PI * 2);
  c.fill();
  if (!small) {
    c.fillStyle = 'rgba(255,255,255,0.28)';
    c.beginPath();
    c.arc((dot.x - 24) * u, (dot.y - 28) * u, 20 * u, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();

  return canvas.toDataURL('image/png');
}`;

function icoFrom(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  const directory = Buffer.alloc(16 * pngs.length);
  let offset = 6 + directory.length;

  pngs.forEach((entry, index) => {
    const at = index * 16;
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    directory.writeUInt8(0, at + 2);
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(entry.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, directory, ...pngs.map((entry) => entry.data)]);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const window = new BrowserWindow({ show: false, width: 64, height: 64 });
  await window.loadURL('data:text/html,<body></body>');

  const render = async (size) => {
    const dataUrl = await window.webContents.executeJavaScript(`(${DRAW})(${size})`);
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  };

  const master = await render(1024);
  fs.writeFileSync(path.join(OUT, 'icon.png'), master);
  console.log(`wrote build/icon.png (1024x1024, ${master.length} bytes)`);

  // The window header shows the mark too, and the renderer cannot reach outside
  // its own folder under the Content Security Policy.
  const logo = await render(64);
  const logoPath = path.join(__dirname, '..', 'src', 'renderer', 'logo.png');
  fs.writeFileSync(logoPath, logo);
  console.log(`wrote src/renderer/logo.png (64x64, ${logo.length} bytes)`);

  const entries = [];
  for (const size of SIZES) {
    entries.push({ size, data: await render(size) });
  }

  const ico = icoFrom(entries);
  fs.writeFileSync(path.join(OUT, 'icon.ico'), ico);
  console.log(`wrote build/icon.ico (${SIZES.join(', ')}, ${ico.length} bytes)`);

  // An icon is only good if it survives being small. This sheet magnifies the
  // real 16/24/32/48 renders without smoothing, which is the only honest way to
  // check a taskbar icon without squinting at one.
  const preview = process.argv.find((arg) => arg.startsWith('--preview='));
  if (preview) {
    const small = entries.filter((entry) => entry.size <= 48);
    const dataUrls = small.map((entry) => `data:image/png;base64,${entry.data.toString('base64')}`);
    const sheet = await window.webContents.executeJavaScript(`(async () => {
      const sources = ${JSON.stringify(dataUrls)};
      const labels = ${JSON.stringify(small.map((e) => e.size))};
      const scale = 8;
      const pad = 24;
      const cell = 48 * scale;
      const canvas = document.createElement('canvas');
      canvas.width = pad + sources.length * (cell + pad);
      canvas.height = cell + pad * 3;
      const c = canvas.getContext('2d');
      c.imageSmoothingEnabled = false;
      c.fillStyle = '#14161a';
      c.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < sources.length; i += 1) {
        const image = new Image();
        await new Promise((r) => { image.onload = r; image.src = sources[i]; });
        const drawn = labels[i] * scale;
        const x = pad + i * (cell + pad) + (cell - drawn) / 2;
        c.drawImage(image, x, pad + (cell - drawn) / 2, drawn, drawn);
        c.fillStyle = '#98a1b0';
        c.font = '20px sans-serif';
        c.textAlign = 'center';
        c.fillText(labels[i] + 'px', pad + i * (cell + pad) + cell / 2, canvas.height - pad / 2);
      }
      return canvas.toDataURL('image/png');
    })()`);
    const file = preview.slice('--preview='.length);
    fs.writeFileSync(file, Buffer.from(sheet.split(',')[1], 'base64'));
    console.log(`wrote ${file}`);
  }

  app.exit(0);
});
