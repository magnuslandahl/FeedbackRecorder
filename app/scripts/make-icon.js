'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

// Draws the app icon and writes build/icon.png plus build/icon.ico.
//
//   npx electron scripts/make-icon.js
//
// The mark is a viewfinder with a record dot: the two things this app does that
// nothing else on the machine does — frame a part of the screen, and record it
// while you talk. Brackets and a dot survive being shrunk to 16 pixels, where a
// literal camera or microphone turns to mush.

const OUT = path.join(__dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const DRAW = `(size) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  const u = size / 1024; // design at 1024 and scale

  // Rounded square, so it reads as an app tile at every size.
  const r = 224 * u;
  const bg = c.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#3d6fe0');
  bg.addColorStop(0.55, '#4f8cff');
  bg.addColorStop(1, '#6f5cf0');
  c.fillStyle = bg;
  c.beginPath();
  c.roundRect(0, 0, size, size, r);
  c.fill();

  // A soft top highlight keeps it from looking flat next to native icons.
  const gloss = c.createLinearGradient(0, 0, 0, size * 0.6);
  gloss.addColorStop(0, 'rgba(255,255,255,0.20)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gloss;
  c.beginPath();
  c.roundRect(0, 0, size, size, r);
  c.fill();

  // Viewfinder brackets: four corners of a frame, never a closed rectangle, so
  // it reads as "choose an area" rather than "a photo".
  //
  // Small sizes are not the big one scaled down. At 16px a 68/1024 stroke is one
  // pixel and disappears, so the mark is drawn bolder and tighter the smaller it
  // gets — the usual reason icons look broken in a taskbar.
  const small = size <= 48;
  const inset = (small ? 196 : 232) * u;
  const arm = (small ? 208 : 176) * u;
  const w = Math.max(2, (small ? 116 : 68) * u);
  c.strokeStyle = '#ffffff';
  c.lineWidth = w;
  c.lineCap = 'round';
  c.lineJoin = 'round';

  const corner = (x, y, dx, dy) => {
    c.beginPath();
    c.moveTo(x + dx * arm, y);
    c.lineTo(x, y);
    c.lineTo(x, y + dy * arm);
    c.stroke();
  };

  corner(inset, inset, 1, 1);
  corner(size - inset, inset, -1, 1);
  corner(inset, size - inset, 1, -1);
  corner(size - inset, size - inset, -1, -1);

  // The record dot. Red against blue is the one colour pairing everyone already
  // reads as "recording".
  c.fillStyle = '#ff4d4d';
  c.beginPath();
  c.arc(size / 2, size / 2, (small ? 128 : 140) * u, 0, Math.PI * 2);
  c.fill();

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
