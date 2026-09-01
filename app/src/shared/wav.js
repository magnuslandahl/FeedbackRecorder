'use strict';

// 16-bit PCM WAV, mono. whisper.cpp wants 16 kHz mono, and an AudioContext
// created at 16000 Hz decodes straight into that rate, so no resampling code is
// needed here.

function mixToMono(channels) {
  if (!channels || channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];

  const length = channels[0].length;
  const mono = new Float32Array(length);
  for (let c = 0; c < channels.length; c += 1) {
    const channel = channels[c];
    for (let i = 0; i < length; i += 1) {
      mono[i] += channel[i];
    }
  }
  for (let i = 0; i < length; i += 1) {
    mono[i] /= channels.length;
  }
  return mono;
}

function clampSample(value) {
  if (value > 1) return 1;
  if (value < -1) return -1;
  return value;
}

function encodeWav(samples, sampleRate) {
  const count = samples ? samples.length : 0;
  const dataBytes = count * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < count; i += 1) {
    const value = clampSample(samples[i]);
    view.setInt16(offset, Math.round(value * 32767), true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

module.exports = { mixToMono, encodeWav };
