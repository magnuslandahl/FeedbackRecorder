'use strict';

// Narration level, measured rather than guessed.
//
// Evidence from real runs of the PowerShell tool this app replaces: speech
// averages about -27 dBFS, and the one run that produced an empty transcript
// averaged -48.9 dBFS. Runs at or below roughly -45 dBFS produced no usable
// speech at all. So "0 segments" is only ever reported together with a measured
// cause, because otherwise the user cannot tell whether the transcriber failed
// or the microphone did.

const TOO_QUIET_DBFS = -45;
const SILENCE_PEAK = 1e-4; // below this nothing was captured at all

function toDbfs(amplitude) {
  const a = Math.abs(Number(amplitude) || 0);
  if (a <= 0) return -Infinity;
  return 20 * Math.log10(a);
}

// samples: Float32Array (or any array-like of numbers) in the range -1..1.
function measureLevels(samples) {
  const length = samples ? samples.length : 0;
  if (!length) {
    return { rmsDbfs: -Infinity, peakDbfs: -Infinity, sampleCount: 0 };
  }

  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < length; i += 1) {
    const value = samples[i];
    sumSquares += value * value;
    const magnitude = value < 0 ? -value : value;
    if (magnitude > peak) peak = magnitude;
  }

  return {
    rmsDbfs: toDbfs(Math.sqrt(sumSquares / length)),
    peakDbfs: toDbfs(peak),
    sampleCount: length
  };
}

function formatDbfs(value) {
  if (!Number.isFinite(value)) return '-inf dBFS';
  return `${value.toFixed(1)} dBFS`;
}

// How a live level becomes a meter.
//
// Both meters in the app answer to these numbers: the one in set-up, and the
// one in the recording bar. They have to, because the same "loud enough" band
// is marked on both — and the bar used to draw the raw level, so ordinary
// speech (RMS around 0.05) filled 5% of it and looked like silence, while the
// identical voice filled 30% of the set-up meter and sat inside the band.
//
// The gain puts ordinary speech in the middle of the marked band, which
// .meter-target draws from 22% to 67%.
const METER_GAIN = 6;
const METER_SILENT = 0.005;
const METER_LOW = 0.02;

function meterWidth(level) {
  const value = Number(level) || 0;
  if (value <= 0) return 0;
  return Math.min(1, value * METER_GAIN);
}

// 'none' means nothing is arriving, 'low' means something is but not enough,
// 'ok' means it is in or above the band the hint tells people to reach.
function meterTone(level) {
  const value = Number(level) || 0;
  if (value <= METER_SILENT) return 'none';
  if (value < METER_LOW) return 'low';
  return 'ok';
}

function classifyNarration(levels) {
  const rms = levels ? levels.rmsDbfs : -Infinity;
  const peak = levels ? levels.peakDbfs : -Infinity;

  if (!levels || !levels.sampleCount) {
    return {
      level: 'none',
      rmsDbfs: rms,
      peakDbfs: peak,
      summary: 'No audio was captured at all.',
      advice: 'The recording has no audio track. Check that a microphone was selected before recording.'
    };
  }

  if (!Number.isFinite(peak) || Math.pow(10, peak / 20) < SILENCE_PEAK) {
    return {
      level: 'silent',
      rmsDbfs: rms,
      peakDbfs: peak,
      summary: 'The audio track is digital silence.',
      advice: 'The microphone was muted or disabled at the operating system level. Nothing spoken during this recording was captured.'
    };
  }

  if (rms <= TOO_QUIET_DBFS) {
    return {
      level: 'quiet',
      rmsDbfs: rms,
      peakDbfs: peak,
      summary: `Narration averaged ${formatDbfs(rms)}, which is too quiet to transcribe reliably.`,
      advice: `Speech normally measures around -27 dBFS. Below about ${TOO_QUIET_DBFS} dBFS transcription returns nothing, so an empty transcript here is expected rather than a failure of the transcriber.`
    };
  }

  return {
    level: 'ok',
    rmsDbfs: rms,
    peakDbfs: peak,
    summary: `Narration averaged ${formatDbfs(rms)}.`,
    advice: ''
  };
}

module.exports = {
  TOO_QUIET_DBFS,
  SILENCE_PEAK,
  METER_GAIN,
  METER_SILENT,
  METER_LOW,
  toDbfs,
  measureLevels,
  meterWidth,
  meterTone,
  classifyNarration,
  formatDbfs
};
