# Code signing and notarization

FeedbackRecorder ships unsigned. Windows SmartScreen warns, and macOS refuses to
open the app until the user goes into System Settings. This document records what
that costs to fix, what it does *not* fix, and exactly what changes when a
certificate is bought — so the decision can be made once, from real numbers,
rather than re-researched every time somebody complains about the warning.

Researched 2026-09-02. Prices and eligibility rules move; check the sources at
the bottom before spending anything.

## Where this stands today

| Platform | What is shipped | What the user sees |
| --- | --- | --- |
| Windows | Unsigned NSIS installer | "Windows protected your PC" → *More info* → *Run anyway* |
| macOS | Ad-hoc signed dmg (`build/after-pack.js`) | "cannot check it for malicious software" → *Open Anyway* in System Settings |
| Linux | AppImage | Nothing; Linux has no equivalent gate |

The ad-hoc signature on macOS is not a half-measure toward notarization. It exists
because macOS will not launch a bundle whose signature does not match its
contents, and electron-builder rewrites those contents. It buys nothing with
Gatekeeper.

---

## macOS — worth buying

This is the clear-cut case. Gatekeeper **blocks**, and there is no free way
around it:

- Homebrew Cask is no longer a workaround. Homebrew applies quarantine so
  Gatekeeper still runs, and *deprecates and removes casks that fail its
  Gatekeeper checks* rather than normalising a bypass. An unsigned dmg is not
  eligible for `homebrew/cask` at all.
- The click-through path still works, but Apple removed the old right-click
  shortcut in macOS 15, and a managed Mac can be configured so the override is
  not offered.

**Cost: 99 USD/year.** The Apple Developer Program accepts individuals and sole
proprietors — no company, no D-U-N-S number. Apps are listed under your personal
legal name, which will appear in the signature and in Gatekeeper dialogs. The
free tier does not include Developer ID or notarization.

### It buys three things, not one

Gatekeeper is the visible one, but signing on macOS is load-bearing in two other
places, and both are things users have already run into:

1. **The install warning goes away.** A notarized app opens on a double-click.
2. **Permissions stop being revoked.** macOS's TCC database identifies an app by
   its bundle identifier *and* its code requirement. The ad-hoc signature the
   build falls back to today is pinned to the exact bytes of that build, so every
   new version looks like a different app and Screen Recording and Microphone
   have to be granted again.
3. **macOS can auto-update.** Replacing a running app requires the replacement to
   satisfy the running copy's designated requirement. Unsigned fails outright;
   ad-hoc signed fails on the *next* build, because the requirement is a hash of
   the current one. This is why the update flow on macOS downloads and opens the
   disk image instead of installing, while Windows updates in place.

All three are fixed by the same purchase, and none of them can be worked around
in code.

### What is already wired up

Nothing here needs code changes any more. The build signs and notarizes as soon
as the secrets exist, and falls back to the ad-hoc signature when they do not, so
a fork with no certificate still builds.

- `app/build/entitlements.mac.plist` — `allow-jit`,
  `allow-unsigned-executable-memory`, `disable-library-validation` (needed
  because `whisper-cli` is a separate binary) and `device.audio-input`.
- `app/electron-builder.yml` — hardened runtime on, entitlements wired, and
  `whisper-cli` listed in `mac.binaries`. That last one matters: it is copied in
  as an extra resource, so it is not signed with the app, and notarization
  rejects any unsigned binary inside the bundle.
- `app/build/after-pack.js` — stops ad-hoc signing when a certificate is present,
  so it cannot leave ad-hoc signatures that notarization would reject.
- `.github/workflows/release.yml` — exports the certificate, writes the API key
  to a file, notarizes, and then reports what the finished app is actually signed
  with, so an unsigned release cannot quietly pass for a signed one.

### What you need to add

Six repository secrets, at *Settings → Secrets and variables → Actions*. They
live only there — never in the repository, and never in a build log. This
workflow runs only on pushes to `main` and on tags, so a pull request, including
one from a stranger's fork, cannot read them.

| Secret | What to put in it |
| --- | --- |
| `MAC_CSC_LINK` | The Developer ID Application `.p12`, base64-encoded: `base64 -i cert.p12 \| pbcopy` |
| `MAC_CSC_KEY_PASSWORD` | The password set when exporting that `.p12` |
| `APPLE_API_KEY_P8` | The **text contents** of the `AuthKey_XXXXXXXX.p8` file, pasted as-is, `-----BEGIN PRIVATE KEY-----` and all |
| `APPLE_API_KEY_ID` | The key ID, the `XXXXXXXX` part of the filename |
| `APPLE_API_ISSUER` | The issuer ID from App Store Connect |
| `APPLE_TEAM_ID` | The ten-character team ID |

Getting them:

1. In the Apple Developer account, create a **Developer ID Application**
   certificate, then export it from Keychain Access as a `.p12` with a password.
2. In App Store Connect → *Users and Access* → *Integrations* → *Keys*, create a
   team key with the **Developer** role. The `.p8` downloads **once** and cannot
   be downloaded again.

Use the API key rather than an Apple ID and app-specific password: it does not
expire and needs no two-factor prompt. Note that `notarytool` wants a *path* to
the key file, not the key itself — the workflow writes the secret to a file in
the runner's temporary directory and deletes it afterwards.

### What signing makes public

