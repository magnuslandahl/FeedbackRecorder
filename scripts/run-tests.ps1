<#
.SYNOPSIS
    Unit tests for the pure helper functions in review-recorder.ps1.

.DESCRIPTION
    These cover the helpers behind failures that produced plausible-looking but
    wrong output rather than an obvious error, because those are the ones that
    are expensive to notice: a review is only discovered to be broken after it
    has already been recorded, and by then the moment is gone.

    The tests load the functions straight out of review-recorder.ps1 via the
    PowerShell parser, so there is no second copy to keep in sync and running
    the script under test has no side effects.

    Run on both supported hosts before committing:
        powershell.exe -NoProfile -File scripts\run-tests.ps1   # Windows PowerShell 5.1
        pwsh          -NoProfile -File scripts\run-tests.ps1   # PowerShell 7+

.NOTES
    Exit code 0 = all passed, 1 = at least one failure.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $here 'review-recorder.ps1'
if (-not (Test-Path -LiteralPath $target)) {
    Write-Host "Cannot find $target" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# Load the functions under test without executing the script
# ---------------------------------------------------------------------------
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($target, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors -and $parseErrors.Count -gt 0) {
    foreach ($pe in $parseErrors) { Write-Host "PARSE ERROR line $($pe.Extent.StartLineNumber): $($pe.Message)" -ForegroundColor Red }
    exit 1
}

$wanted = @('Get-Prop', 'Get-BmpLuma', 'Invoke-NativeCapture', 'Format-Invariant', 'Wait-ForStableFile', 'Get-MediaDuration', 'Format-Timecode', 'Get-ReviewTimeline', 'ConvertFrom-ObsWindowItem', 'Find-ObsWindowMatch', 'Test-ObsDialogTitle', 'Get-SelfInvocation', 'Test-ObsOutputActive', 'Wait-ObsOutputsIdle')
$found = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) |
    Where-Object { $wanted -contains $_.Name }
foreach ($fn in $found) { . ([scriptblock]::Create($fn.Extent.Text)) }

