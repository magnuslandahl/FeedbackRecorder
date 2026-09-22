'use strict';

// What happened on the keyboard and the mouse while the screen was recorded,
// turned into something an agent can read.
//
// The video shows the pointer but not what it did: a click, a double-click and a
// right-click are all a stationary cursor. A menu opens and nothing says whether
// it was clicked or opened with a shortcut. This fills that in.
//
// ---------------------------------------------------------------- On keystrokes
//
// Recording every key a person presses while their screen is captured would put
// whatever they typed — a password into a login box, a key into a terminal, a
// message to somebody else — into a file meant to be handed to an agent and
// attached to a bug report. This project is not willing to write that file.
//
// So keys are kept by *category*, which is what the brief actually needs:
//
//   Shortcuts            kept in full. "Cmd+S" is the interesting part of a
//                        walkthrough and carries nothing private.
//   Navigation and edit  kept by name: Enter, Tab, Escape, the arrows,
//                        Backspace. They say how somebody moved, not what
//                        they wrote.
//   Ordinary typing      counted, never recorded. A run of characters becomes
//                        "typed 11 characters", which tells the agent a field
//                        was filled in without saying what went into it.
//
// The distinction is made here, in one place, and nothing upstream of it ever
// holds a character. The helper that reads the keyboard already applies it
// before writing a line, so even the file on disk has no text in it.

// Enough of the macOS virtual key codes to name what a walkthrough uses. Codes
// are a hardware layout, not characters: 0 is where "a" sits on a US keyboard
// and somewhere else on others, which is another reason not to pretend this
// reconstructs typed text.
const NAMED_KEYS = {
  36: 'Enter',
  48: 'Tab',
  51: 'Backspace',
  53: 'Escape',
  76: 'Enter',
  114: 'Help',
  115: 'Home',
  116: 'PageUp',
  117: 'Delete',
  119: 'End',
  121: 'PageDown',
  123: 'Left',
  124: 'Right',
  125: 'Down',
  126: 'Up',
  122: 'F1',
  120: 'F2',
  99: 'F3',
  118: 'F4',
  96: 'F5',
  97: 'F6',
  98: 'F7',
  100: 'F8',
  101: 'F9',
  109: 'F10',
  103: 'F11',
  111: 'F12'
};

// The letter and digit keys, for naming a shortcut. Only ever consulted when a
// command, control or option key is held — see classifyKey.
const SHORTCUT_KEYS = {
  0: 'A', 11: 'B', 8: 'C', 2: 'D', 14: 'E', 3: 'F', 5: 'G', 4: 'H', 34: 'I',
  38: 'J', 40: 'K', 37: 'L', 46: 'M', 45: 'N', 31: 'O', 35: 'P', 12: 'Q',
  15: 'R', 1: 'S', 17: 'T', 32: 'U', 9: 'V', 13: 'W', 7: 'X', 16: 'Y', 6: 'Z',
  29: '0', 18: '1', 19: '2', 20: '3', 21: '4', 23: '5', 22: '6', 26: '7',
  28: '8', 25: '9',
  49: 'Space', 27: '-', 24: '=', 33: '[', 30: ']', 42: '\\', 41: ';', 39: "'",
  43: ',', 47: '.', 44: '/', 50: '`'
};

// Held keys that turn a keypress into a command rather than a character. Shift
// is deliberately not one of them: shift alone is how capitals are typed, and
// treating it as a shortcut would leak them one at a time.
const COMMAND_MODIFIERS = ['cmd', 'ctrl'];

const MOUSE_BUTTONS = ['left', 'right', 'middle'];

function orderModifiers(modifiers) {
  const wanted = ['ctrl', 'alt', 'shift', 'cmd'];
  const held = new Set(modifiers || []);
  return wanted.filter((name) => held.has(name));
}

