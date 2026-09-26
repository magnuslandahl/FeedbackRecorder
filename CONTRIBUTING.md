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
| Dependency review | Pull requests do not introduce high/critical vulnerable dependencies, and license changes are visible. |
| Privacy and supply chain | Redaction, export defaults, immutable vendor inputs, update verification, and the no-production-dependency rule hold. |

CodeQL runs separately and reports JavaScript/TypeScript results in GitHub's
Security view.

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
rolling `latest` release. Every published build gets its own semantic version:

- Apply `enhancement` to a user-facing feature. `0.2.4` becomes `0.3.0`.
- Small fixes and polish default to a patch. `0.2.4` becomes `0.2.5`;
  `bug` or `documentation` makes that intent explicit.

The workflow calculates the version once and stamps the same number into every
platform. Do not bump `app/package.json` or create a release tag by hand:
successful publishing records the version as a `v*` git tag. Installer names
stay fixed so the README's permanent download links keep working.

Vendor inputs in `app/scripts/fetch-vendor.js` are immutable and carry exact
sizes and SHA-256 digests. Changing whisper.cpp, a model, or a release archive
requires updating its revision, digest, inventory entry in
[`docs/SHIPPED_COMPONENTS.md`](docs/SHIPPED_COMPONENTS.md), and the focused
integrity tests. Never replace a revision with a moving branch such as
`resolve/main`.

The updater accepts a release installer only after verifying its exact entry in
the release's `SHA256SUMS.txt`. `npm run test:update` exercises that behavior
against the live release and performs the comparison automatically.

GitHub Actions references are pinned to full commit SHAs with version comments.
Revalidate the upstream tag before changing a pin. The release publish job
attests exactly the installers and checksum file it uploads. Verify a downloaded
artifact with:

```bash
gh attestation verify <file> -R magnuslandahl/FeedbackRecorder
```