$missing = $wanted | Where-Object { $n = $_; -not ($found | Where-Object { $_.Name -eq $n }) }
if ($missing) {
    Write-Host "Functions missing from review-recorder.ps1: $($missing -join ', ')" -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# Tiny harness
# ---------------------------------------------------------------------------
$script:Passed = 0
$script:Failed = 0
$script:Skipped = 0

function Test-Case {
    param([string]$Name, [bool]$Condition, [string]$Detail = '')
    if ($Condition) {
        $script:Passed++
        Write-Host "  PASS  $Name" -ForegroundColor Green
    }
    else {
        $script:Failed++
        Write-Host "  FAIL  $Name$(if ($Detail) { " -- $Detail" })" -ForegroundColor Red
    }
}

function Skip-Case {
    param([string]$Name, [string]$Why)
    $script:Skipped++
    Write-Host "  SKIP  $Name -- $Why" -ForegroundColor DarkGray
}

function Write-Group { param([string]$Title) Write-Host "`n$Title" -ForegroundColor Cyan }

function New-TestBmp {
    <#
      Build an uncompressed 24-bpp BMP so brightness detection can be tested
      without depending on OBS or a screenshot fixture.
      -Uniform paints every pixel the same value (a blank capture).
      Otherwise half the pixels are $Low and half $High (UI-like contrast).
    #>
    param(
        [int]$Width = 64,
        [int]$Height = 64,
        [int]$Low = 0,
        [int]$High = 255,
        [switch]$Uniform
    )
    $rowSize = [int]([Math]::Floor((24 * $Width + 31) / 32) * 4)
    $pixelBytes = $rowSize * $Height
    $size = 54 + $pixelBytes
    $bytes = New-Object byte[] $size

    $bytes[0] = 0x42; $bytes[1] = 0x4D                                    # 'BM'
    [BitConverter]::GetBytes([uint32]$size).CopyTo($bytes, 2)
    [BitConverter]::GetBytes([uint32]54).CopyTo($bytes, 10)               # pixel offset
    [BitConverter]::GetBytes([uint32]40).CopyTo($bytes, 14)               # DIB header size
    [BitConverter]::GetBytes([int32]$Width).CopyTo($bytes, 18)
    [BitConverter]::GetBytes([int32]$Height).CopyTo($bytes, 22)
    [BitConverter]::GetBytes([uint16]1).CopyTo($bytes, 26)                # planes
    [BitConverter]::GetBytes([uint16]24).CopyTo($bytes, 28)               # bpp
    [BitConverter]::GetBytes([uint32]0).CopyTo($bytes, 30)                # BI_RGB

    for ($y = 0; $y -lt $Height; $y++) {
        $rowStart = 54 + ($y * $rowSize)
        for ($x = 0; $x -lt $Width; $x++) {
            $v = if ($Uniform) { $Low } elseif ((($x + $y) % 2) -eq 0) { $Low } else { $High }
            $i = $rowStart + ($x * 3)
            $bytes[$i] = [byte]$v; $bytes[$i + 1] = [byte]$v; $bytes[$i + 2] = [byte]$v
        }
    }
    return $bytes
}

$ffprobe = Get-Command 'ffprobe' -ErrorAction SilentlyContinue
$ffmpeg = Get-Command 'ffmpeg' -ErrorAction SilentlyContinue
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("feedback-recorder-tests-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
    Write-Host "FeedbackRecorder - legacy CLI helper tests" -ForegroundColor White
    Write-Host "  host: PowerShell $($PSVersionTable.PSVersion)"
    Write-Host "  under test: $target"

    # -----------------------------------------------------------------------
    Write-Group '[Invoke-NativeCapture] native stderr must never abort the run'
    # Regression: ffmpeg writes an informational line to stderr, PowerShell turns
    # native stderr into ErrorRecords, and $ErrorActionPreference = 'Stop' then
    # kills ffmpeg mid-write. The result was a truncated file with a valid header.
    $threw = $false
    $r = $null
    try { $r = Invoke-NativeCapture -Exe 'cmd.exe' -Arguments @('/c', 'echo partial file 1>&2 & exit /b 0') }
    catch { $threw = $true }
    Test-Case 'stderr does not throw' (-not $threw) 'a stderr line raised a terminating error'
    Test-Case 'success exit code reported' ($null -ne $r -and $r.ExitCode -eq 0) "got $(if ($r) { $r.ExitCode } else { 'null' })"
    Test-Case 'stderr text is preserved' ($null -ne $r -and $r.StdErr -match 'partial file') "got '$(if ($r) { $r.StdErr })'"

    $threw = $false; $r = $null
    try { $r = Invoke-NativeCapture -Exe 'cmd.exe' -Arguments @('/c', 'echo boom 1>&2 & exit /b 3') }
    catch { $threw = $true }
    Test-Case 'failure is returned, not thrown' (-not $threw) 'a non-zero exit raised a terminating error'
    Test-Case 'failure exit code reported' ($null -ne $r -and $r.ExitCode -eq 3) "got $(if ($r) { $r.ExitCode } else { 'null' })"

    $r = Invoke-NativeCapture -Exe 'cmd.exe' -Arguments @('/c', 'echo hello')
    Test-Case 'stdout is captured' ($r.StdOut -match 'hello') "got '$($r.StdOut)'"

    $threw = $false; $r = $null
    try { $r = Invoke-NativeCapture -Exe 'orr-no-such-executable' -Arguments @('-x') }
    catch { $threw = $true }
    Test-Case 'missing executable degrades' (-not $threw) 'a missing executable raised a terminating error'
    Test-Case 'missing executable is non-zero' ($null -ne $r -and $r.ExitCode -ne 0) "got $(if ($r) { $r.ExitCode } else { 'null' })"

    # -----------------------------------------------------------------------
    Write-Group '[Format-Invariant] ffmpeg arguments must not follow the operator locale'
    $prevCulture = [System.Threading.Thread]::CurrentThread.CurrentCulture
    try {
        [System.Threading.Thread]::CurrentThread.CurrentCulture = New-Object System.Globalization.CultureInfo 'sv-SE'
        Test-Case 'decimal uses a dot under sv-SE' ((Format-Invariant 2.5) -eq '2.5') "got '$(Format-Invariant 2.5)'"
        Test-Case 'whole numbers stay clean' ((Format-Invariant 2) -eq '2') "got '$(Format-Invariant 2)'"
    }
    finally { [System.Threading.Thread]::CurrentThread.CurrentCulture = $prevCulture }

    # -----------------------------------------------------------------------
    Write-Group '[Wait-ForStableFile] a still-growing recording must not be processed'
    $growing = Join-Path $tempRoot 'growing.bin'
    Set-Content -LiteralPath $growing -Value 'seed' -NoNewline
    $job = Start-Job -ScriptBlock {
        param($p)
        1..40 | ForEach-Object {
            Add-Content -LiteralPath $p -Value ('y' * 4096) -NoNewline
            Start-Sleep -Milliseconds 150
        }
    } -ArgumentList $growing
    try {
        $stable = Wait-ForStableFile -Path $growing -TimeoutSeconds 3 -QuietMilliseconds 1000
        Test-Case 'growing file reported unstable' (-not $stable) 'returned true while the file was still growing'
    }
    finally {
        Stop-Job $job -ErrorAction SilentlyContinue
        Remove-Job $job -Force -ErrorAction SilentlyContinue
    }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $stable = Wait-ForStableFile -Path $growing -TimeoutSeconds 15 -QuietMilliseconds 1000
    $sw.Stop()
    Test-Case 'settled file reported stable' $stable 'returned false for a file that stopped growing'
    Test-Case 'waits out the quiet period' ($sw.Elapsed.TotalMilliseconds -ge 900) "returned after only $([int]$sw.Elapsed.TotalMilliseconds)ms"

    $stable = Wait-ForStableFile -Path (Join-Path $tempRoot 'never-created.bin') -TimeoutSeconds 2 -QuietMilliseconds 500
    Test-Case 'absent file reported unstable' (-not $stable) 'returned true for a file that never appeared'

    # -----------------------------------------------------------------------
    Write-Group '[Get-BmpLuma] a blank capture must be distinguishable from a dark theme'
    $blank = Get-BmpLuma -Bytes (New-TestBmp -Uniform -Low 0)
    Test-Case 'black frame parsed' ($null -ne $blank) 'parser returned null'
    if ($blank) {
        Test-Case 'black frame has no range' ($blank.Range -eq 0) "range $($blank.Range)"
        Test-Case 'black frame mean is 0' ($blank.Mean -eq 0) "mean $($blank.Mean)"
    }

    # A dark IDE: low mean, but high contrast from the text. Must not be called blank.
    $darkTheme = Get-BmpLuma -Bytes (New-TestBmp -Low 10 -High 235)
    Test-Case 'dark theme parsed' ($null -ne $darkTheme) 'parser returned null'
    if ($darkTheme) {
        Test-Case 'dark theme keeps a wide range' ($darkTheme.Range -gt 200) "range $($darkTheme.Range)"
        Test-Case 'dark theme is not mistaken for blank' ($darkTheme.Range -ge 8) "range $($darkTheme.Range) would trip the blank threshold"
    }

    $uniformGrey = Get-BmpLuma -Bytes (New-TestBmp -Uniform -Low 128)
    if ($uniformGrey) {
        Test-Case 'flat grey has no range' ($uniformGrey.Range -eq 0) "range $($uniformGrey.Range)"
        Test-Case 'flat grey mean is mid' ($uniformGrey.Mean -gt 120 -and $uniformGrey.Mean -lt 136) "mean $($uniformGrey.Mean)"
    }

    $dims = Get-BmpLuma -Bytes (New-TestBmp -Width 32 -Height 16)
    if ($dims) {
        Test-Case 'width read from header' ($dims.Width -eq 32) "got $($dims.Width)"
        Test-Case 'height read from header' ($dims.Height -eq 16) "got $($dims.Height)"
    }

    Test-Case 'null input rejected' ($null -eq (Get-BmpLuma -Bytes $null)) 'expected null'
    Test-Case 'truncated input rejected' ($null -eq (Get-BmpLuma -Bytes ([byte[]](1, 2, 3)))) 'expected null'
    $notBmp = New-Object byte[] 128
    Test-Case 'non-BMP input rejected' ($null -eq (Get-BmpLuma -Bytes $notBmp)) 'expected null for a missing BM signature'

    # -----------------------------------------------------------------------
    Write-Group '[Get-Prop] optional WebSocket fields must be safe under StrictMode'
    $obj = [pscustomobject]@{ present = 'yes'; nulled = $null }
    Test-Case 'existing property returned' ((Get-Prop $obj 'present') -eq 'yes') 'wrong value'
    Test-Case 'absent property falls back' ((Get-Prop $obj 'absent' 'fallback') -eq 'fallback') 'wrong fallback'
    Test-Case 'null property falls back' ((Get-Prop $obj 'nulled' 'fallback') -eq 'fallback') 'null was not replaced'
    Test-Case 'null object falls back' ((Get-Prop $null 'anything' 'fallback') -eq 'fallback') 'null object not handled'
    Test-Case 'absent property defaults to null' ($null -eq (Get-Prop $obj 'absent')) 'expected null'

    # -----------------------------------------------------------------------
    Write-Group '[Format-Timecode] readable timestamps'
    Test-Case 'zero' ((Format-Timecode 0) -eq '00:00') "got '$(Format-Timecode 0)'"
    Test-Case 'under a minute' ((Format-Timecode 7.7) -eq '00:07') "got '$(Format-Timecode 7.7)'"
    Test-Case 'minutes and seconds' ((Format-Timecode 65) -eq '01:05') "got '$(Format-Timecode 65)'"
    Test-Case 'over an hour includes hours' ((Format-Timecode 3661) -eq '01:01:01') "got '$(Format-Timecode 3661)'"
    Test-Case 'negative clamped' ((Format-Timecode -5) -eq '00:00') "got '$(Format-Timecode -5)'"

    # -----------------------------------------------------------------------
    Write-Group '[Get-ReviewTimeline] speech must resolve to the screen it describes'
    # Without this an agent gets a wall of text beside an unordered pile of
    # images, so "this button is wrong" cannot be tied to a screen.
    function New-TimelineFixture {
        param([object[]]$Segments, [int]$FrameCount = 5, [switch]$NoTranscript)
        $dir = Join-Path $tempRoot ("tl-" + [Guid]::NewGuid().ToString('N').Substring(0, 6))
        $kf = Join-Path $dir 'keyframes'
        New-Item -ItemType Directory -Path $kf -Force | Out-Null
        for ($i = 1; $i -le $FrameCount; $i++) {
            Set-Content -LiteralPath (Join-Path $kf ('frame-{0:d6}.jpg' -f $i)) -Value 'x' -NoNewline
        }
        if (-not $NoTranscript) {
            $payload = [pscustomobject]@{ segments = $Segments }
            $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $dir 'transcript.json') -Encoding UTF8
        }
        return [pscustomobject]@{
            Dir    = $dir
            Frames = @(Get-ChildItem -Path $kf -Filter 'frame-*.jpg' -File | Sort-Object Name)
        }
    }

    # Frames sit at 0,2,4,6,8s. A sentence spoken from 3.54 to 7.70 begins while
    # the frame sampled at 2s is still the most recent view of the screen.
    $fx = New-TimelineFixture -Segments @([pscustomobject]@{ id = 1; start = 3.54; end = 7.70; text = 'Det har knappen ar fel.' })
    $tl = @(Get-ReviewTimeline -RunDir $fx.Dir -KeyframeFiles $fx.Frames -IntervalSeconds 2)
    Test-Case 'one row per segment' ($tl.Count -eq 1) "got $($tl.Count)"
    if ($tl.Count -eq 1) {
        $names = @($tl[0].Frames | ForEach-Object { $_.Name })
        Test-Case 'span starts at the frame showing when speech began' ($names.Count -eq 3 -and $names[0] -eq 'frame-000002.jpg' -and $names[2] -eq 'frame-000004.jpg') "got $($names -join ', ')"
        Test-Case 'text preserved' ($tl[0].Text -eq 'Det har knappen ar fel.') "got '$($tl[0].Text)'"
        Test-Case 'frame time is (k-1)*interval' (@($tl[0].Frames)[0].Time -eq 2) "got $(@($tl[0].Frames)[0].Time)"
    }

    # A short sentence can fall entirely between two keyframes. The relevant
    # screen is the last one captured before the reviewer started speaking.
    $fx = New-TimelineFixture -Segments @([pscustomobject]@{ id = 1; start = 2.4; end = 3.1; text = 'Kort.' })
    $tl = @(Get-ReviewTimeline -RunDir $fx.Dir -KeyframeFiles $fx.Frames -IntervalSeconds 2)
    if ($tl.Count -eq 1) {
        $names = @($tl[0].Frames | ForEach-Object { $_.Name })
        Test-Case 'gap falls back to preceding frame' ($names.Count -eq 1 -and $names[0] -eq 'frame-000002.jpg') "got $($names -join ', ')"
    }
    else { Test-Case 'gap falls back to preceding frame' $false "got $($tl.Count) rows" }

    # Speech starting before the first keyframe must still resolve.
    $fx = New-TimelineFixture -Segments @([pscustomobject]@{ id = 1; start = 0; end = 0.5; text = 'Direkt.' })
    $tl = @(Get-ReviewTimeline -RunDir $fx.Dir -KeyframeFiles $fx.Frames -IntervalSeconds 2)
    if ($tl.Count -eq 1) {
        Test-Case 'segment at t=0 matches first frame' (@($tl[0].Frames)[0].Name -eq 'frame-000001.jpg') "got $(@($tl[0].Frames)[0].Name)"
    }
    else { Test-Case 'segment at t=0 matches first frame' $false "got $($tl.Count) rows" }

    # Whisper can time a segment past the last extracted frame; clamping keeps
    # the row pointing at a real screenshot instead of throwing.
    $fx = New-TimelineFixture -Segments @([pscustomobject]@{ id = 1; start = 30; end = 40; text = 'Efter slutet.' })
    $tl = @(Get-ReviewTimeline -RunDir $fx.Dir -KeyframeFiles $fx.Frames -IntervalSeconds 2)
    if ($tl.Count -eq 1) {
        $names = @($tl[0].Frames | ForEach-Object { $_.Name })
        Test-Case 'segment past the end clamps to last frame' ($names.Count -eq 1 -and $names[0] -eq 'frame-000005.jpg') "got $($names -join ', ')"
    }
    else { Test-Case 'segment past the end clamps to last frame' $false "got $($tl.Count) rows" }

    $fx = New-TimelineFixture -Segments @(
        [pscustomobject]@{ id = 1; start = 0.0; end = 1.0; text = 'Ett.' },
        [pscustomobject]@{ id = 2; start = 4.2; end = 5.0; text = 'Tva.' },
        [pscustomobject]@{ id = 3; start = 8.1; end = 9.0; text = 'Tre.' }
    )
    $tl = @(Get-ReviewTimeline -RunDir $fx.Dir -KeyframeFiles $fx.Frames -IntervalSeconds 2)
    Test-Case 'multiple segments preserved in order' ($tl.Count -eq 3 -and $tl[0].Text -eq 'Ett.' -and $tl[2].Text -eq 'Tre.') "got $($tl.Count) rows"

    # A different interval must shift the mapping, not silently assume 2s.
    $fx = New-TimelineFixture -Segments @([pscustomobject]@{ id = 1; start = 9.5; end = 10.5; text = 'Fem.' }) -FrameCount 5
    $tl = @(Get-ReviewTimeline -RunDir $fx.Dir -KeyframeFiles $fx.Frames -IntervalSeconds 5)
    if ($tl.Count -eq 1) {
        $names = @($tl[0].Frames | ForEach-Object { $_.Name })
        Test-Case 'interval of 5s maps to frames 2-3' ($names.Count -eq 2 -and $names[0] -eq 'frame-000002.jpg' -and $names[1] -eq 'frame-000003.jpg') "got $($names -join ', ')"
    }
    else { Test-Case 'interval of 5s maps to frames 2-3' $false "got $($tl.Count) rows" }

    $fx = New-TimelineFixture -Segments @() -NoTranscript
    $tl = @(Get-ReviewTimeline -RunDir $fx.Dir -KeyframeFiles $fx.Frames -IntervalSeconds 2)
    Test-Case 'no transcript yields no timeline' ($tl.Count -eq 0) "got $($tl.Count) rows"

    $fx = New-TimelineFixture -Segments @([pscustomobject]@{ id = 1; start = 1; end = 2; text = 'Utan bilder.' }) -FrameCount 0
    $tl = @(Get-ReviewTimeline -RunDir $fx.Dir -KeyframeFiles $fx.Frames -IntervalSeconds 2)
    Test-Case 'transcript without keyframes still lists speech' ($tl.Count -eq 1 -and @($tl[0].Frames).Count -eq 0) "got $($tl.Count) rows"

    $corrupt = Join-Path $tempRoot 'tl-corrupt'
    New-Item -ItemType Directory -Path $corrupt -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $corrupt 'transcript.json') -Value '{ not valid json' -NoNewline
    $tl = @(Get-ReviewTimeline -RunDir $corrupt -KeyframeFiles @() -IntervalSeconds 2)
    Test-Case 'corrupt transcript degrades quietly' ($tl.Count -eq 0) "got $($tl.Count) rows"

    # -----------------------------------------------------------------------
    Write-Group '[ConvertFrom-ObsWindowItem] OBS window labels must be split correctly'
    $w = ConvertFrom-ObsWindowItem -ItemName '[chrome.exe]: Some page - Chrome' -ItemValue 'Some page - Chrome:Chrome_WidgetWin_1:chrome.exe'
    Test-Case 'process taken from the bracket' ($w.Process -eq 'chrome.exe') "got '$($w.Process)'"
    Test-Case 'title taken after the colon' ($w.Title -eq 'Some page - Chrome') "got '$($w.Title)'"
    Test-Case 'value passed through verbatim' ($w.Value -eq 'Some page - Chrome:Chrome_WidgetWin_1:chrome.exe') "got '$($w.Value)'"

    # OBS escapes ':' in a title as '#3A', so a title containing a colon still
    # has to survive being split back out of the label.
    $w = ConvertFrom-ObsWindowItem -ItemName '[ms-teams.exe]: Chat | A: B | Teams' -ItemValue 'Chat | A#3A B | Teams:TeamsWebView:ms-teams.exe'
    Test-Case 'colon inside a title is kept' ($w.Title -eq 'Chat | A: B | Teams') "got '$($w.Title)'"
    Test-Case 'process still resolved' ($w.Process -eq 'ms-teams.exe') "got '$($w.Process)'"

    $w = ConvertFrom-ObsWindowItem -ItemName 'Bare title' -ItemValue 'Bare title:SomeClass:app.exe'
    Test-Case 'unbracketed label falls back to the value' ($w.Process -eq 'app.exe' -and $w.Title -eq 'Bare title') "got '$($w.Process)' / '$($w.Title)'"

    # -----------------------------------------------------------------------
    Write-Group '[Find-ObsWindowMatch] the wrong window is only noticed after the review'
    $sample = @(
        (ConvertFrom-ObsWindowItem -ItemName '[github.exe]: GitHub Copilot' -ItemValue 'GitHub Copilot:Tauri Window:github.exe'),
        (ConvertFrom-ObsWindowItem -ItemName '[msedge.exe]: Pull request 17395 - Microsoft Edge' -ItemValue 'x:y:msedge.exe'),
        (ConvertFrom-ObsWindowItem -ItemName '[ms-teams.exe]: Chat - Microsoft Teams' -ItemValue 'x:y:ms-teams.exe'),
        (ConvertFrom-ObsWindowItem -ItemName '[notepad++.exe]: foo.txt - Notepad++' -ItemValue 'x:y:notepad++.exe')
    )

    $r = Find-ObsWindowMatch -Windows $sample -Pattern 'GitHub Copilot'
    Test-Case 'exact title matches' ($r.Status -eq 'ok' -and $r.Match.Process -eq 'github.exe') "got $($r.Status)"

    $r = Find-ObsWindowMatch -Windows $sample -Pattern 'github copilot'
    Test-Case 'matching ignores case' ($r.Status -eq 'ok' -and $r.Match.Process -eq 'github.exe') "got $($r.Status)"

    $r = Find-ObsWindowMatch -Windows $sample -Pattern 'notepad++'
    Test-Case 'process name matches without .exe' ($r.Status -eq 'ok' -and $r.Match.Process -eq 'notepad++.exe') "got $($r.Status)"

    $r = Find-ObsWindowMatch -Windows $sample -Pattern 'msedge.exe'
    Test-Case 'process name matches with .exe' ($r.Status -eq 'ok' -and $r.Match.Process -eq 'msedge.exe') "got $($r.Status)"

    $r = Find-ObsWindowMatch -Windows $sample -Pattern 'Pull request'
    Test-Case 'partial title matches' ($r.Status -eq 'ok' -and $r.Match.Process -eq 'msedge.exe') "got $($r.Status)"

    # 'Microsoft' appears in two titles. Guessing would record the wrong app.
    $r = Find-ObsWindowMatch -Windows $sample -Pattern 'Microsoft'
    Test-Case 'ambiguous pattern is refused' ($r.Status -eq 'ambiguous') "got $($r.Status)"
    Test-Case 'ambiguous pattern reports candidates' (@($r.Candidates).Count -eq 2) "got $(@($r.Candidates).Count)"

    $r = Find-ObsWindowMatch -Windows $sample -Pattern 'nothing here'
    Test-Case 'unknown pattern reports none' ($r.Status -eq 'none') "got $($r.Status)"

    $r = Find-ObsWindowMatch -Windows $sample -Pattern ''
    Test-Case 'empty pattern reports none' ($r.Status -eq 'none') "got $($r.Status)"

    $r = Find-ObsWindowMatch -Windows @() -Pattern 'anything'
    Test-Case 'empty window list reports none' ($r.Status -eq 'none') "got $($r.Status)"

    # An exact title must win over a substring hit in another window's title.
    $tricky = @(
        (ConvertFrom-ObsWindowItem -ItemName '[a.exe]: Mail' -ItemValue 'x:y:a.exe'),
        (ConvertFrom-ObsWindowItem -ItemName '[b.exe]: Mailbox settings' -ItemValue 'x:y:b.exe')
    )
    $r = Find-ObsWindowMatch -Windows $tricky -Pattern 'Mail'
    Test-Case 'exact title beats a substring elsewhere' ($r.Status -eq 'ok' -and $r.Match.Process -eq 'a.exe') "got $($r.Status) / $($r.Match.Process)"

    # -----------------------------------------------------------------------
    Write-Group '[Test-ObsDialogTitle] a modal dialog must not look like a slow start'
    # OBS opens these before loading plugins, so the WebSocket server never
    # starts. Observed for real: --disable-shutdown-check did not reliably
    # suppress the crash dialog, so detection cannot be skipped.
    Test-Case 'crash dialog detected' (Test-ObsDialogTitle 'OBS Studio Crash Detected') 'not detected'
    Test-Case 'safe mode dialog detected' (Test-ObsDialogTitle 'OBS Studio - Safe Mode') 'not detected'
    Test-Case 'detection ignores case' (Test-ObsDialogTitle 'obs studio crash detected') 'not detected'
    Test-Case 'auto-configuration wizard detected' (Test-ObsDialogTitle 'Auto-Configuration Wizard') 'not detected'
    Test-Case 'normal window is not a dialog' (-not (Test-ObsDialogTitle 'OBS 32.2.2 - Profile: Untitled - Scenes: Untitled')) 'false positive'
    Test-Case 'empty title is not a dialog' (-not (Test-ObsDialogTitle '')) 'false positive'
    Test-Case 'null title is not a dialog' (-not (Test-ObsDialogTitle $null)) 'false positive'

    # -----------------------------------------------------------------------
    Write-Group '[Get-MediaDuration] duration must survive a comma-decimal locale'
    if (-not $ffprobe -or -not $ffmpeg) {
        Skip-Case 'duration parsing' 'ffmpeg/ffprobe not on PATH'
    }
    else {
        $probeCfg = [pscustomobject]@{ ffmpeg = [pscustomobject]@{ ffprobePath = 'ffprobe' } }
        $wav = Join-Path $tempRoot 'tone.wav'
        $gen = Invoke-NativeCapture -Exe 'ffmpeg' -Arguments @(
            '-hide_banner', '-loglevel', 'error', '-y',
            '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
            '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '--', $wav)
        if ($gen.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $wav)) {
            Skip-Case 'duration parsing' "could not generate a fixture (ffmpeg exit $($gen.ExitCode))"
        }
        else {
            $prevCulture = [System.Threading.Thread]::CurrentThread.CurrentCulture
            try {
                [System.Threading.Thread]::CurrentThread.CurrentCulture = New-Object System.Globalization.CultureInfo 'sv-SE'
                $d = Get-MediaDuration -Config $probeCfg -Path $wav
                Test-Case 'duration parsed under sv-SE' ($null -ne $d -and $d -gt 2.5 -and $d -lt 3.5) "got '$d' for a 3s file"
            }
            finally { [System.Threading.Thread]::CurrentThread.CurrentCulture = $prevCulture }
        }
        Test-Case 'missing file returns null' ($null -eq (Get-MediaDuration -Config $probeCfg -Path (Join-Path $tempRoot 'absent.wav'))) 'expected null'

        $garbage = Join-Path $tempRoot 'garbage.wav'
        Set-Content -LiteralPath $garbage -Value 'this is not audio' -NoNewline
        Test-Case 'unreadable file returns null' ($null -eq (Get-MediaDuration -Config $probeCfg -Path $garbage)) 'expected null for a non-media file'
    }
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Group 'Get-SelfInvocation'
$selfScript = 'C:\Repo\Tool\scripts\review-recorder.ps1'
$selfRoot   = 'C:\Repo\Tool'
Test-Case 'inside the repo root prints the short relative form' `
    ((Get-SelfInvocation -ScriptPath $selfScript -RepoRoot $selfRoot -CurrentDirectory $selfRoot) -eq '.\scripts\review-recorder.ps1') `
    'expected the relative form when already standing in the repo'
