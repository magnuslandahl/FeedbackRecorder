'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

// Draws the app icon and writes build/icon.png, build/icon-mac.png and
// build/icon.ico.
//
//   npx electron scripts/make-icon.js
//
// The mark is the product in three strokes: viewfinder corners for the screen
// you frame, a record dot, and voice bars for the narration. It is flat on
// purpose; the earlier gloss arc and specular highlight dated it and blurred at
// taskbar sizes. Small renders drop the voice bars and thicken everything
// rather than trusting a 1024px drawing to survive downscaling.

const OUT = path.join(__dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const DRAW = `(size) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d');
  const u = size / 1024; // design at 1024 and scale
  const tiny = size <= 32;
  const small = size <= 64;

  const r = 232 * u;
  const bg = c.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#3a7bff');
  bg.addColorStop(1, '#5b3ae0');
  c.fillStyle = bg;
  c.beginPath();
  c.roundRect(0, 0, size, size, r);
  c.fill();

  // A soft top light gives depth without the glossy arc of the old icon.
  if (!small) {
    c.save();
    c.beginPath();
    c.roundRect(0, 0, size, size, r);
    c.clip();
    const light = c.createRadialGradient(512 * u, -120 * u, 0, 512 * u, -120 * u, 900 * u);
    light.addColorStop(0, 'rgba(255,255,255,0.22)');
    light.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = light;
    c.fillRect(0, 0, size, size);
    c.restore();
  }

  // Viewfinder corners: the screen region being framed.
  const inset = tiny ? 150 : 196;
  const arm = tiny ? 220 : 168;
  const bend = tiny ? 56 : 72;
  c.strokeStyle = '#ffffff';
  c.lineWidth = Math.max(1.5, (tiny ? 100 : small ? 76 : 60) * u);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const lo = inset * u;
  const hi = (1024 - inset) * u;
  const a = arm * u;
  const k = bend * u;
  [[lo, lo, 1, 1], [hi, lo, -1, 1], [lo, hi, 1, -1], [hi, hi, -1, -1]].forEach(([x, y, dx, dy]) => {
    c.beginPath();
    c.moveTo(x, y + dy * a);
    c.lineTo(x, y + dy * k);
    c.quadraticCurveTo(x, y, x + dx * k, y);
    c.lineTo(x + dx * a, y);
    c.stroke();
  });

  // Record dot, then the voice. At taskbar sizes the dot alone carries it.
  const dot = tiny ? { x: 512, y: 512, radius: 196 } : { x: 382, y: 512, radius: 112 };
  const red = c.createLinearGradient(0, (dot.y - dot.radius) * u, 0, (dot.y + dot.radius) * u);
  red.addColorStop(0, '#ff6b6b');
  red.addColorStop(1, '#f2364f');
  c.fillStyle = red;
  c.beginPath();
  c.arc(dot.x * u, dot.y * u, dot.radius * u, 0, Math.PI * 2);
  c.fill();
  if (!tiny) {
    c.strokeStyle = '#ffffff';
    c.lineWidth = (small ? 20 : 14) * u;
    c.stroke();
  }

  if (!tiny) {
    const width = small ? 64 : 54;
    const bars = small
      ? [[578, 150], [672, 270], [766, 180]]
      : [[562, 132], [644, 252], [726, 168]];
    c.fillStyle = '#ffffff';
    bars.forEach(([x, height]) => {
      c.beginPath();
      c.roundRect((x - width / 2) * u, (512 - height / 2) * u, width * u, height * u, (width / 2) * u);
      c.fill();
    });
  }

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

  // macOS draws app icons on a grid with transparent margin around the tile and
  // a soft shadow under it; a full-bleed tile looks oversized beside every
  // other icon in the Dock. 824 px of body on the 1024 canvas is Apple's grid.
  const macDataUrl = await window.webContents.executeJavaScript(`(async () => {
    const image = new Image();
    await new Promise((r) => { image.onload = r; image.src = ${JSON.stringify(
      `data:image/png;base64,${master.toString('base64')}`
    )}; });
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const c = canvas.getContext('2d');
    c.shadowColor = 'rgba(0, 0, 0, 0.28)';
    c.shadowBlur = 28;
    c.shadowOffsetY = 12;
    c.drawImage(image, 100, 92, 824, 824);
    return canvas.toDataURL('image/png');
  })()`);
  const mac = Buffer.from(macDataUrl.split(',')[1], 'base64');
  fs.writeFileSync(path.join(OUT, 'icon-mac.png'), mac);
  console.log(`wrote build/icon-mac.png (1024x1024 on the macOS grid, ${mac.length} bytes)`);

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
