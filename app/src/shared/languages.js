'use strict';

// The languages offered for dictation, and the rules for handling whatever ends
// up in the settings file.
//
// whisper.cpp accepts about a hundred language codes. This list is deliberately
// shorter: a dropdown with a hundred entries is worse to use, and nobody is shut
// out by the shortening, because "auto" detects the rest. Add a code here when
// somebody actually wants it.

const AUTO = 'auto';
const DEFAULT_LANGUAGE = 'en';

const LANGUAGES = [
  { code: AUTO, label: 'Detect automatically' },
  { code: 'en', label: 'English' },
  { code: 'sv', label: 'Swedish' },
  { code: 'da', label: 'Danish' },
  { code: 'no', label: 'Norwegian' },
  { code: 'fi', label: 'Finnish' },
  { code: 'is', label: 'Icelandic' },
  { code: 'de', label: 'German' },
  { code: 'nl', label: 'Dutch' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'pl', label: 'Polish' },
  { code: 'cs', label: 'Czech' },
  { code: 'sk', label: 'Slovak' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'ro', label: 'Romanian' },
  { code: 'el', label: 'Greek' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ru', label: 'Russian' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ar', label: 'Arabic' },
  { code: 'he', label: 'Hebrew' },
  { code: 'fa', label: 'Persian' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'th', label: 'Thai' },
  { code: 'id', label: 'Indonesian' },
  { code: 'ms', label: 'Malay' },
  { code: 'tl', label: 'Tagalog' }
];

const BY_CODE = new Map(LANGUAGES.map((item) => [item.code, item]));

function isAuto(code) {
  return normalize(code) === AUTO;
}

// Anything unrecognised becomes the default rather than being passed through. A
// stale or hand-edited settings file should not reach the transcriber, which
// would reject it and cost a recording its transcript.
function normalize(code) {
  const value = String(code == null ? '' : code)
    .trim()
    .toLowerCase();
  if (!value) return DEFAULT_LANGUAGE;
  return BY_CODE.has(value) ? value : DEFAULT_LANGUAGE;
}

// Used for a language the transcriber reports back, which may be any of the
// codes whisper knows rather than only the ones offered here.
function describe(code) {
  const value = String(code == null ? '' : code)
    .trim()
    .toLowerCase();
  if (!value || value === AUTO) return 'unknown';
  const known = BY_CODE.get(value);
  return known && known.code !== AUTO ? known.label : value;
}

module.exports = { AUTO, DEFAULT_LANGUAGE, LANGUAGES, isAuto, normalize, describe };
