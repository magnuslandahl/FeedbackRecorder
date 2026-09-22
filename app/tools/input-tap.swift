// A small helper that watches the keyboard and the mouse, and says what it saw.
//
// It exists because Electron cannot see input that goes to other applications,
// and a walkthrough is somebody using another application. The video shows the
// pointer but not what it did: a click, a double-click and a right-click all
// look like a stationary cursor.
//
// Built by `npm run vendor`, the same way whisper.cpp is, so the repository
// carries source rather than a binary nobody can read. It is deliberately
// separate from the app: a process that reads the keyboard should be small
// enough to check by eye, and it can be stopped without taking the app with it.
//
// ------------------------------------------------------------------- Keystrokes
//
// This never writes down what anybody typed. A tool that records the screen and
// the keyboard at the same time, into a file meant to be attached to a bug
// report, would collect passwords, tokens and private messages as a matter of
// course.
//
// So a key press leaves here as one of three things:
//
//   shortcut   Cmd+S, Ctrl+Shift+P — kept in full, and the useful part of a
//              walkthrough.
//   key        Enter, Tab, Escape, an arrow — named, because how somebody moved
//              is worth knowing and is not private.
//   typing     everything else, reported as the single flag "typing" with no key
//              code and no character. The app counts these; it never learns what
//              they were.
//
// The decision is made here, before a line is written, so the redaction cannot
// be undone downstream — there is nothing left to undo.
//
// Output is one JSON object per line on stdout, flushed as it happens.

import Cocoa
import IOKit.hid

// Keys that say how somebody moved rather than what they wrote. Kept by name
// even when no modifier is held.
let namedKeys: Set<Int64> = [
  36, 48, 51, 53, 76,               // return, tab, delete, escape, enter
  114, 115, 116, 117, 119, 121,     // help, home, page up, forward delete, end, page down
  123, 124, 125, 126,               // arrows
  122, 120, 99, 118, 96, 97, 98, 100, 101, 103, 111  // F1-F12
]

let start = Date()
let out = FileHandle.standardOutput

func jsonString(_ text: String) -> String {
  var escaped = ""
  for character in text.unicodeScalars {
    switch character {
    case "\"": escaped += "\\\""
    case "\\": escaped += "\\\\"
    case "\n": escaped += "\\n"
    case "\r": escaped += "\\r"
    case "\t": escaped += "\\t"
    default:
      if character.value < 0x20 {
        escaped += String(format: "\\u%04x", character.value)
      } else {
        escaped.unicodeScalars.append(character)
      }
    }
  }
  return "\"\(escaped)\""
}

// Written by hand rather than through JSONSerialization so the exact shape of a
// line is visible in this file, next to the rule about what may go in one.
func emit(_ pairs: [(String, String)]) {
  let seconds = String(format: "%.3f", Date().timeIntervalSince(start))
  var parts = ["\"time\":\(seconds)"]
  for (key, value) in pairs {
    parts.append("\(jsonString(key)):\(value)")
  }
  if let data = ("{" + parts.joined(separator: ",") + "}\n").data(using: .utf8) {
    out.write(data)
  }
}

func modifierList(_ flags: CGEventFlags) -> String {
  var names: [String] = []
  if flags.contains(.maskControl) { names.append("ctrl") }
  if flags.contains(.maskAlternate) { names.append("alt") }
  if flags.contains(.maskShift) { names.append("shift") }
  if flags.contains(.maskCommand) { names.append("cmd") }
  return "[" + names.map { jsonString($0) }.joined(separator: ",") + "]"
}

// Shift is not a command modifier: shift is how a capital is typed. Option is
// not one either: Option+letter is how many accented characters are typed on a
// Mac. Treating either as a shortcut would leak text one key position at a
// time. Their presence is kept only on already-safe named keys such as arrows.
func isCommanded(_ flags: CGEventFlags) -> Bool {
  return flags.contains(.maskControl)
    || flags.contains(.maskCommand)
}

func emitKey(_ code: Int64, _ flags: CGEventFlags) {
  if isCommanded(flags) {
    emit([
      ("type", jsonString("key")),
      ("code", "\(code)"),
      ("modifiers", modifierList(flags))
    ])
  } else if namedKeys.contains(code) {
    emit([
      ("type", jsonString("key")),
      ("code", "\(code)"),
      ("modifiers", modifierList(flags))
    ])
  } else {
    // Ordinary typing. No code, no character - only that it happened.
    emit([("type", jsonString("key")), ("typing", "true")])
  }
}

var eventTap: CFMachPort?

