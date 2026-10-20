'use strict';

function screenTimeline(run) {
  const keyframes = Array.isArray(run.keyframes) ? run.keyframes : [];
  const files = new Set(keyframes.filter(Boolean).map((frame) => frame.file));
  const revisits = Array.isArray(run.revisits) ? run.revisits : [];
  return keyframes
    .concat(revisits)
    .filter((frame) => frame && files.has(frame.file) && frame.file &&
      Number.isFinite(frame.time) && frame.time >= 0)
    .sort((a, b) => a.time - b.time);
}

function occurrenceKey(frame) {
  return JSON.stringify([frame.file, frame.time]);
}

// Segment timestamps locate speech, not individual words. Keep every screen
// overlapped by a segment rather than pretending its words can be split.
function correlateSegment(segment, frames) {
  let index = -1;
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i].time <= segment.start + 0.001) index = i;
    else break;
  }
  if (index < 0 && frames.length) index = 0;
  const match = frames[index];
  const occurrences = [];
  if (match) {
    for (let i = index; i < frames.length; i += 1) {
      if (i > index && frames[i].time >= segment.end - 0.001) break;
      occurrences.push({ file: frames[i].file, time: frames[i].time, occurrence: i + 1 });
      if (!Number.isFinite(segment.end)) break;
    }
  }
  return {
    ...segment,
    frame: match ? match.file : null,
    frameTime: match ? match.time : null,
    frameOccurrence: match ? index + 1 : null,
    frameOccurrences: occurrences
  };
}

function correlateSegments(segments, keyframes, revisits) {
  const frames = screenTimeline({ keyframes, revisits });
  return (Array.isArray(segments) ? segments : [])
    .filter((segment) => segment.text.trim())
    .map((segment) => correlateSegment(segment, frames));
}

module.exports = { screenTimeline, occurrenceKey, correlateSegment, correlateSegments };
