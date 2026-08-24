# App-review agent prompt

Paste this into a coding agent (for example GitHub Copilot) from inside a run
folder produced by `review-recorder.ps1 stop`. It expects `transcript.txt` and a
`keyframes\` folder next to it.

```text
You are a senior engineer. I recorded a review of our application and captured
spoken feedback plus screenshots.

Source of truth in this run folder:
  - transcript.txt   spoken feedback (may be in Swedish)
  - keyframes\        screenshots captured during the review
  - run.json          metadata about the recording and pipeline

Do the following:
  1. Summarize the review as a short list of concrete findings.
  2. Turn each finding into an actionable work item (title + acceptance criteria).
  3. Rank the work items by user impact (High / Medium / Low).
  4. For each item, propose where in the codebase the change likely belongs and
     outline an implementation approach.
  5. List open questions where the feedback is ambiguous and needs clarification
     before coding.

Rules:
  - Do not invent findings that are not supported by the transcript or keyframes.
  - Keep the meaning of Swedish feedback intact; you may answer in English.
  - Prefer small, verifiable changes over large rewrites.

Output format:
  ## Findings
  ## Work items (prioritized)
  ## Suggested implementation notes
  ## Open questions
```

## Tips

- If the transcript is empty, rely on the keyframes and ask the user for context.
- Attach or open the keyframes when your agent supports image input, so it can
  correlate spoken feedback with what was on screen.
