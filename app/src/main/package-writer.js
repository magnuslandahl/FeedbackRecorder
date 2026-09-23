'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { runFolderName, frameFileName, formatTimecode } = require('../shared/naming');
const { buildBrief, buildPrompt } = require('../shared/brief');
const inputEvents = require('../shared/input-events');

// The package has the same shape the PowerShell tool produces, so briefs stay
// comparable while both tools exist.

function createPackage(rootDir, date) {
  const base = runFolderName(date || new Date());

  // The name is only precise to the second, and mkdir with recursive:true hands
  // back a directory that already exists rather than refusing. Two runs started
  // inside the same second would then share one package, mixing their frames
  // and overwriting each other's run.json — silently, because nothing here
  // would have failed.
  let id = base;
  let suffix = 2;
  while (fs.existsSync(path.join(rootDir, id))) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }

  const dir = path.join(rootDir, id);
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
  return { id, dir };
}

function writeBinary(filePath, data) {
  fs.writeFileSync(filePath, Buffer.from(data));
  return filePath;
}

function writeRecording(dir, data, fileName) {
  return writeBinary(path.join(dir, fileName || 'recording.webm'), data);
}

// An imported file is copied rather than read into memory and handed back: a
// screen recording can be gigabytes, and the renderer already holds one copy to
// decode its audio.
function copyRecording(dir, sourcePath, fileName) {
  const target = path.join(dir, fileName || 'recording.webm');
  fs.copyFileSync(sourcePath, target);
  return target;
}

function writeAudio(dir, data) {
  return writeBinary(path.join(dir, 'narration.wav'), data);
}

// frames: [{ time, score, data }] where data is PNG bytes, already cropped.
function writeFrames(dir, frames) {
  const frameDir = path.join(dir, 'frames');
  const stagedDir = fs.mkdtempSync(path.join(dir, '.frames-next-'));
  const previousDir = `${stagedDir}-previous`;

  try {
    const written = frames.map((frame, index) => {
      const file = frameFileName(index);
      writeBinary(path.join(stagedDir, file), frame.data);
      return { file: `frames/${file}`, time: frame.time, score: frame.score };
    });

    let movedPrevious = false;
    try {
      if (fs.existsSync(frameDir)) {
        fs.renameSync(frameDir, previousDir);
        movedPrevious = true;
      }
      fs.renameSync(stagedDir, frameDir);
    } catch (error) {
      if (movedPrevious && !fs.existsSync(frameDir)) {
        try {
          fs.renameSync(previousDir, frameDir);
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            'Could not install the new keyframes or restore the previous ones.'
          );
        }
      }
      throw error;
    }

    if (movedPrevious) {
      fs.rmSync(previousDir, { recursive: true, force: true });
    }
    return written;
  } catch (error) {
    fs.rmSync(stagedDir, { recursive: true, force: true });
    throw error;
  }
}

function inputEventsText(entries) {
  if (!entries || !entries.length) return 'No input activity was recorded.\n';
  return (
    entries
      .map((entry) => {
        let detail = entry.detail;
        if (entry.kind === 'click') {
          detail += entry.screen === 'other' ? ' on another screen' : '';
          if (typeof entry.x === 'number' && typeof entry.y === 'number') {
            detail += ` at ${entry.x},${entry.y}`;
          }
        }
        return `[${inputEvents.formatTime(entry.time)}] ${detail}`;
      })
      .join('\n') + '\n'
  );
}

// Both a machine-readable chronology and the version a person can skim. The
// JSONL is one object per line so an agent can stream a long recording rather
// than loading one giant array.
function writeInputEvents(dir, entries, status) {
  const list = entries || [];
  fs.writeFileSync(
    path.join(dir, inputEvents.FILE_NAME),
    inputEvents.toJsonl(list),
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'input-events.txt'),
    inputEventsText(list),
    'utf8'
  );

  const described = inputEvents.describe(list);
  return {
    available: Boolean(status && (status.pointer || status.keyboard)),
    pointer: Boolean(status && status.pointer),
    keyboard: Boolean(status && status.keyboard),
    interrupted: Boolean(status && status.interrupted),
    summary: described.summary,
    counts: described.counts,
    files: {
      jsonl: inputEvents.FILE_NAME,
      text: 'input-events.txt'
    },
    privacy:
      'Shortcuts and navigation keys are named. Ordinary typing is counted, never stored.',
    reason: (status && status.reason) || ''
  };
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

  // A revisit is a pointer, and a pointer to a file that is not in the package
  // is worse than no pointer: the brief would name a screenshot nobody can open.
  const files = new Set((run.keyframes || []).map((frame) => frame.file));
  const dangling = (run.revisits || []).filter((entry) => !files.has(entry.file));
  if (dangling.length) {
    problems.push('The brief refers back to a keyframe that is not in the package, so some narration points at a missing picture.');
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
    degraded: Array.from(new Set((run.degraded || []).concat(verifyPackage(run))))
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
  // The chronology has its own streaming file. Keeping it out of run.json
  // avoids duplicating a potentially long list while preserving the summary
  // and the paths under `input`.
  const serialized = Object.assign({}, complete);
  delete serialized.inputEvents;
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(serialized, null, 2), 'utf8');

  return { run: serialized, brief, prompt };
}

module.exports = {
  createPackage,
  writeRecording,
  copyRecording,
  writeAudio,
  writeFrames,
  inputEventsText,
  writeInputEvents,
  transcriptText,
  verifyPackage,
  finalize
};