// Which of the three a key press is, and what may be written down about it.
function classifyKey(event) {
  const modifiers = orderModifiers(event.modifiers);
  const named = NAMED_KEYS[event.code];
  // Option+letter is ordinary typing on macOS (often an accented character),
  // while Option+Arrow is navigation. Shift has the same shape for capitals vs
  // Shift+Tab. A modifier is safe to keep when the key itself is already named.
  const commanded =
    modifiers.some((name) => COMMAND_MODIFIERS.includes(name)) ||
    (Boolean(named) && modifiers.length > 0);

  if (commanded) {
    const key = named || SHORTCUT_KEYS[event.code] || `key${event.code}`;
    const label = modifiers
      .map((name) => ({ ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', cmd: 'Cmd' }[name]))
      .concat(key)
      .join('+');
    return { kind: 'shortcut', label };
  }

  if (named) return { kind: 'key', label: named };

  // Everything else is somebody typing. It is counted and thrown away.
  return { kind: 'typing', label: '' };
}

function describeClick(event) {
  const button = MOUSE_BUTTONS.includes(event.button) ? event.button : 'left';
  const clicks = Number(event.clicks) || 1;
  if (button === 'left' && clicks === 2) return 'double-click';
  if (button === 'left' && clicks >= 3) return `${clicks}-click`;
  if (button === 'left') return 'click';
  return `${button}-click`;
}

// Runs of ordinary typing are collapsed into one entry. Fifty separate "a key
// was pressed" lines say less than "typed 50 characters" and are harder to read.
//
// A run ends when something else happens, or when the gap between two presses is
// long enough that they are not the same act of typing.
const TYPING_GAP_SECONDS = 2;
const SCROLL_GAP_SECONDS = 0.5;

function summarize(events, options) {
  const settings = options || {};
  const gap = typeof settings.typingGapSeconds === 'number'
    ? settings.typingGapSeconds
    : TYPING_GAP_SECONDS;

  const out = [];
  let run = null;

  const flush = () => {
    if (!run) return;
    out.push({
      time: round(run.start),
      kind: 'typing',
      detail: `typed ${run.count} character${run.count === 1 ? '' : 's'}`,
      count: run.count,
      endTime: round(run.end)
    });
    run = null;
  };

  (events || []).forEach((event) => {
    if (!event || typeof event.time !== 'number' || event.time < 0) return;

    if (event.type === 'key') {
      const decided = classifyKey(event);
      if (decided.kind === 'typing') {
        if (run && event.time - run.end <= gap) {
          run.count += 1;
          run.end = event.time;
        } else {
          flush();
          run = { start: event.time, end: event.time, count: 1 };
        }
        return;
      }
      flush();
      out.push({ time: round(event.time), kind: decided.kind, detail: decided.label });
      return;
    }

    if (event.type === 'click') {
      flush();
      const entry = {
        time: round(event.time),
        kind: 'click',
        detail: describeClick(event)
      };
      // Where it happened, when that is known. Points on the recorded screen are
      // worth having; a click on another monitor is still worth counting.
      if (typeof event.x === 'number' && typeof event.y === 'number') {
        entry.x = Math.round(event.x);
        entry.y = Math.round(event.y);
      }
      if (event.screen === 'recorded' || event.screen === 'other') entry.screen = event.screen;
      if (typeof event.displayId === 'string' && event.displayId) entry.displayId = event.displayId;
      out.push(entry);
      return;
    }

    if (event.type === 'scroll') {
      flush();
      const previous = out[out.length - 1];
      if (
        previous &&
        previous.kind === 'scroll' &&
        event.time - previous.endTime <= SCROLL_GAP_SECONDS
      ) {
        previous.count += 1;
        previous.endTime = round(event.time);
      } else {
        out.push({
          time: round(event.time),
          kind: 'scroll',
          detail: 'scrolled',
          count: 1,
          endTime: round(event.time)
        });
      }
    }
  });

  flush();
  return out.sort((a, b) => a.time - b.time);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

// Input can happen several times inside one video second. Two decimal places
// match the precision kept in JSONL and distinguish a click from the shortcut
// that followed it without pretending the event tap is a laboratory clock.
function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  let whole = Math.floor(value);
  let hundredths = Math.round((value - whole) * 100);
  if (hundredths === 100) {
    whole += 1;
    hundredths = 0;
  }
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = (number, width) => String(number).padStart(width, '0');
  const clock =
    hours > 0
      ? `${hours}:${pad(minutes, 2)}:${pad(secs, 2)}`
      : `${pad(minutes, 2)}:${pad(secs, 2)}`;
  return `${clock}.${pad(hundredths, 2)}`;
}

// Turns coordinates from the global desktop (logical points) into the pixel
// coordinates used by the recording. Retina displays make those two different:
// a 2560-point screen may be captured as 5120 pixels.
function normalizeRaw(event, display, offsetSeconds) {
  if (!event || typeof event.time !== 'number') return null;
  if (event.type === 'status' || event.type === 'interrupted') return null;

  const normalized = Object.assign({}, event, {
    time: round(event.time + (Number(offsetSeconds) || 0))
  });

  if (event.type !== 'click') return normalized;

  const bounds = display && display.bounds;
  const width = Number(display && display.captureWidth);
  const height = Number(display && display.captureHeight);
  const inside =
    bounds &&
    typeof event.x === 'number' &&
    typeof event.y === 'number' &&
    event.x >= bounds.x &&
    event.y >= bounds.y &&
    event.x < bounds.x + bounds.width &&
    event.y < bounds.y + bounds.height;

  normalized.screen = inside ? 'recorded' : 'other';
  delete normalized.x;
  delete normalized.y;

  if (inside && width > 0 && height > 0 && bounds.width > 0 && bounds.height > 0) {
    normalized.x = Math.round(((event.x - bounds.x) / bounds.width) * width);
    normalized.y = Math.round(((event.y - bounds.y) / bounds.height) * height);
  }

  return normalized;
}

// A click is only worth placing on a picture if it landed inside the part of the
// screen that was kept. Coordinates are the whole screen's; the region is the
// rectangle the user framed afterwards.
function withinRegion(entry, region) {
  if (!region) return true;
  if (typeof entry.x !== 'number' || typeof entry.y !== 'number') return false;
  return (
    entry.x >= region.x &&
    entry.y >= region.y &&
    entry.x < region.x + region.width &&
    entry.y < region.y + region.height
  );
}

// Which keyframe was on screen when something happened, so the brief can say
// "on frames/frame-03.png, double-click" rather than only "at 00:12".
function frameAt(time, keyframes, revisits) {
  const frames = keyframes || [];
  if (!frames.length) return null;

  let best = null;
  frames.forEach((frame) => {
    if (frame.time <= time + 0.001 && (!best || frame.time >= best.time)) best = frame;
  });

  // A screen that came back is not saved twice, so a later time can belong to an
  // earlier file.
  (revisits || []).forEach((revisit) => {
    if (revisit.time <= time + 0.001 && (!best || revisit.time >= best.time)) {
      best = { file: revisit.file, time: revisit.time };
    }
  });

  return best ? best.file : frames[0].file;
}

// What the brief prints. Counts first, because "31 clicks and 4 shortcuts" is
// the shape of a walkthrough; the list is the detail under it.
function describe(entries) {
  const list = entries || [];
  const counts = { click: 0, shortcut: 0, key: 0, typing: 0, scroll: 0, characters: 0 };

  list.forEach((entry) => {
    if (counts[entry.kind] === undefined) return;
    counts[entry.kind] += 1;
    if (entry.kind === 'typing') counts.characters += entry.count || 0;
  });

  const parts = [];
  if (counts.click) parts.push(`${counts.click} click${counts.click === 1 ? '' : 's'}`);
  if (counts.shortcut) parts.push(`${counts.shortcut} shortcut${counts.shortcut === 1 ? '' : 's'}`);
  if (counts.key) parts.push(`${counts.key} key${counts.key === 1 ? '' : 's'}`);
  if (counts.characters) parts.push(`${counts.characters} typed character${counts.characters === 1 ? '' : 's'}`);
  if (counts.scroll) parts.push(`${counts.scroll} scroll${counts.scroll === 1 ? '' : 's'}`);

  return { counts, summary: parts.length ? parts.join(', ') : 'nothing recorded' };
}

// One line per event, as JSON, so the file can be read a line at a time by
// anything — including an agent that only wants the first fifty.
function toJsonl(entries) {
  return (entries || []).map((entry) => JSON.stringify(entry)).join('\n') + '\n';
}

function parseJsonl(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = {
  classifyKey,
  describeClick,
  summarize,
  describe,
  normalizeRaw,
  formatTime,
  frameAt,
  withinRegion,
  toJsonl,
  parseJsonl,
  NAMED_KEYS,
  SHORTCUT_KEYS,
  TYPING_GAP_SECONDS,
  SCROLL_GAP_SECONDS,
  FILE_NAME: 'input-events.jsonl'
};
