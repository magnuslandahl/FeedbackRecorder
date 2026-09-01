# Agent instructions

## Public repository safety

FeedbackRecorder is a public repository. Treat every tracked file, commit,
branch, tag, commit message, pull request, and issue as externally visible.

Before every commit:

- Review `git status --short` and `git diff --cached` for credentials, API keys,
  tokens, private keys, connection strings, internal URLs, personal or company
  data, local absolute paths, recordings, transcripts, screenshots, and other
  private material.
- Run `gitleaks git --staged --no-banner` when Gitleaks is available, and
  manually inspect the staged diff regardless of the scanner result.
- Never commit local configuration, `.env` files, credentials, logs, generated
  recordings, transcripts, run output, or build artifacts. Use sanitized sample
  files and obvious placeholders instead.
- Stop and alert the repository owner if sensitive data is found. If a secret
  has already been committed, it must be revoked or rotated; deleting it in a
  later commit is not sufficient.
