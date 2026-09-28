'use strict';

const SCENES = [
  {
    section: 'Profile',
    title: 'Notification preferences',
    description: 'Choose when project updates should reach you.',
    selected: 'Only when mentioned',
    action: 'Save preferences'
  },
  {
    section: 'Profile',
    title: 'Notification preferences',
    description: 'Choose when project updates should reach you.',
    selected: 'All activity',
    action: 'Save preferences'
  },
  {
    section: 'Profile',
    title: 'Notification preferences',
    description: 'Changes saved for this workspace.',
    selected: 'All activity',
    action: 'Saved'
  }
];

function drawSource(sceneExpression) {
  const scenes = JSON.stringify(SCENES);
  return `
    const scenes = ${scenes};
    const item = scenes[(${sceneExpression}) % scenes.length];
    const rounded = (x, y, width, height, radius, fill, stroke) => {
      context.beginPath();
      context.roundRect(x, y, width, height, radius);
      context.fillStyle = fill;
      context.fill();
      if (stroke) {
        context.strokeStyle = stroke;
        context.lineWidth = 2;
        context.stroke();
      }
    };

    context.fillStyle = '#eef2f7';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#172033';
    context.fillRect(0, 0, canvas.width, 76);

    context.fillStyle = '#ffffff';
    context.font = '700 24px system-ui, sans-serif';
    context.fillText('Demo workspace', 40, 48);
    context.fillStyle = '#aebbd0';
    context.font = '500 16px system-ui, sans-serif';
    context.fillText('Overview', 890, 46);
    context.fillText('Settings', 1035, 46);

    rounded(52, 122, 230, 520, 18, '#ffffff', '#d8dee9');
    context.fillStyle = '#64748b';
    context.font = '600 15px system-ui, sans-serif';
    context.fillText(item.section.toUpperCase(), 82, 164);
    ['Account', 'Appearance', 'Notifications', 'Privacy'].forEach((label, index) => {
      if (label === 'Notifications') rounded(70, 248 + index * 58, 194, 42, 10, '#e8efff');
      context.fillStyle = label === 'Notifications' ? '#245ccc' : '#48566a';
      context.font = label === 'Notifications'
        ? '700 18px system-ui, sans-serif'
        : '500 18px system-ui, sans-serif';
      context.fillText(label, 88, 276 + index * 58);
    });

    rounded(320, 122, 908, 520, 18, '#ffffff', '#d8dee9');
    context.fillStyle = '#172033';
    context.font = '700 34px system-ui, sans-serif';
    context.fillText(item.title, 372, 188);
    context.fillStyle = '#64748b';
    context.font = '400 19px system-ui, sans-serif';
    context.fillText(item.description, 372, 226);

    context.fillStyle = '#334155';
    context.font = '600 18px system-ui, sans-serif';
    context.fillText('Send me updates for', 372, 296);
    ['Only when mentioned', 'All activity', 'Never'].forEach((label, index) => {
      const y = 340 + index * 62;
      rounded(372, y, 500, 46, 10, '#f8fafc', '#cbd5e1');
      context.beginPath();
      context.arc(398, y + 23, 9, 0, Math.PI * 2);
      context.strokeStyle = '#7b8aa0';
      context.lineWidth = 2;
      context.stroke();
      if (label === item.selected) {
        context.beginPath();
        context.arc(398, y + 23, 5, 0, Math.PI * 2);
        context.fillStyle = '#2563eb';
        context.fill();
      }
      context.fillStyle = '#243044';
      context.font = '500 17px system-ui, sans-serif';
      context.fillText(label, 422, y + 29);
    });

    rounded(1002, 548, 174, 52, 10, item.action === 'Saved' ? '#16794b' : '#2563eb');
    context.fillStyle = '#ffffff';
    context.font = '700 17px system-ui, sans-serif';
    context.fillText(item.action, item.action === 'Saved' ? 1060 : 1022, 580);
  `;
}

function thumbnailDataUrl() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
      <rect width="320" height="200" rx="8" fill="#eef2f7"/>
      <rect width="320" height="28" fill="#172033"/>
      <rect x="14" y="44" width="70" height="140" rx="6" fill="#fff" stroke="#d8dee9"/>
      <rect x="94" y="44" width="212" height="140" rx="6" fill="#fff" stroke="#d8dee9"/>
      <rect x="108" y="68" width="116" height="12" rx="4" fill="#172033"/>
      <rect x="108" y="92" width="164" height="8" rx="4" fill="#94a3b8"/>
      <rect x="108" y="118" width="126" height="28" rx="6" fill="#e8efff" stroke="#9bb7ef"/>
      <rect x="244" y="154" width="44" height="18" rx="5" fill="#2563eb"/>
    </svg>
  `;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

module.exports = { SCENES, drawSource, thumbnailDataUrl };