Test-Case 'trailing separator still counts as the repo root' `
    ((Get-SelfInvocation -ScriptPath $selfScript -RepoRoot $selfRoot -CurrentDirectory 'C:\Repo\Tool\') -eq '.\scripts\review-recorder.ps1') `
    'a trailing backslash must not change the answer'
Test-Case 'case differences still count as the repo root' `
    ((Get-SelfInvocation -ScriptPath $selfScript -RepoRoot $selfRoot -CurrentDirectory 'c:\repo\TOOL') -eq '.\scripts\review-recorder.ps1') `
    'Windows paths are case-insensitive'
Test-Case 'elsewhere prints a runnable absolute invocation' `
    ((Get-SelfInvocation -ScriptPath $selfScript -RepoRoot $selfRoot -CurrentDirectory 'C:\Repo\OtherApp') -eq "& '$selfScript'") `
    'outside the repo a relative path would not resolve'
Test-Case 'a subdirectory of the repo is still outside the root' `
    ((Get-SelfInvocation -ScriptPath $selfScript -RepoRoot $selfRoot -CurrentDirectory 'C:\Repo\Tool\scripts') -eq "& '$selfScript'") `
    '.\scripts\... only resolves from the root itself'
Test-Case 'unknown script path falls back instead of emitting an empty command' `
    ((Get-SelfInvocation -ScriptPath '' -RepoRoot $selfRoot -CurrentDirectory 'C:\Repo\OtherApp') -eq '.\scripts\review-recorder.ps1') `
    'an empty path would produce an uncopyable hint'

