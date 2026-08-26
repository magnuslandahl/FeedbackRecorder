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

$wanted = @('Get-Prop', 'Get-BmpLuma', 'Invoke-NativeCapture', 'Format-Invariant', 'Wait-ForStableFile', 'Get-MediaDuration')
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
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("orr-tests-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
    Write-Host "OBSReviewRecorder - helper tests" -ForegroundColor White
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

Write-Host ""
$summary = "$script:Passed passed, $script:Failed failed"
if ($script:Skipped -gt 0) { $summary += ", $script:Skipped skipped" }
if ($script:Failed -gt 0) {
    Write-Host $summary -ForegroundColor Red
    exit 1
}
Write-Host $summary -ForegroundColor Green
exit 0
