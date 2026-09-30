'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { execFileSync, spawn } = require('node:child_process');

const inputEvents = require('../shared/input-events');

const RAW_FILE = '.input-events.raw.jsonl';

function locate(appRoot, resourcesPath, platform) {
  const on = platform || process.platform;
  if (on !== 'darwin' && on !== 'win32') return null;
  const name = on === 'win32' ? 'input-tap.exe' : 'input-tap';
  const candidates = [
    resourcesPath && path.join(resourcesPath, 'vendor', 'input', name),
    appRoot && path.join(appRoot, 'vendor', 'input', name)
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function reasonFor(state, platform = 'darwin') {
  if (!state.supported) return state.reason || 'Input activity capture is not available on this platform.';
  if (!state.helper) return state.reason || 'The input activity helper is missing from this build.';
  if (state.pointer && state.keyboard) return '';
  if (platform === 'win32') {
    if (state.pointer) return 'Windows could not install the keyboard input hook in this desktop session.';
    if (state.keyboard) return 'Windows could not install the mouse input hook in this desktop session.';
    return 'Windows could not install the mouse and keyboard input hooks in this desktop session.';
  }
  if (!state.pointer && !state.keyboard) {
    return 'Allow FeedbackRecorder under Accessibility and Input Monitoring in System Settings.';
  }
  if (!state.pointer) {
    return 'Allow FeedbackRecorder under Accessibility in System Settings to record mouse clicks.';
  }
  return 'Allow FeedbackRecorder under Input Monitoring in System Settings to record keyboard activity.';
}

function status(appRoot, resourcesPath, platform) {
  const on = platform || process.platform;
  if (on !== 'darwin' && on !== 'win32') {
    return {
      supported: false,
      helper: false,
      pointer: false,
      keyboard: false,
      reason: 'Input activity capture is available on macOS and Windows.'
    };
  }

  const binary = locate(appRoot, resourcesPath, on);
  if (!binary) {
    return {
      supported: true,
      helper: false,
      pointer: false,
      keyboard: false,
      reason: 'The input activity helper is missing from this build.'
    };
  }
  try {
    // --check installs and immediately removes both hooks, with no event loop
    // and no input log. Windows settings can therefore show actual availability
    // without leaving a listener running while the app is idle.
    const text = execFileSync(binary, ['--check'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const line = text
      .split('\n')
      .map((item) => item.trim())
      .find(Boolean);
    const answer = JSON.parse(line || '{}');
    if (on === 'win32' &&
        (answer.type !== 'status' ||
         typeof answer.pointer !== 'boolean' ||
         typeof answer.keyboard !== 'boolean')) {
      throw new Error('the helper returned an invalid status');
    }
    const result = {
      supported: true,
      helper: true,
      pointer: Boolean(answer.pointer),
      keyboard: Boolean(answer.keyboard)
    };
    result.reason = reasonFor(result, on);
    return result;
  } catch (error) {
    return {
      supported: true,
      helper: true,
      pointer: false,
      keyboard: false,
      reason: on === 'win32'
        ? `Windows input hooks could not be checked: ${error.message}`
        : `Input activity permissions could not be checked: ${error.message}`
    };
  }
}

// Touches both TCC services so FeedbackRecorder appears in their lists. The
// booleans printed by this invocation describe what was true before the request;
// callers re-check when the window regains focus.
function requestPermissions(appRoot, resourcesPath, platform) {
  const on = platform || process.platform;
  if (on !== 'darwin') return status(appRoot, resourcesPath, on);
  const binary = locate(appRoot, resourcesPath, on);
  if (!binary) return status(appRoot, resourcesPath, on);
  try {
    execFileSync(binary, ['--ask', '--check'], {
      timeout: 10000,
      stdio: 'ignore'
    });
  } catch (error) {
    // Refusal is the state being asked about, not a fatal error.
  }
  return status(appRoot, resourcesPath, on);
}

function partialReason(state, platform = 'darwin') {
  if (state.pointer && state.keyboard) return '';
  if (platform === 'win32') {
    if (state.pointer) return 'Mouse clicks were recorded, but the Windows keyboard hook was unavailable.';
    if (state.keyboard) return 'Keyboard activity was recorded, but the Windows mouse hook was unavailable.';
    return 'Windows input hooks could not be installed.';
  }
  if (state.pointer) return 'Mouse clicks were recorded, but keyboard activity was not permitted.';
  if (state.keyboard) return 'Keyboard activity was recorded, but mouse clicks were not permitted.';
  return 'Clicks and keyboard activity were not recorded because macOS permission was not granted.';
}

function create(options) {
  const appRoot = options.appRoot;
  const resourcesPath = options.resourcesPath;
  const platform = options.platform || process.platform;
  const spawnProcess = options.spawn || spawn;
  const toDipPoint = options.toDipPoint || (platform === 'win32'
    ? (point) => require('electron').screen.screenToDipPoint(point)
    : null);
  const captures = new Map();

  async function start(run, request) {
    const wanted = !request || request.enabled !== false;
    if (!wanted) {
      return {
        supported: platform === 'darwin' || platform === 'win32',
        ...(platform === 'win32' ? { helper: Boolean(locate(appRoot, resourcesPath, platform)) } : {}),
        enabled: false, pointer: false, keyboard: false
      };
    }
    if (platform !== 'darwin' && platform !== 'win32') {
      return {
        supported: false,
        enabled: true,
        pointer: false,
        keyboard: false,
        reason: 'Input activity capture is available on macOS and Windows.'
      };
    }
    if (captures.has(run.id)) return captures.get(run.id).state;

    const binary = locate(appRoot, resourcesPath, platform);
    if (!binary) {
      return {
        supported: true,
        ...(platform === 'win32' ? { helper: false } : {}),
        enabled: true,
        pointer: false,
        keyboard: false,
        reason: 'The input activity helper is missing from this build.'
      };
    }

    const rawPath = path.join(run.dir, RAW_FILE);
    const stream = fs.createWriteStream(rawPath, { flags: 'w', encoding: 'utf8' });
    const child = spawnProcess(binary, [], {
      env: Object.assign({}, process.env, { FR_PARENT_PID: String(process.pid) }),
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const capture = {
      child,
      stream,
      rawPath,
      offsetSeconds: Number(request && request.offsetSeconds) || 0,
      display: run.display,
      state: {
        supported: true,
        ...(platform === 'win32' ? { helper: true } : {}),
        enabled: true,
        pointer: false,
        keyboard: false,
        reason: ''
      },
      interrupted: false,
      malformed: 0,
      closed: false,
      stopping: false
    };
    captures.set(run.id, capture);
    // A helper that exits while Stop is being pressed can close stdin first;
    // EPIPE is then merely the helper already being gone, not an app-level
    // error. stderr is not part of the protocol, but must be drained so a noisy
    // helper can never block on a full pipe.
    child.stdin.on('error', () => {});
    child.stderr.resume();
    stream.on('error', (error) => {
      capture.state.reason = `Input activity could not be written: ${error.message}`;
    });

    let settleStatus;
    let receivedStatus = false;
    const firstStatus = new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (platform === 'win32' && !receivedStatus && !capture.state.reason) {
          capture.state.reason = 'The Windows input helper did not report hook availability.';
        }
        resolve(capture.state);
      }, 1500);
      settleStatus = (answer) => {
        clearTimeout(timer);
        resolve(answer);
      };
    });

    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch (error) {
        capture.malformed += 1;
        return;
      }

      if (event.type === 'status') {
        if (platform === 'win32' &&
            (typeof event.pointer !== 'boolean' || typeof event.keyboard !== 'boolean')) {
          capture.state.reason = 'The Windows input helper returned an invalid status.';
          settleStatus(capture.state);
          return;
        }
        receivedStatus = true;
        capture.state.pointer = Boolean(event.pointer);
        capture.state.keyboard = Boolean(event.keyboard);
        capture.state.reason = event.error || partialReason(capture.state, platform);
        settleStatus(capture.state);
        return;
      }
      if (event.type === 'interrupted') {
        capture.interrupted = true;
        return;
      }

      // WH_MOUSE_LL supplies physical virtual-desktop pixels; Electron display
      // bounds are DIP. screenToDipPoint handles mixed-DPI and negative origins.
      if (platform === 'win32' && event.type === 'click' &&
          typeof event.x === 'number' && typeof event.y === 'number') {
        try {
          event = Object.assign({}, event, toDipPoint({ x: event.x, y: event.y }));
        } catch (error) {
          // A topology change must not attach a plausible but false location.
          event = Object.assign({}, event);
          delete event.x;
          delete event.y;
        }
      }
      const normalized = inputEvents.normalizeRaw(
        event,
        capture.display,
        capture.offsetSeconds
      );
      if (normalized) capture.stream.write(`${JSON.stringify(normalized)}\n`);
    });

    child.once('error', (error) => {
      capture.state.reason = `Input activity capture could not start: ${error.message}`;
      settleStatus(capture.state);
    });
    child.once('close', () => {
      capture.closed = true;
      if (platform === 'win32' && !capture.stopping) {
        if (receivedStatus && (capture.state.pointer || capture.state.keyboard)) {
          capture.interrupted = true;
          capture.state.reason = 'The Windows input helper stopped before the recording ended.';
        } else if (!receivedStatus && !capture.state.reason) {
          capture.state.reason = 'The Windows input helper exited without reporting hook availability.';
        }
      }
      settleStatus(capture.state);
    });

    return firstStatus;
  }

  async function stop(runId) {
    const capture = captures.get(runId);
    if (!capture) {
      return {
        status: {
          supported: platform === 'darwin' || platform === 'win32',
          ...(platform === 'win32' ? { helper: Boolean(locate(appRoot, resourcesPath, platform)) } : {}),
          enabled: false,
          pointer: false,
          keyboard: false
        },
        entries: []
      };
    }
    captures.delete(runId);
    capture.stopping = true;

    if (!capture.closed) {
      const closed = new Promise((resolve) => {
        const timer = setTimeout(resolve, 1500);
        capture.child.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      capture.child.stdin.end();
      await closed;
      if (!capture.closed) capture.child.kill('SIGTERM');
    }

    await new Promise((resolve) => {
      capture.stream.once('finish', resolve);
      capture.stream.once('close', resolve);
      capture.stream.once('error', resolve);
      capture.stream.end();
    });

    let raw = '';
    try {
      raw = fs.readFileSync(capture.rawPath, 'utf8');
    } catch (error) {
      // No events is a valid result.
    }
    fs.rmSync(capture.rawPath, { force: true });

    const entries = inputEvents.summarize(inputEvents.parseJsonl(raw));
    const result = {
      status: Object.assign({}, capture.state, {
        interrupted: capture.interrupted,
        malformed: capture.malformed
      }),
      entries
    };
    result.status.reason =
      result.status.reason ||
      partialReason(result.status, platform) ||
      (capture.interrupted ? 'Input activity capture was interrupted and restarted.' : '');
    return result;
  }

  async function discard(runId) {
    await stop(runId);
  }

  return { start, stop, discard, active: (runId) => captures.has(runId) };
}

module.exports = {
  create,
  locate,
  status,
  requestPermissions,
  reasonFor,
  partialReason,
  RAW_FILE
};
