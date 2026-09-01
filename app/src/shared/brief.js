'use strict';

const { formatTimecode, formatDuration } = require('./naming');
const { describeRegion } = require('./region');

// "This button" is only resolvable if the reader can tell which frame was on
// screen while it was said. Every segment is tied to the last keyframe taken at
// or before it starts.
function correlateSegments(segments, keyframes) {
  const frames = Array.isArray(keyframes) ? keyframes.slice().sort((a, b) => a.time - b.time) : [];
  const list = Array.isArray(segments) ? segments : [];

  return list.map((segment) => {
    let match = null;
    for (const frame of frames) {
      if (frame.time <= segment.start + 0.001) match = frame;
      else break;
    }
    if (!match && frames.length) match = frames[0];
    return Object.assign({}, segment, {
      frame: match ? match.file : null,
      frameTime: match ? match.time : null
    });
  });
}

function transcriptLines(run) {
  const transcript = run.transcript || {};
  const segments = correlateSegments(transcript.segments, run.keyframes);
  if (!segments.length) return [];
  return segments.map((segment) => {
    const time = formatTimecode(segment.start);
    const frame = segment.frame ? ` _(${segment.frame})_` : '';
    return `- **${time}**${frame} ${segment.text.trim()}`;
  });
}

function describeDisplay(run) {
  const display = run.display || {};
  const parts = [];
  if (display.name) parts.push(display.name);
  if (display.actualWidth && display.actualHeight) {
    parts.push(`captured at ${display.actualWidth}x${display.actualHeight}`);
  }
  return parts.join(', ') || 'unknown display';
}

function narrationLines(run) {
  const narration = run.narration || {};
  const lines = [`- Narration level: ${narration.summary || 'not measured'}`];
  if (narration.advice) lines.push(`- ${narration.advice}`);
  return lines;
}

function transcriptStatusLine(run) {
  const transcript = run.transcript || {};
  const count = transcript.segments ? transcript.segments.length : 0;
  if (!transcript.available) {
    return `- Transcript: not produced${transcript.reason ? ` (${transcript.reason})` : ''}`;
  }
  if (count === 0) {
    return '- Transcript: produced, but it contains no speech segments';
  }
  return `- Transcript: ${count} segment${count === 1 ? '' : 's'}${transcript.language ? ` (${transcript.language})` : ''}`;
}

function buildBrief(run) {
  const keyframes = run.keyframes || [];
  const frame = run.frameSize || { width: 0, height: 0 };
  const lines = [];

  lines.push(`# Review brief — ${run.id}`);
  lines.push('');
  lines.push('Recorded with FeedbackRecorder: one screen, spoken narration, and the');
  lines.push('frames that changed while it was being recorded.');
  lines.push('');

  lines.push('## Recording');
  lines.push('');
  lines.push(`- Package: \`${run.packagePath}\``);
  if (run.startedAt) lines.push(`- Started: ${run.startedAt}`);
  lines.push(`- Duration: ${formatDuration(run.durationSeconds)}`);
  lines.push(`- Display: ${describeDisplay(run)}`);
  lines.push(`- Region: ${describeRegion(run.region, frame.width, frame.height)}`);
  lines.push(`- Keyframes: ${keyframes.length}`);
  lines.push(transcriptStatusLine(run));
  narrationLines(run).forEach((line) => lines.push(line));
  lines.push('');

  const degraded = run.degraded || [];
  if (degraded.length) {
    lines.push('## What is missing from this package');
    lines.push('');
    degraded.forEach((item) => lines.push(`- ${item}`));
    lines.push('');
  }

  lines.push('## Narration');
  lines.push('');
  const spoken = transcriptLines(run);
  if (spoken.length) {
    lines.push('Each line is the time it was said and the keyframe that was on screen');
    lines.push('at that moment.');
    lines.push('');
    spoken.forEach((line) => lines.push(line));
  } else {
    lines.push('No speech was transcribed. See the narration level above for why.');
  }
  lines.push('');

  lines.push('## Keyframes');
  lines.push('');
  if (keyframes.length) {
    keyframes.forEach((item) => {
      lines.push(`- \`${item.file}\` at ${formatTimecode(item.time)}`);
    });
  } else {
    lines.push('None were extracted.');
  }
  lines.push('');

  lines.push('## Coding-agent prompt');
  lines.push('');
  lines.push('```text');
  buildPrompt(run).split('\n').forEach((line) => lines.push(line));
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

// What lands on the clipboard. It carries the content rather than a pointer to
// it, so it also works in a chat window with no access to the filesystem. It
// says what it cannot carry instead of referring to images the reader may not be
// able to open.
function buildPrompt(run) {
  const keyframes = run.keyframes || [];
  const spoken = correlateSegments((run.transcript || {}).segments, keyframes);
  const lines = [];

  lines.push('I recorded a spoken walkthrough of my screen. Below is what I said and');
  lines.push('which frame was on screen while I said it. Turn it into concrete work.');
  lines.push('');
  lines.push(`Package: ${run.packagePath}`);
  lines.push(`Duration: ${formatDuration(run.durationSeconds)}, ${keyframes.length} keyframe(s) in the frames/ folder.`);
  lines.push('');

  if (spoken.length) {
    lines.push('Narration:');
    spoken.forEach((segment) => {
      const frame = segment.frame ? ` [${segment.frame}]` : '';
      lines.push(`  ${formatTimecode(segment.start)}${frame} ${segment.text.trim()}`);
    });
  } else {
    const narration = run.narration || {};
    lines.push('Narration: none was transcribed.');
    if (narration.summary) lines.push(`  ${narration.summary}`);
    if (narration.advice) lines.push(`  ${narration.advice}`);
  }
  lines.push('');

  const degraded = run.degraded || [];
  if (degraded.length) {
    lines.push('Known gaps in this package:');
    degraded.forEach((item) => lines.push(`  - ${item}`));
    lines.push('');
  }

  lines.push('The screenshots cannot travel in this message. If you can read files,');
  lines.push('open the frames listed above from the package path; if you cannot, work');
  lines.push('from the narration and say which parts you could not verify.');
  lines.push('');
  lines.push('Please: identify each issue or request I described, tie it to the code it');
  lines.push('affects, propose a fix for each, and ask about anything the narration');
  lines.push('leaves ambiguous rather than guessing.');

  return lines.join('\n');
}

module.exports = { correlateSegments, buildBrief, buildPrompt };