Write-Group 'Closing OBS without hitting its confirmation dialog'
Test-Case 'a status response with no output reported counts as idle' `
    (-not (Test-ObsOutputActive ([pscustomobject]@{ outputPaused = $false }))) `
    'a missing outputActive field must not be read as running'
Test-Case 'an active output is detected' `
    (Test-ObsOutputActive ([pscustomobject]@{ outputActive = $true })) `
    'outputActive true means OBS would prompt on close'
Test-Case 'no status at all counts as idle' `
    (-not (Test-ObsOutputActive $null)) `
    'a null response must not stall the close'

# Wait-ObsOutputsIdle talks to OBS through Invoke-ObsRequest, so the stub below
# stands in for a live OBS and lets the polling be tested in milliseconds.
$script:ObsPolls = 0
$script:ObsActiveUntilPoll = 0
$script:ObsThrows = $false
function Invoke-ObsRequest {
    param($Connection, [string]$RequestType, $RequestData)
    if ($script:ObsThrows) { throw 'websocket closed' }
    if ($RequestType -eq 'GetRecordStatus') { $script:ObsPolls++ }
    $active = $script:ObsPolls -le $script:ObsActiveUntilPoll
    return [pscustomobject]@{ responseData = [pscustomobject]@{ outputActive = $active } }
}