let callback: CGEventTapCallBack = { _, type, event, _ in
  switch type {
  case .leftMouseDown, .rightMouseDown, .otherMouseDown:
    let point = event.location
    let clicks = event.getIntegerValueField(.mouseEventClickState)
    let button = type == .leftMouseDown ? "left" : (type == .rightMouseDown ? "right" : "middle")
    emit([
      ("type", jsonString("click")),
      ("button", jsonString(button)),
      ("clicks", "\(clicks)"),
      ("x", "\(Int(point.x.rounded()))"),
      ("y", "\(Int(point.y.rounded()))")
    ])

  case .scrollWheel:
    emit([("type", jsonString("scroll"))])

  case .keyDown:
    let code = event.getIntegerValueField(.keyboardEventKeycode)
    emitKey(code, event.flags)

  case .tapDisabledByTimeout, .tapDisabledByUserInput:
    // macOS switches a tap off if it is slow or if something else intervenes.
    // Saying so beats going quiet and looking like nobody touched anything,
    // and turning it back on means the rest of the recording is not silently
    // lost after one slow callback.
    emit([("type", jsonString("interrupted"))])
    if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: true) }

  default:
    break
  }
  return Unmanaged.passUnretained(event)
}

// Whether this is allowed at all, reported before anything is promised. A tap
// for keys can be created and then simply never deliver one, which is the worst
// possible failure: a log that looks complete and is silently empty.
let keyboardAllowed = IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) == kIOHIDAccessTypeGranted
let pointerAllowed = AXIsProcessTrusted()

// Exercises the exact shapes the app receives without posting input into the
// user's active desktop. Posting a synthetic shortcut for a test can trigger
// that shortcut in whichever application currently has focus, which is both
// intrusive and a poor test of a listen-only helper.
if CommandLine.arguments.contains("--selftest") {
  emit([
    ("type", jsonString("click")),
    ("button", jsonString("left")),
    ("clicks", "2"),
    ("x", "120"),
    ("y", "80")
  ])
  emitKey(1, .maskCommand)       // Cmd+S: a shortcut, kept.
  emitKey(14, [])                // E: ordinary typing, redacted.
  emitKey(14, .maskAlternate)    // Option+E: typed accent, also redacted.
  emitKey(36, [])                // Enter: navigation, kept.
  emitKey(123, .maskAlternate)   // Option+Left: navigation, kept with modifier.
  exit(0)
}

if CommandLine.arguments.contains("--ask") {
  if !keyboardAllowed { IOHIDRequestAccess(kIOHIDRequestTypeListenEvent) }
  if !pointerAllowed {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
  }
}

if CommandLine.arguments.contains("--check") {
  emit([
    ("type", jsonString("status")),
    ("keyboard", keyboardAllowed ? "true" : "false"),
    ("pointer", pointerAllowed ? "true" : "false")
  ])
  exit(0)
}

let mask: UInt64 =
    (1 << CGEventType.leftMouseDown.rawValue)
  | (1 << CGEventType.rightMouseDown.rawValue)
  | (1 << CGEventType.otherMouseDown.rawValue)
  | (1 << CGEventType.scrollWheel.rawValue)
  | (1 << CGEventType.keyDown.rawValue)

guard let tap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  // Listen only. This helper never modifies, swallows or injects an event; it
  // cannot change what the machine does with a key press.
  options: .listenOnly,
  eventsOfInterest: CGEventMask(mask),
  callback: callback,
  userInfo: nil
) else {
  emit([
    ("type", jsonString("status")),
    ("keyboard", "false"),
    ("pointer", "false"),
    ("error", jsonString("the input tap was refused"))
  ])
  exit(3)
}
eventTap = tap

let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

emit([
  ("type", jsonString("status")),
  ("keyboard", keyboardAllowed ? "true" : "false"),
  ("pointer", pointerAllowed ? "true" : "false")
])

// Stops when whatever started it goes away, rather than outliving it. A process
// watching the keyboard must not be able to survive the thing that owns it.
if let parent = ProcessInfo.processInfo.environment["FR_PARENT_PID"], let pid = Int32(parent) {
  DispatchQueue.global().async {
    while kill(pid, 0) == 0 { Thread.sleep(forTimeInterval: 0.5) }
    exit(0)
  }
}

// Closing stdin is the ordinary way to say stop.
DispatchQueue.global().async {
  var buffer = [UInt8](repeating: 0, count: 256)
  while true {
    let n = read(0, &buffer, 256)
    if n <= 0 { exit(0) }
  }
}

CFRunLoopRun()
