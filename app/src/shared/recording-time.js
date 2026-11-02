'use strict';

function validatePauses(pauses) {
  if (!Array.isArray(pauses)) throw new Error('Recording pauses must be a list.');
  let end = 0;
  for (const pause of pauses) {
    if (!pause || !Number.isFinite(pause.start) || pause.start < end ||
        (pause.end !== null && (!Number.isFinite(pause.end) || pause.end < pause.start))) {
      throw new Error('Recording pauses must be ordered, non-overlapping time intervals.');
    }
    end = pause.end === null ? Infinity : pause.end;
  }
}

function recordingElapsed(time, pauses) {
  let elapsed = time;
  for (const pause of pauses) {
    if (time < pause.start) break;
    elapsed -= Math.min(time, pause.end ?? time) - pause.start;
  }
  return Math.max(0, elapsed);
}

// Native input timestamps include the interruption; MediaRecorder does not.
function recordingTime(time, pauses) {
  if (pauses.some((pause) => time >= pause.start && (pause.end === null || time < pause.end))) {
    return null;
  }
  return recordingElapsed(time, pauses);
}

module.exports = { validatePauses, recordingElapsed, recordingTime };
