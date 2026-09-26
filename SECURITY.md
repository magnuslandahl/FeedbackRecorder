# Security policy

## Supported versions

FeedbackRecorder is a small project with a rolling `latest` release. Security
fixes are provided only in the newest published version and on the `main`
branch. Older releases and source snapshots are not maintained.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability. Use
[GitHub private vulnerability reporting][private-report] so the report, replies,
and any proposed fix remain private until disclosure is coordinated.

Include the affected version, operating system, impact, and the smallest safe
reproduction you can provide. We aim to acknowledge a report within three
business days and provide an initial assessment within seven business days.
Remediation and disclosure timing depend on severity and release complexity; we
will keep the reporter informed and coordinate publication rather than exposing
an unpatched issue.

## Protect recording data

Never put recordings, narration audio, transcripts, `run.json`, credentials,
tokens, private keys, local paths, or private screenshots in a public issue.
`run.json` can contain transcript text, written notes, and paths from the machine
that created the package. Describe the problem with sanitized text, and use the
private reporting channel when private material is necessary to investigate a
security issue.

[private-report]: https://github.com/magnuslandahl/FeedbackRecorder/security/advisories/new
