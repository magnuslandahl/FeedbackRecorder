# Contributing

Thanks for looking. Issues and pull requests are welcome.

## How changes get in

`main` is protected: it cannot be pushed to directly, and every change arrives as
a pull request that CI has passed. That applies to the repository owner too.

```bash
git switch -c a-short-descriptive-name
# make the change
git commit
git push -u origin a-short-descriptive-name
gh pr create
```

## What CI checks

[`ci.yml`](.github/workflows/ci.yml) runs on every pull request:

| Job | What it proves |
| --- | --- |
| Unit tests | The pure logic holds on Linux, Windows and macOS. |
| Electron tests | The media pipeline and the real UI still work in a real renderer. |
| Packaging smoke test | The app still packages, so a release is not the place that breaks. |
| Legacy CLI tests | `review-recorder.ps1` still works on Windows PowerShell 5.1 and 7. |
| Secret scan | No credentials are being committed to a public repository. |

Run the same things locally before pushing:

```bash
cd app && npm test && npm run test:pipeline && npm run test:ui
```

The tests that need a real screen and microphone — `npm run test:record` — cannot
run in CI. Run them yourself when you change recording or packaging.

## This repository is public

Everything here is visible to anyone: files, commit messages, branch names, issue
text. Before committing, check the change for credentials, tokens, internal URLs,
personal data, absolute paths from your machine, and recordings or transcripts.
[`AGENTS.md`](AGENTS.md) has the full rule, and CI enforces it.

If a secret is ever committed, revoke or rotate it. Deleting it in a later commit
does not remove it from the history, and does not un-publish it.

## Style

- Match the surrounding code; there is no separate style guide.
- Comment the reason, not the mechanism. Most comments here record something that
  was learned the hard way, and those are worth keeping.
- A test that would have caught the bug is worth more than a description of it.

## Releases

Pushing to `main` rebuilds the installers for every platform and refreshes the
rolling `latest` release. Each build is stamped with the CI run number, so
`0.2.0 (build 42)` and `0.2.0 (build 43)` can be told apart — the app shows it,
and every package it makes records it.

A permanent versioned release comes from bumping `version` in
`app/package.json` in a pull request, then tagging the merge:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

Tagged releases carry the version in the installer file name; the rolling build
keeps fixed names so the README download links keep working.