Test-Case 'no connection means there is nothing to wait for' `
    (Wait-ObsOutputsIdle -Connection $null -TimeoutSeconds 5) `
    'the caller should close OBS rather than block on a connection it never had'

$script:ObsPolls = 0; $script:ObsActiveUntilPoll = 0
Test-Case 'an already idle OBS returns at once' `
    (Wait-ObsOutputsIdle -Connection 'stub' -TimeoutSeconds 5) `
    'idle on the first poll must not wait'

$script:ObsPolls = 0; $script:ObsActiveUntilPoll = 2
Test-Case 'a recording that is still finalizing is waited out' `
    (Wait-ObsOutputsIdle -Connection 'stub' -TimeoutSeconds 5) `
    'StopRecord returns before the file is closed, so the first poll can still say active'
Test-Case 'waiting polls until the output reports idle' `
    ($script:ObsPolls -ge 3) `
    "expected at least 3 polls, saw $script:ObsPolls"

$script:ObsPolls = 0; $script:ObsActiveUntilPoll = [int]::MaxValue
Test-Case 'an output that never stops gives up instead of hanging' `
    (-not (Wait-ObsOutputsIdle -Connection 'stub' -TimeoutSeconds 0)) `
    'a permanently active output (virtual camera, stream) must not block the run'

$script:ObsThrows = $true
Test-Case 'an unreadable OBS state does not block the close' `
    (Wait-ObsOutputsIdle -Connection 'stub' -TimeoutSeconds 5) `
    'failing to ask is no worse than never having asked'
$script:ObsThrows = $false

Write-Host ""
$summary = "$script:Passed passed, $script:Failed failed"
if ($script:Skipped -gt 0) { $summary += ", $script:Skipped skipped" }
if ($script:Failed -gt 0) {
    Write-Host $summary -ForegroundColor Red
    exit 1
}
Write-Host $summary -ForegroundColor Green
exit 0
