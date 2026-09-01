'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { runFolderName, frameFileName, formatTimecode } = require('../shared/naming');
const { buildBrief, buildPrompt } = require('../shared/brief');

// The package has the same shape the PowerShell tool produces, so briefs stay
// comparable while both tools exist.

function createPackage(rootDir, date) {
  const id = runFolderName(date || new Date());
  const dir = path.join(rootDir, id);
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
  return { id, dir };
}

function writeBinary(filePath, data) {
  fs.writeFileSync(filePath, Buffer.from(data));
  return filePath;
}

function writeRecording(dir, data) {
  return writeBinary(path.join(dir, 'recording.webm'), data);
}

function writeAudio(dir, data) {
  return writeBinary(path.join(dir, 'narration.wav'), data);
}

// frames: [{ time, score, data }] where data is PNG bytes, already cropped.
function writeFrames(dir, frames) {
  return frames.map((frame, index) => {
    const file = frameFileName(index);
    writeBinary(path.join(dir, 'frames', file), frame.data);
    return { file: `frames/${file}`, time: frame.time, score: frame.score };
  });
}

function transcriptText(segments) {
  if (!segments || !segments.length) return '';
  return segments.map((s) => `[${formatTimecode(s.start)}] ${s.text.trim()}`).join('\n') + '\n';
}

// Both failure modes in this pipeline produce plausible output with a zero exit
// code, so the package states what it actually contains rather than assuming the
// steps that ran produced anything.
function verifyPackage(run) {
  const problems = [];
  const duration = Number(run.durationSeconds) || 0;

  if (duration <= 0) {
    problems.push('The recording has no measurable duration, so it may be unplayable.');
  }
  if (!run.keyframes || run.keyframes.length === 0) {
    problems.push('No keyframes were extracted, so the package has no pictures in it.');
  } else {
    const last = run.keyframes[run.keyframes.length - 1];
    if (duration > 0 && last.time > duration + 1) {
      problems.push('A keyframe is timed past the end of the recording, so frame times are unreliable.');
    }
  }

  const segments = (run.transcript || {}).segments || [];
  const overrun = segments.find((s) => duration > 0 && s.start > duration + 1);
  if (overrun) {
    problems.push('A transcript segment starts after the recording ends, which means the transcript is not trustworthy.');
  }

  return problems;
}

function finalize(dir, run) {
  const segments = (run.transcript || {}).segments || [];
  const complete = Object.assign({}, run, {
    degraded: (run.degraded || []).concat(verifyPackage(run))
  });

  fs.writeFileSync(path.join(dir, 'transcript.txt'), transcriptText(segments), 'utf8');
  fs.writeFileSync(
    path.join(dir, 'transcript.json'),
    JSON.stringify({ language: (run.transcript || {}).language || null, segments }, null, 2),
    'utf8'
  );

  const brief = buildBrief(complete);
  fs.writeFileSync(path.join(dir, 'agent-brief.md'), brief, 'utf8');

  const prompt = buildPrompt(complete);
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(complete, null, 2), 'utf8');

  return { run: complete, brief, prompt };
}

module.exports = {
  createPackage,
  writeRecording,
  writeAudio,
  writeFrames,
  transcriptText,
  verifyPackage,
  finalize
};
