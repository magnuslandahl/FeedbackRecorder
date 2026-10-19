# Test coverage audit and improvement plan

**Status:** planned improvements; none of the recommendations below are
implemented by this document. Track progress in the root [TODO](../TODO.md#test-coverage-and-release-safety).

**Audit snapshot:** 2026-10-19, commit `3b8b2fb`, including the keyframe fix
merged in [PR #62](https://github.com/magnuslandahl/FeedbackRecorder/pull/62).
Measurements and observations describe that snapshot, not a continuously
updated coverage dashboard.

## 1. Conclusion

FeedbackRecorder has a good foundation: substantial pure-logic tests, real
Electron media/UI integration, cross-platform CI, and thorough artifact-integrity
and macOS signing checks. The selection-state regression has the right kind of
protection: synthetic unit cases plus an encoded-video test that checks actual
saved pixels.

It does **not yet have comprehensive application or release assurance**. The
largest gaps are release publication independent of exact-commit CI,
intentionally partial releases, deletion of previous downloads before their
replacement is verified, missing macOS Electron CI, unmeasured application
controllers, native tests that do not execute, and no required packaged
transcription or genuine cross-version upgrade test.

Prioritize **safe automatic publication and tests that cannot pass without
exercising their promised behavior**, then expand coverage. A global 100% line
number would not establish that recording, transcription, installation or
updating works. Zero regressions cannot be guaranteed; the goal is observable
protection for every documented behavior and important failure path, with
publication blocked when required evidence is missing.

At the inspected release snapshot, **0.9.2** had all four expected installers
and `SHA256SUMS.txt`. The inspected CI and release runs succeeded. The concerns
below are gaps in what future releases must prove, not a claim that that release
was broken.

## 2. Verified baseline

### Executed tests

| Command or suite | Result | What it establishes |
| --- | --- | --- |
| Node unit suite with V8 coverage restricted to `src/**/*.js` | 329 reported: 327 passed, 2 skipped, 0 failed | Broad logic coverage, subject to the missing-native-helper false pass below |
| `npm --prefix app run test:pipeline` | Passed, 14/14 checks | Real Electron recording/decoding, seeking, cropping and WAV encoding with synthetic media |
| `npm --prefix app run test:ui` | Passed, 72/72 checks | Real renderer/preload, layout/theme and simulated permission/device/update states |
| `npm --prefix app run test:import` | Passed, 60/60 checks | UI-to-runtime import, packages, editing, reframing, exports and drag preparation |
| `npm --prefix app run test:discard` | Passed, 22/22 checks | Discard confirmation, run deletion, IPC and compact-control behavior |
| `npm --prefix app run test:history` | Passed, 51/51 checks | List/search/reopen/edit/export/delete against temporary packages |
| `npm --prefix app run test:keyframes` | Passed, 17/17 checks | Encoded-video transitions, selected-card PNG pixels and actual returns |
| `npm --prefix app run test:update-integrity` | Passed, 12/12 checks | Local HTTP download, update identity, checksums and cleanup |

The seven Electron suites reported 248 passing checks, not 248 independent
end-to-end user journeys. The import test actually cancelled processing at 4%
in this run; its fallback can nevertheless allow other runs to pass without
exercising cancellation.

Local instrumentation used Node **24.18.0**; CI uses Node **22** and its unit
matrix was independently verified green. Pin the measurement runtime before
adopting the local percentages as CI thresholds.

### Measured unit coverage

| Metric | Result |
| --- | --- |
| Lines | **96.83%**, 4,068/4,201 |
| Branches | **85.29%**, 1,107/1,298 |
| Functions | **96.34%**, 316/328 |
| Source modules represented | **26 of 36** JavaScript modules under `app/src` |

Ten modules containing **5,447 physical lines** are absent from the unit report.
Some execute in Electron integration tests, so absent from this report does
**not** mean completely untested. Their integration execution has no collected
coverage report or coverage gate at this snapshot.

| Omitted module under `app/src` | Physical lines | Existing evidence and remaining boundary |
| --- | ---: | --- |
| `main/build-info.js` | 57 | UI/version display runs; production metadata discovery is not comprehensively measured |
| `main/displays.js` | 203 | Real display probes; mixed-DPI, hotplug and placement across supported desktops remain unestablished |
| `main/main.js` | 263 | Harnesses create their own windows; real bootstrap/lifecycle lacks an entrypoint suite |
| `main/permissions.js` | 218 | Some status probes and simulated UI states; signed-app migration/restart remains unestablished |
| `main/runtime.js` | 692 | Real IPC in import/history/discard with substituted window/OS adapters; incomplete contract/failure inventory |
| `main/settings.js` | 77 | Happy-path persistence; denied writes, corrupt files and restart persistence need dedicated tests |
| `main/updater.js` | 649 | Real local download/integrity; installer/swap/relaunch/rollback largely outside required tests |
| `renderer/app.js` | 3,052 | Substantial UI integration; transitions, asynchronous races and failures remain unmeasured |
| `renderer/bar.js` | 89 | Compact-control checks; production placement/content exclusion/lifecycle need separate evidence |
| `preload/preload.js` | 147 | Real bridge loaded; complete method/event contracts need explicit coverage |

Physical lengths and executable coverage are different denominators. Do not
invent an app-wide percentage from them. Native Swift/C, build hooks,
vendor-fetch scripts, HTML/CSS and legacy tools also sit outside this report.

## 3. Feature-by-feature assurance map

| Area | Existing protection | Missing proof |
| --- | --- | --- |
| Keyframes and narration association | Synthetic rules, codec/seek/crop integration, saved-pixel selection regression and revisits | Resolution/codec/noise corpus, crop boundaries, gap/limit branches and property invariants |
| Media and WAV output | Real MediaRecorder pipeline and WAV validation | Supported containers/codecs across OSes, damaged media, variable frame rates, rotation, no-audio and long/high-resolution clips |
| Screen/microphone capture | Real `test:record` harness with microphone-wait regression | Not required in CI; denial/absent transcription can pass; production bar windows are substituted |
| Displays and compact control | DOM, previews, layout, buttons and shortcut descriptions | Production windows, hotplug, negative origins, mixed DPI/Retina, fullscreen Spaces, capture exclusion and shortcut conflicts |
| Permissions | Pure macOS identity/command tests and UI failure/migration messages | Actual reconciliation/persistence, refusal/regrant/restart and upgrade identity continuity |
| Input chronology/privacy | Parser/redaction/package tests, mocked lifecycle and native release selftests | Native assertions before merge, real delivery, coordinates, orphan prevention and interruption recovery |
| Transcription | Parser, routing, VAD/model lookup and subprocess-failure tests | Bundled binary/model producing expected words/timings, silence/noise and packaged-resource execution |
| Package writing | On-disk tests, staged frames, failed-generation preservation and note remapping | Rename/restore failure, disk-full/denied writes and interrupted multi-file finalization |
| Notes/transcript edits | Timing/metadata preservation, normalization, autosave and export integration | Delayed/out-of-order saves, rejection/retry, navigation/quit during save and interrupted-write consistency |
| History | List/search/reopen/edit/delete, moved/broken/missing packages and path guards | Large histories, external changes, denied folders, historical formats and restart recovery |
| Export/drag | Independent ZIP round trips, forced ZIP64, default media exclusion and IPC/icon preparation | I/O failures, interrupted output, generation races and large-file budgets |
| Updates | Version/architecture rules, immutable identity/checksums and local HTTP integration | HTTP failures/stalled bodies, installer launch errors, real upgrades/relaunch and startup rollback |
| Startup/lifecycle | Renderer startup and isolated component windows | Real main entrypoint, close/reactivate/quit, shortcut cleanup and packaged restart |
| Packaging/signing | Platform builds, slices/linkage, notarization, signatures, checksums and attestations | PR smoke only checks Linux unpacked-file existence with empty vendor; packaged launch/inference/upgrades are not required |
| Release operation | Automated versions, immutable inputs and upload digest verification | Exact-SHA CI, complete assets, interruption-safe promotion and retained known-good installers |
| Visual/accessibility | Theme/color, several viewport/layout assertions and public screenshot fixtures | Screenshot baselines, complete keyboard/focus behavior, accessible roles/names and screen-reader checks |
| Performance/resources | Harness timeouts and progress assertions | Long/4K recordings, memory/time budgets, large histories and repeated-session/process cleanup |
| Legacy tools | PowerShell 5.1/7 helpers and installer dry run | Skipped duration tests, Python-wrapper suite and real OBS workflow |

## 4. Priority findings

### P0: Publication is independent of exact-commit CI

Release builds and publication depend on release jobs, not successful CI for
the same SHA. A protected PR does not eliminate merge-result regressions or a
failed/cancelled post-merge run.

Allow builds to run in parallel for speed, but qualify publication against
successful required checks for the exact candidate SHA. Missing, pending,
failed, cancelled or unexpectedly skipped qualification must not promote it.
Verify the candidate is not stale before promotion.

Evidence: [release triggers/jobs](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/.github/workflows/release.yml#L8-L40)
and [publication dependencies](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/.github/workflows/release.yml#L493-L521).

### P0: Failed platforms can produce a partial replacement release

Publication explicitly accepts a failed build matrix unless it was cancelled.
Validation requires some supported installers, not the full four-file set.
This can remove a platform from permanent download links.

Require Windows x64, macOS arm64, macOS x64 and Linux x86-64 installers from one
qualified SHA/version, plus the exact manifest. Any emergency partial-release
mechanism should be explicit and must not silently remove known-good downloads.

Evidence: [partial-publication condition and validation](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/.github/workflows/release.yml#L493-L545).

### P0: Replacement deletes known-good downloads before verification

The workflow deletes `latest`, creates the replacement, verifies remote digests
and only then records the semantic version tag. Release concurrency permits
cancellation. Failure after deletion can remove known-good downloads; Git tags
alone do not preserve installer assets.

Validate an immutable versioned candidate, retain known-good assets, then
perform recoverable promotion. Preserve the no-mixed/stale-assets invariant
and compatibility with updater `/releases/latest` discovery and fixed download
URLs. Test interruption/retry at each publication boundary.

Evidence: [cancellation](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/.github/workflows/release.yml#L27-L29),
[publication ordering](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/.github/workflows/release.yml#L633-L681)
and [tests requiring delete-first](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/app/test/security-workflows.test.js#L50-L69).
Update those tests to protect the intended invariant, not that implementation.

### P1: Green tests do not always execute their named capability

- The macOS native test returns when its helper is missing, producing a pass
  without native assertions. Unit CI does not build it.
- Both Windows native tests skip on the actual Windows job because the helper
  is missing; this was confirmed in the green CI logs.
- Import cancellation accepts "finished first" as a passing alternative.
- The macOS swap harness exits successfully without a DMG. With one, it installs
  the same image over itself and checks executable existence, not startup.
- Legacy duration cases skip on both PowerShell hosts because ffmpeg/ffprobe
  are missing.
- Aggregate CI rejects failure/cancellation but not every unexpectedly skipped
  prerequisite. Dependency review intentionally skips on `main`; use an
  event-aware allowlist rather than banning all skips.

Build required prerequisites and fail the owning job if its promised capability
was not exercised. Distinguish optional probes from qualification. Make
cancellation deterministic with barriers rather than timing races.

Evidence: [macOS no-op](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/app/test/input-events.test.js#L225-L248),
[Windows prerequisites](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/app/test/input-capture.test.js#L267-L318),
[cancellation fallback](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/app/test/electron/import-e2e.js#L381-L412)
and [aggregate CI](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/.github/workflows/ci.yml#L250-L269).

### P1: Controllers are unmeasured and macOS lacks Electron CI

There is no coverage command/threshold, ten source modules are absent from the
unit report, and Electron CI runs only on Windows/Linux. Runtime harnesses
substitute window callbacks; UI smoke uses its own IPC stubs. Neither boundary
proves production bootstrap/OS integration.

Measure main/renderer/preload execution, include unloaded modules, add macOS
Electron CI and a real-entrypoint suite, and track native/build-script evidence
separately.

Evidence: [CI matrix](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/.github/workflows/ci.yml#L25-L164),
[UI stubs](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/app/test/electron/ui-smoke.js#L65-L140)
and [bootstrap](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/app/src/main/main.js#L230-L263).

### P1: Durability and recovery lack fault-injection proof

Frame replacement has staging/restore logic and a failed-generation test, but
frames and metadata are separate IPC operations and finalization writes related
files sequentially. Recovery from disk-full, denied writes or interruption
between those operations is not established.

Source observations requiring regression tests: `settings.save()` catches write
failure and returns the would-be settings; download timeout clears once headers
arrive, leaving no body deadline in that function; the macOS swap removes its
backup before successful relaunch is established. The audit did not reproduce
real-world data loss or a broken update.

Inject narrow filesystem/process/transport failures, then fix exposed behavior
in focused changes. Keep the previous complete package/application usable until
replacement is committed and, for an update, shown to start.

Evidence: [finalization](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/app/src/main/package-writer.js#L289-L318),
[settings writes](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/app/src/main/settings.js#L65-L75),
[download lifecycle](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/app/src/main/updater.js#L289-L347)
and [swap/relaunch](https://github.com/magnuslandahl/FeedbackRecorder/blob/3b8b2fb/app/src/main/updater.js#L514-L557).

### P1: Packaged speech and genuine upgrades lack required proof

Mocked routing covers 98.53% of `whisper.js` lines without proving bundled
inference. Import stubs transcription; keyframe tests can succeed without it.
The manual `whisper-check.js` probe is outside the unit glob and checks nonempty
segments, not expected words. Checksum success and same-image replacement also
do not prove a cross-version upgrade launches and preserves user data.

Add owned/licensed speech fixtures, packaged inference and N-1-to-N upgrades on
actual shipped architectures. Keep large models and signed qualification
outside fast unit runs, but require the candidate itself to pass before promotion.

## 5. Implementation sequence

Deliver each step as a small reviewable change with its own regression tests.
This sequence is proposed work, not completed implementation.

| Step | Priority | Deliverable | Acceptance criteria | Dependency |
| --- | --- | --- | --- | --- |
| 1 | P0 | Exact-SHA gate and complete manifest | Missing/failed/pending/cancelled CI or any missing/wrong-SHA installer blocks publication; four installers have one version; simulate workflow/API outcomes | None |
| 2 | P0 | Recoverable publication | Interruption preserves known-good downloads; retries cannot mix assets or advance versions twice; permanent links and updater identity/checksum rules remain valid | Step 1 |
| 3 | P1 | Honest coverage/prerequisites/skips | All 36 JS modules appear, including zero-hit files; main/renderer/preload merge correctly; owning-OS native assertions execute; missing required evidence fails | Independent; parallel with release work |
| 4 | P1 | macOS Electron, startup and contracts | Portable suites pass on all three OSes; real entrypoint/lifecycle releases resources; bridge contracts and settings success/failure/restart are covered | Step 3 |
| 5 | P1 | Failure and race suite | I/O/process/HTTP failures cannot falsely report saved output; cancellation actually runs; previous packages remain readable; retries do not commit stale edits | Steps 3-4 |
| 6 | P1 | Packaged qualification/upgrades | Every shipped architecture launches; real inference matches content/timing expectations; N-1 upgrades to N, starts and preserves data/identity; failure restores or retains the old app | Steps 1-4 and recovery from Step 5 |
| 7 | P2 | Compatibility corpus/properties | Supported media/historical packages work; malformed inputs fail clearly; known pixel states survive; timing/reference invariants and documented transitions have tests | Step 3; build on Steps 4-5 |
| 8 | P2 | Accessibility/visual/resource budgets | Keyboard/focus/names pass, screenshot baselines are reviewed, repeated/long/4K sessions and large histories meet calibrated budgets and release resources | Stable fixtures from Steps 4 and 7 |
| 9 | P2 | Legacy coverage | Duration executes on both PowerShell hosts; Python wrapper has argument/output/failure tests with a stub backend; real OBS qualification is separate | Independent |

### Coverage rules

Reuse Node/V8 for logic/main and Chromium precise coverage for renderer/preload,
accounting for isolated worlds and multiple windows. Prove the collector sees
known lines before trusting merged numbers. Include unloaded/new modules with
zero hits; exclusions must be documented generated/third-party code. Native
Swift/C and build scripts need separate inventories and evidence.

Measured weak points include input capture **79.62% lines / 68.37% branches**,
package writer **80.22% branches**, mac-permissions **76.60% branches**,
checksums **73.08% branches**, update rules **79.12% branches**, and uncalled
shortcut-state logic. Collect existing Electron coverage before duplicating it.

Pin the runtime, establish an honest combined baseline, then ratchet
line/branch/function and changed-code coverage. Require reasons for decreases
or exclusions. Aim for meaningful assertions for every reachable business/error
rule, not 100% through stubs or exclusions. Use focused mutation tests on
keyframe, redaction, update and normalization rules.

Compile native helpers independently of model downloads for fast required
selftests. A non-owning-OS skip is expected; a missing helper on its owning job
must fail. Apply that distinction to ZIP extractors, qualification images and
ffmpeg/ffprobe wherever those capabilities are promised.

### Required failure and transition cases

| Surface | Cases to add or strengthen |
| --- | --- |
| Recording | Double start, stop/discard races, track ends, device removal, unresolved microphone, revoked permission, helper exit and application quit |
| Processing | Deterministic scan/extraction/transcription cancellation; no late writes; repeated cancel/resume; consistent final commit when cancellation is disabled |
| Persistence | ENOSPC/EACCES/rename/restore injection without filling real disks; child-process interruption at write barriers; reopen and compare complete contents |
| Editing/navigation | Edits during delayed saves, rejection/retry, export/history/rerecord/quit while dirty, and stale drag generations |
| Settings/permissions | Missing/corrupt/unwritable settings, normalization, changed roots, identity unchanged/changed, failed reset and relaunch |
| Updates | Header/body deadlines, disconnect/truncation, bad metadata/status/checksum, release rotation, duplicate install, failed launch, unwritable destination and unsuccessful new-app startup |
| IPC/preload | Every public method/event maps to its handler/result/error; no stale subscriptions or cross-window state after repeated lifecycle cycles |

Specify product decisions before changing behavior. Do not invent recording
limits or change cancellation semantics just to simplify tests.

### Packaged qualification

Start with the existing `--selftest`, but go beyond resource discovery: launch
the real packaged UI and transcribe known audio with its bundled executable
and models. Cover English, Swedish, silence and a bounded multilingual set.
Freeze expected content, timing tolerance and calibrated word-error budgets per
fixture/model instead of merely requiring nonempty output.

Run the previous downloadable version's upgrade into the candidate in a
controlled installation. Assert the version from a successfully started
process, preserved settings and reopened packages. Check official macOS
designated-requirement stability and permission continuity on a provisioned
machine. Test Windows NSIS separately; Linux download/reveal is intentionally
not an in-place install.

An arm64 build check is not proof of x64 execution. Real capture, TCC,
fullscreen/monitor behavior and native event delivery require controlled
interactive machines or explicit local qualification, not only headless CI.
Start with a narrow documented checklist, then automate on isolated provisioned
runners so normal releases do not accumulate a manual ritual.

## 6. Keep pushing and releasing easy

| Gate | Contents | Policy |
| --- | --- | --- |
| Fast required PR CI | Units, portable Electron on three OSes, helper selftests, deterministic media/UI/contracts/faults, coverage ratchets and existing privacy/dependency/secret checks | One aggregate required result; missing required capabilities fail |
| Scheduled/expanded compatibility | Larger media/visual/history corpus, mutation/properties, OS/architecture coverage, long-session/resource and controlled capture checks | Failures stay visible; affected changes require relevant qualification |
| Exact-SHA release qualification | Four actual installers, packaged launch/inference, signing/integrity, N-1 upgrade/recovery and complete manifest | Builds run in parallel; promotion waits for all required candidate evidence |
| Promotion/recovery | Retained immutable assets, validated stable links/discovery, interruption/retry tests and rollback | Automatic on success; preserve known-good downloads on failure |

Cache immutable models/dependencies, parallelize independent OS jobs, keep
small fixtures in the fast gate, and reserve large media/hardware for the
appropriate tier. Do not add live GitHub downloads or model acquisition to each
unit run.

When implementing, add a documented one-command portable CI runner and a separate
qualification runner, preserving targeted commands. Avoid a broad renderer
rewrite; extract only the state/transport/filesystem seams needed for tests.

## 7. Definition of comprehensive protection

Every documented feature, important transition and destructive/recovery
operation has an owner test with positive/negative expectations. Required
platform capabilities execute, all modules appear in coverage reports,
packaged products and real upgrades qualify, and unqualified candidates cannot
replace known-good downloads.

Maintain a requirement-to-test matrix with developer documentation. A production
regression should add the smallest deterministic test at the lowest useful
level plus integration/artifact coverage if it crossed codec, IPC, OS,
packaging or update boundaries. The selection-state regression is the example.

Track uncovered branches/modules, required capability execution/skips, focused
mutation survivors, platform/format coverage, flakes/retries, resource trends
and escaped regressions separately. A percentage alone is never the safety claim.

## 8. Limits and unverified items

- Real screen/microphone capture was inspected, not freshly executed during this
  audit, to avoid indiscriminate capture and permission side effects.
- No live installer download/execution, DMG swap, real bundled-model inference
  or new signed build was performed. Local vendor resources/build artifacts
  were absent; a no-image swap exit code would be misleading.
- The unit/portable Electron results above were freshly run. Windows/Linux and
  legacy results were verified from CI, not claimed as local execution.
- `main` was protected with visible required context `CI` and enforcement for
  everyone. Full protection settings returned 404 and rulesets were empty;
  approval, strict/up-to-date, bypass and CodeQL merge policies were not fully
  verified. Limited API visibility does not mean the branch is unprotected.
- YAML/source-text policy tests do not prove signing/publication shell behavior
  under failures.
- No whole-app/native percentage or new accessibility/performance/real-OS
  certification was established.
- This audit and its backlog do not implement any proposed product or CI fixes.

## Appendix A: measured unit coverage

Only the 26 loaded modules in the instrumented run appear here.

| Module under `app/src` | Lines % | Branches % | Functions % |
| --- | ---: | ---: | ---: |
| `main/exporter.js` | 100.00 | 100.00 | 100.00 |
| `main/history.js` | 98.05 | 87.21 | 100.00 |
| `main/input-capture.js` | 79.62 | 68.37 | 70.83 |
| `main/mac-permissions.js` | 99.20 | 76.60 | 100.00 |
| `main/package-writer.js` | 94.96 | 80.22 | 93.55 |
| `main/whisper.js` | 98.53 | 92.13 | 100.00 |
| `main/window-chrome.js` | 100.00 | 100.00 | 100.00 |
| `main/window-size.js` | 100.00 | 100.00 | 100.00 |
| `main/zip.js` | 100.00 | 92.06 | 100.00 |
| `shared/brief.js` | 99.08 | 88.44 | 100.00 |
| `shared/checksums.js` | 97.62 | 73.08 | 100.00 |
| `shared/exports.js` | 100.00 | 78.57 | 100.00 |
| `shared/imports.js` | 100.00 | 100.00 | 100.00 |
| `shared/input-events.js` | 100.00 | 81.20 | 100.00 |
| `shared/keyframes.js` | 98.60 | 89.39 | 94.74 |
| `shared/languages.js` | 100.00 | 94.44 | 100.00 |
| `shared/naming.js` | 98.25 | 81.25 | 100.00 |
| `shared/narration.js` | 100.00 | 88.24 | 100.00 |
| `shared/paths.js` | 100.00 | 100.00 | 100.00 |
| `shared/region.js` | 100.00 | 90.91 | 100.00 |
| `shared/screen-size.js` | 100.00 | 100.00 | 100.00 |
| `shared/shortcuts.js` | 74.14 | 94.74 | 75.00 |
| `shared/themes.js` | 100.00 | 93.75 | 100.00 |
| `shared/updates.js` | 98.71 | 79.12 | 100.00 |
| `shared/version.js` | 100.00 | 100.00 | 100.00 |
| `shared/wav.js` | 100.00 | 66.67 | 100.00 |

## Appendix B: reproduction and evidence

From `app/`, set `AUDIT_DIR` to an existing private output directory outside the
checkout, then run:

```bash
node --test --experimental-test-coverage \
  --test-coverage-include='src/**/*.js' \
  --test-reporter=lcov \
  --test-reporter-destination="$AUDIT_DIR/unit.lcov" \
  --test-reporter=spec \
  --test-reporter-destination="$AUDIT_DIR/unit.log" \
  'test/*.test.js'
```

No coverage dependency is required. Reconcile the report with the complete
source inventory; this command does not add unloaded files. Keep raw diagnostic
output private because it can contain paths/device details.

Public evidence inspected:

- [PR #62 CI run](https://github.com/magnuslandahl/FeedbackRecorder/actions/runs/39255467744):
  all required jobs passed; logs confirm skipped Windows native/legacy duration
  prerequisites.
- [Release run](https://github.com/magnuslandahl/FeedbackRecorder/actions/runs/39164136838):
  all platform builds and publication succeeded.

New fixtures must be deterministic synthetic or explicitly owned/licensed test
material. Do not commit private recordings, narration, transcripts, screenshots,
machine paths or diagnostic output.
