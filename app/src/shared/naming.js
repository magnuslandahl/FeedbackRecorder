'use strict';

function pad(value, width) {
  return String(value).padStart(width, '0');
}

// Local time, matching the folder names the PowerShell tool produces, so
// packages from both tools sort together while they coexist.
function runFolderName(date) {
  const d = date instanceof Date ? date : new Date();
  return [
    d.getFullYear(),
    '-',
    pad(d.getMonth() + 1, 2),
    '-',
    pad(d.getDate(), 2),
    '-',
    pad(d.getHours(), 2),
    pad(d.getMinutes(), 2),
    pad(d.getSeconds(), 2)
  ].join('');
}

function frameFileName(index) {
  return `frame-${pad(index + 1, 2)}.png`;
}

// mm:ss, or h:mm:ss once a recording runs past an hour.
function formatTimecode(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${pad(minutes, 2)}:${pad(secs, 2)}`;
  return `${pad(minutes, 2)}:${pad(secs, 2)}`;
}

function formatDuration(seconds) {
  const value = Number(seconds) || 0;
  if (value < 60) return `${value.toFixed(1)} s`;
  return `${formatTimecode(value)} (${value.toFixed(1)} s)`;
}

module.exports = { runFolderName, frameFileName, formatTimecode, formatDuration };