Code signing is an identity claim, so the identity becomes public by design. The
certificate's subject — the company name on the Apple account — is embedded in
every release, shown by Gatekeeper, and readable with `codesign --display`. There
is no way to sign anonymously; that is the point of signing. Nothing else about
the account is exposed.

Verify a finished build with:

```bash
spctl --assess --verbose --type exec "FeedbackRecorder.app"   # → source=Notarized Developer ID
xcrun stapler validate "FeedbackRecorder.app"
```

The release workflow already prints all three checks for every macOS build.

---

## Windows — a judgement call, and cheaper than it looks

**Do not buy an EV certificate.** This is the finding that overturns most advice
online, including electron-builder's own documentation. Microsoft's current
guidance says plainly:

> EV certificates no longer bypass SmartScreen. […] this behavior no longer
> exists. […] Paying a premium for EV solely to avoid SmartScreen warnings is no
> longer justified.

Microsoft's comparison table puts OV and EV in the same row: both still show the
warning on first download. EV now matters only for kernel-mode drivers and some
enterprise procurement.

So no certificate buys a clean first install. What signing *does* buy:

| | Unsigned (today) | Signed (any OV tier) |
| --- | --- | --- |
| Publisher name in the dialog | No | Yes, verified |
| Reputation across releases | **Resets to zero every release, forever** | Inherited by each new release |
| Windows 11 Smart App Control | Blocks unsigned files | Works |

The second row is the real argument. Microsoft: *"reputation cannot transfer from
previous versions unless both were signed using the same publisher identity."*
Unsigned means starting from zero on every single release, permanently. The third
row matters more over time — Smart App Control blocks unsigned executables
outright, so the free click-through path is quietly degrading.

### The options

| Option | Cost | Works in GitHub Actions | Catch |
| --- | --- | --- | --- |
| **Microsoft Store** | **Free** | Separate channel | Store apps *never* see SmartScreen. Registration fees were removed for both Individual and Company accounts. Needs MSIX packaging and Store certification, and the GitHub `.exe` still warns |
| **Azure Artifact Signing** | 9.99 USD/mo | Yes, natively | **Individuals must live in the US or Canada.** Organizations in the EU, including Sweden, are eligible |
| Traditional OV certificate | Varies, verify current pricing | Only via cloud HSM | Since June 2023 the key must live in a FIPS-certified HSM. No exportable `.pfx` exists any more |
| Certum Open Source | €69 | **No** | A physical smart card. Cannot be used from a hosted runner |
| Do nothing | Free | — | Works today; loses users who will not click through a malware warning |

**Azure Artifact Signing** (renamed from Trusted Signing — the docs, CLI extension
and GitHub Action were all renamed in 2026) is the cheapest compliant path at
about 120 USD/year, with no hardware and native electron-builder support:

```yaml
win:
  azureSignOptions:
    endpoint: https://weu.codesigning.azure.net/   # must match the account region
    codeSigningAccountName: <account>
    certificateProfileName: <profile>
    publisherName: <the validated name on the certificate>
```

with `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` as secrets, or
OIDC federation to avoid a long-lived secret. Note that `azureSignOptions` and
`signtoolOptions` are mutually exclusive, that its certificates are valid for only
72 hours so timestamping is mandatory, and that identity validation for an
individual is a photo-ID and liveness check that completes in under an hour, while
an organization takes 1–20 business days.

The eligibility rule is the deciding factor: **as a Swedish individual this option
is unavailable; through a Swedish company it is.**

---

## Decision

1. **macOS: sign and notarize with the existing company Apple Developer account.**
   macOS is blocked rather than merely warned about, the repository is already
   wired for it, and the credentials live in GitHub Actions secrets rather than
   in the repository. The company name will appear in the signature and in
   Gatekeeper — that is inherent to signing, not a leak.
2. **Windows: the free Microsoft Store channel.** This is a personal project
   rather than something sold, so an Individual Store account fits, and it costs
   nothing. Store apps are re-signed by Microsoft and **never** show SmartScreen.
   Azure Artifact Signing stays available later if the `.exe` on GitHub Releases
   needs to stop warning too — as a Swedish company that route is open, though as
   a private individual it is not.
3. **Do not buy EV**, and treat any advice that says EV clears SmartScreen as out
   of date.

Whatever is decided, keep publishing `SHA256SUMS.txt`. It does nothing for
SmartScreen or Gatekeeper, but it is what lets a careful user — and Homebrew —
verify a download.

### Still to do for Windows

The Store route is not wired up. It needs a Partner Center account, a reserved
app name, and the Publisher ID and Identity Name that Partner Center issues,
which then go into an `appx` target. None of that can be prepared without the
account, so it is deliberately left until there is one.

## Sources

- SmartScreen and certificate types, including the EV note:
  <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation>
- Microsoft Store developer accounts are free:
  <https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account>
- Azure Artifact Signing quickstart, including the geographic eligibility note:
  <https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart>
- Apple membership comparison and the 99 USD fee:
  <https://developer.apple.com/support/compare-memberships/>
- Notarization requirements:
  <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- What macOS shows and how a user overrides it:
  <https://support.apple.com/en-us/102445>
- Homebrew's Gatekeeper enforcement for casks:
  <https://docs.brew.sh/Homebrew-Security-and-Supply-Chain>
- Hardware protection requirement for code signing keys, CA/Browser Forum
  Baseline Requirements §6.2.7.4.1:
  <https://cabforum.org/working-groups/code-signing/requirements/>
