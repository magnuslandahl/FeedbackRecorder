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

### What would change

`app/build/entitlements.mac.plist` is **already correct** — `allow-jit`,
`allow-unsigned-executable-memory`, `disable-library-validation` (needed because
`whisper-cli` is a separate binary) and `device.audio-input`.

In `app/electron-builder.yml`:

```yaml
mac:
  hardenedRuntime: true      # currently false
  notarize: true             # currently false
  # identity: null           # remove this line; the certificate is discovered
  #                          # from CSC_LINK
  # Notarization rejects any unsigned Mach-O binary inside the bundle, and
  # whisper-cli is one. It is an extraResource, so it is not signed by default.
  binaries:
    - vendor/whisper/whisper-cli
```

`build/after-pack.js` should then skip its ad-hoc signing when a real identity is
present, or be deleted — ad-hoc signing over a Developer ID signature would
invalidate it.

Repository secrets for CI:

| Secret | What it is |
| --- | --- |
| `CSC_LINK` | The Developer ID Application `.p12`, base64-encoded |
| `CSC_KEY_PASSWORD` | The password used when exporting that `.p12` |
| `APPLE_API_KEY` | App Store Connect API key (`.p8`), base64-encoded |
| `APPLE_API_KEY_ID` | The key's ID |
| `APPLE_API_ISSUER` | The issuer ID |
| `APPLE_TEAM_ID` | The 10-character team ID |

Use the App Store Connect API key rather than an Apple ID and app-specific
password: it does not expire and needs no two-factor prompt. The `.p8` can only
be downloaded once.

electron-builder handles signing, notarization *and* stapling from there;
stapling is what makes the app open on a machine that is offline. Notarization
needs a Mac, which is free here because macOS runners cost nothing on public
repositories.

Verify a build with:

```bash
spctl --assess --verbose --type exec "FeedbackRecorder.app"   # → source=Notarized Developer ID
xcrun stapler validate "FeedbackRecorder.app"
```

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

## Recommendation

1. **Buy the Apple Developer Program, 99 USD/year.** macOS is currently blocked
   rather than merely warned about, an individual can do it today, and everything
   in this repository is already prepared for it.
2. **For Windows, decide by who holds the account.** With a company, Azure
   Artifact Signing at 9.99 USD/month is the cheapest compliant route. As a
   private individual in Sweden it is not available, and the honest choice is the
   free Microsoft Store channel for people who want a clean install, with the
   GitHub `.exe` and its documented click-through for everyone else.
3. **Do not buy EV**, and treat any advice that says EV clears SmartScreen as
   out of date.

Whatever is decided, keep publishing `SHA256SUMS.txt`. It does nothing for
SmartScreen or Gatekeeper, but it is what lets a careful user — and Homebrew —
verify a download.

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
