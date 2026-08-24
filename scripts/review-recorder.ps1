#Requires -Version 5.1
<#
.SYNOPSIS
    OBSReviewRecorder - record an app review with OBS and build a coding-agent brief.

.DESCRIPTION
    Windows-first PowerShell CLI. Commands:
        doctor   Check prerequisites and show remediation.
        init     Create sample config and local folder structure.
        start    Start OBS recording (WebSocket) or enter manual fallback mode.
        stop     Stop recording, find the latest video, and build the run output.
        brief    Create or regenerate agent-brief.md for a run.
        analyze  Optional: use GitHub Copilot CLI to improve the brief.

    The tool is fail-soft: once a video is identified a run folder and brief are
    always produced, and missing tools are reported clearly in the output.

.EXAMPLE
    .\scripts\review-recorder.ps1 doctor
    .\scripts\review-recorder.ps1 init
    .\scripts\review-recorder.ps1 start
    .\scripts\review-recorder.ps1 stop
    .\scripts\review-recorder.ps1 analyze
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Command = 'help',

    [Parameter(Position = 1)]
    [string]$RunPath,

    [string]$ConfigPath,
    [string]$VideoPath,

    [switch]$Manual,
    [switch]$NoKeyframes,
    [switch]$NoTranscribe,
    [switch]$Force,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
$script:ScriptDir = $PSScriptRoot
$script:RepoRoot  = Split-Path -Parent $PSScriptRoot
$script:StateFile = Join-Path $script:RepoRoot 'runs\.state.json'

function Resolve-RepoPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return $Path }
    if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
    return (Join-Path $script:RepoRoot $Path)
}

# ---------------------------------------------------------------------------
# Console helpers
# ---------------------------------------------------------------------------
function Write-Head { param([string]$Text) Write-Host ""; Write-Host $Text -ForegroundColor Cyan }
function Write-Ok   { param([string]$Text) Write-Host "  [ OK ]  $Text" -ForegroundColor Green }
function Write-Warn2 { param([string]$Text) Write-Host "  [WARN]  $Text" -ForegroundColor Yellow }
function Write-Bad  { param([string]$Text) Write-Host "  [MISS]  $Text" -ForegroundColor Red }
function Write-Info { param([string]$Text) Write-Host "  $Text" -ForegroundColor Gray }
function Write-Step { param([string]$Text) Write-Host "-> $Text" -ForegroundColor Cyan }

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
function Get-DefaultConfig {
    return [ordered]@{
        obs = [ordered]@{
            webSocketUrl       = 'ws://127.0.0.1:4455'
            password           = ''
            recordingDirectory = (Join-Path $env:USERPROFILE 'Videos')
        }
        ffmpeg = [ordered]@{
            ffmpegPath              = 'ffmpeg'
            ffprobePath             = 'ffprobe'
            keyframeIntervalSeconds = 2
            imageQuality            = 2
        }
        transcription = [ordered]@{
            enabled     = $true
            pythonPath  = '.venv\Scripts\python.exe'
            model       = 'small'
            language    = 'sv'
            computeType = 'int8'
            device      = 'cpu'
        }
        copilot = [ordered]@{
            enabled         = $true
            cliPath         = 'copilot'
            model           = 'gpt-5.5'
            reasoningEffort = 'medium'
        }
        output = [ordered]@{
            runsDirectory  = 'runs'
            copyVideoToRun = $false
        }
    }
}

function Merge-ConfigTable {
    param($Base, $Override)
    $result = [ordered]@{}
    foreach ($k in $Base.Keys) { $result[$k] = $Base[$k] }
    if ($null -ne $Override) {
        foreach ($k in $Override.Keys) {
            if ($result.Contains($k) -and ($result[$k] -is [System.Collections.IDictionary]) -and ($Override[$k] -is [System.Collections.IDictionary])) {
                $result[$k] = Merge-ConfigTable $result[$k] $Override[$k]
            }
            else {
                $result[$k] = $Override[$k]
            }
        }
    }
    return $result
}

function ConvertTo-HashtableDeep {
    # Convert a ConvertFrom-Json result (PSCustomObject) into (ordered) hashtables.
    # Works on Windows PowerShell 5.1, which lacks ConvertFrom-Json -AsHashtable.
    param($InputObject)
    if ($null -eq $InputObject) { return $null }
    if ($InputObject -is [System.Collections.IDictionary]) {
        $ht = [ordered]@{}
        foreach ($k in $InputObject.Keys) { $ht[$k] = ConvertTo-HashtableDeep $InputObject[$k] }
        return $ht
    }
    if ($InputObject -is [System.Management.Automation.PSCustomObject]) {
        $ht = [ordered]@{}
        foreach ($p in $InputObject.PSObject.Properties) { $ht[$p.Name] = ConvertTo-HashtableDeep $p.Value }
        return $ht
    }
    if (($InputObject -is [System.Collections.IEnumerable]) -and ($InputObject -isnot [string])) {
        return @($InputObject | ForEach-Object { ConvertTo-HashtableDeep $_ })
    }
    return $InputObject
}

function Get-ConfigPath {
    if ($ConfigPath) { return (Resolve-RepoPath $ConfigPath) }
    return (Join-Path $script:RepoRoot 'config.local.json')
}

function Get-Config {
    $defaults = Get-DefaultConfig
    $path = Get-ConfigPath
    if (Test-Path $path) {
        try {
            $raw = Get-Content -Path $path -Raw -Encoding UTF8
            $loaded = ConvertTo-HashtableDeep ($raw | ConvertFrom-Json)
            return (Merge-ConfigTable $defaults $loaded)
        }
        catch {
            Write-Warn2 "Could not parse $path : $($_.Exception.Message). Using defaults."
            return $defaults
        }
    }
    return $defaults
}

# ---------------------------------------------------------------------------
# Small utilities
# ---------------------------------------------------------------------------
function Test-Tool {
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source } else { return $null }
}

function Get-ObsExecutable {
    $fromPath = Test-Tool 'obs64'
    if ($fromPath) { return $fromPath }
    $candidates = @(
        (Join-Path ${env:ProgramFiles} 'obs-studio\bin\64bit\obs64.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'obs-studio\bin\64bit\obs64.exe')
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    return $null
}

function ConvertTo-JsonFile {
    param($Object, [string]$Path, [int]$Depth = 12)
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    ($Object | ConvertTo-Json -Depth $Depth) | Set-Content -Path $Path -Encoding UTF8
}

# ---------------------------------------------------------------------------
# OBS WebSocket (obs-websocket v5)
# ---------------------------------------------------------------------------
function Get-Sha256Base64 {
    param([string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        return [Convert]::ToBase64String($sha.ComputeHash($bytes))
    }
    finally { $sha.Dispose() }
}

function Send-ObsFrame {
    param($Socket, $Token, $Payload)
    $json = $Payload | ConvertTo-Json -Depth 10 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $segment = [System.ArraySegment[byte]]::new($bytes)
    $Socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $Token).GetAwaiter().GetResult() | Out-Null
}

function Receive-ObsFrame {
    param($Socket, $Token)
    $buffer = [byte[]]::new(16384)
    $sb = [System.Text.StringBuilder]::new()
    do {
        $segment = [System.ArraySegment[byte]]::new($buffer)
        $result = $Socket.ReceiveAsync($segment, $Token).GetAwaiter().GetResult()
        if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
            throw "OBS closed the connection."
        }
        [void]$sb.Append([System.Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count))
    } while (-not $result.EndOfMessage)
    return ($sb.ToString() | ConvertFrom-Json)
}

function Connect-Obs {
    param([string]$Url, [string]$Password, [int]$TimeoutSec = 8)
    $socket = [System.Net.WebSockets.ClientWebSocket]::new()
    $cts = [System.Threading.CancellationTokenSource]::new()
    $cts.CancelAfter([TimeSpan]::FromSeconds($TimeoutSec))
    $token = $cts.Token
    $socket.ConnectAsync([Uri]$Url, $token).GetAwaiter().GetResult() | Out-Null

    $hello = Receive-ObsFrame -Socket $socket -Token $token
    $identify = @{ op = 1; d = @{ rpcVersion = 1 } }
    if ($hello.d.PSObject.Properties.Name -contains 'authentication' -and $hello.d.authentication) {
        $salt = $hello.d.authentication.salt
        $challenge = $hello.d.authentication.challenge
        $secret = Get-Sha256Base64 ($Password + $salt)
        $identify.d.authentication = Get-Sha256Base64 ($secret + $challenge)
    }
    Send-ObsFrame -Socket $socket -Token $token -Payload $identify
    $identified = Receive-ObsFrame -Socket $socket -Token $token
    if ($identified.op -ne 2) { throw "OBS Identify failed (op=$($identified.op))." }
    return [pscustomobject]@{ Socket = $socket; Cts = $cts; Token = $token }
}

function Invoke-ObsRequest {
    param($Connection, [string]$RequestType, $RequestData)
    $requestId = [Guid]::NewGuid().ToString('N')
    $payload = @{ op = 6; d = @{ requestType = $RequestType; requestId = $requestId } }
    if ($null -ne $RequestData) { $payload.d.requestData = $RequestData }
    Send-ObsFrame -Socket $Connection.Socket -Token $Connection.Token -Payload $payload
    while ($true) {
        $resp = Receive-ObsFrame -Socket $Connection.Socket -Token $Connection.Token
        if ($resp.op -eq 7 -and $resp.d.requestId -eq $requestId) { return $resp.d }
    }
}

function Close-Obs {
    param($Connection)
    if (-not $Connection) { return }
    try {
        $Connection.Socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'bye', [System.Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
    }
    catch { }
    finally {
        $Connection.Socket.Dispose()
        $Connection.Cts.Dispose()
    }
}

# ---------------------------------------------------------------------------
# Media pipeline
# ---------------------------------------------------------------------------
function Get-VideoDuration {
    param($Config, [string]$Video)
    try {
        $out = & $Config.ffmpeg.ffprobePath -v error -show_entries format=duration -of csv=p=0 -- $Video 2>$null
        if ($LASTEXITCODE -eq 0 -and $out) { return [double]$out }
    }
    catch { }
    return $null
}

function Export-Keyframes {
    param($Config, [string]$Video, [string]$OutDir)
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $interval = [double]$Config.ffmpeg.keyframeIntervalSeconds
    if ($interval -le 0) { $interval = 2 }
    $fps = "1/$interval"
    $pattern = Join-Path $OutDir 'frame-%06d.jpg'
    & $Config.ffmpeg.ffmpegPath -hide_banner -loglevel error -y -i $Video -vf "fps=$fps" -qscale:v $Config.ffmpeg.imageQuality -- $pattern 2>&1 | Out-Null
    return $LASTEXITCODE
}

function Export-Audio {
    param($Config, [string]$Video, [string]$WavPath)
    & $Config.ffmpeg.ffmpegPath -hide_banner -loglevel error -y -i $Video -vn -ac 1 -ar 16000 -c:a pcm_s16le -- $WavPath 2>&1 | Out-Null
    return $LASTEXITCODE
}

function Invoke-Transcription {
    param($Config, [string]$WavPath, [string]$JsonPath, [string]$TxtPath)
    $python = Resolve-RepoPath $Config.transcription.pythonPath
    $pyScript = Join-Path $script:ScriptDir 'transcribe-whisper.py'
    & $python $pyScript `
        --audio $WavPath `
        --model $Config.transcription.model `
        --language $Config.transcription.language `
        --compute-type $Config.transcription.computeType `
        --device $Config.transcription.device `
        --output-json $JsonPath `
        --output-txt $TxtPath 2>&1 | ForEach-Object { Write-Host $_ }
    return $LASTEXITCODE
}

function Get-LatestVideo {
    param([string]$Directory, $Since)
    if (-not (Test-Path $Directory)) { return $null }
    $exts = @('.mp4', '.mkv', '.mov', '.flv')
    $files = Get-ChildItem -Path $Directory -File -ErrorAction SilentlyContinue |
        Where-Object { $exts -contains $_.Extension.ToLowerInvariant() }
    if (($Since -is [datetime]) -and ($Since -gt [datetime]::MinValue)) {
        $buffer = $Since.AddMinutes(-1)
        $filtered = $files | Where-Object { $_.LastWriteTime -ge $buffer }
        if ($filtered) { $files = $filtered }
    }
    return ($files | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
}

# ---------------------------------------------------------------------------
# Brief generation
# ---------------------------------------------------------------------------
function New-AgentBrief {
    param($RunInfo, [string]$RunDir)

    $briefPath   = Join-Path $RunDir 'agent-brief.md'
    $transcriptFile = Join-Path $RunDir 'transcript.txt'
    $keyframeDir = Join-Path $RunDir 'keyframes'

    $transcript = ''
    if (Test-Path $transcriptFile) {
        $transcript = (Get-Content -Path $transcriptFile -Raw -Encoding UTF8).Trim()
    }

    $keyframeFiles = @()
    if (Test-Path $keyframeDir) {
        $keyframeFiles = Get-ChildItem -Path $keyframeDir -Filter 'frame-*.jpg' -File -ErrorAction SilentlyContinue |
            Sort-Object Name
    }

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine("# Agent brief - app review $($RunInfo.runId)")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("Generated: $($RunInfo.createdAt)")
    [void]$sb.AppendLine("Recording mode: $($RunInfo.mode)")
    [void]$sb.AppendLine("")

    [void]$sb.AppendLine("## Source video")
    [void]$sb.AppendLine("")
    if ($RunInfo.video.found) {
        [void]$sb.AppendLine("- Path: ``$($RunInfo.video.sourcePath)``")
        if ($RunInfo.video.durationSeconds) {
            $ts = [TimeSpan]::FromSeconds([double]$RunInfo.video.durationSeconds)
            [void]$sb.AppendLine("- Duration: {0:hh\:mm\:ss}" -f $ts)
        }
    }
    else {
        [void]$sb.AppendLine("- No video was found. $($RunInfo.video.message)")
    }
    [void]$sb.AppendLine("")

    [void]$sb.AppendLine("## Pipeline status")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("| Step | Status | Details |")
    [void]$sb.AppendLine("| --- | --- | --- |")
    foreach ($step in $RunInfo.steps) {
        $details = ($step.message -replace '\|', '\|')
        [void]$sb.AppendLine("| $($step.name) | $($step.status) | $details |")
    }
    [void]$sb.AppendLine("")

    [void]$sb.AppendLine("## Keyframes")
    [void]$sb.AppendLine("")
    if ($keyframeFiles.Count -gt 0) {
        [void]$sb.AppendLine("$($keyframeFiles.Count) keyframe(s) in ``keyframes\``. First frames:")
        [void]$sb.AppendLine("")
        foreach ($f in ($keyframeFiles | Select-Object -First 12)) {
            [void]$sb.AppendLine("- ![]($('keyframes/' + $f.Name))")
        }
        if ($keyframeFiles.Count -gt 12) {
            [void]$sb.AppendLine("- ... and $($keyframeFiles.Count - 12) more.")
        }
    }
    else {
        [void]$sb.AppendLine("_No keyframes were extracted._")
    }
    [void]$sb.AppendLine("")

    [void]$sb.AppendLine("## Transcript")
    [void]$sb.AppendLine("")
    if ($transcript) {
        [void]$sb.AppendLine($transcript)
    }
    else {
        [void]$sb.AppendLine("_No transcript was produced. See pipeline status above for the reason._")
    }
    [void]$sb.AppendLine("")

    [void]$sb.AppendLine("## Coding-agent prompt")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("Copy everything below into a coding agent (for example GitHub Copilot).")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine('```text')
    [void]$sb.AppendLine("You are a senior engineer. I recorded a review of our application and")
    [void]$sb.AppendLine("captured spoken feedback plus screenshots.")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("Use the transcript and keyframes in this run folder as the source of truth:")
    [void]$sb.AppendLine("  - transcript.txt  (spoken feedback, may be in Swedish)")
    [void]$sb.AppendLine("  - keyframes\      (screenshots, one every $($RunInfo.keyframeIntervalSeconds)s)")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("Do the following:")
    [void]$sb.AppendLine("  1. Summarize the review as a short list of concrete findings.")
    [void]$sb.AppendLine("  2. Turn each finding into an actionable work item (title + acceptance criteria).")
    [void]$sb.AppendLine("  3. Rank the work items by user impact.")
    [void]$sb.AppendLine("  4. For each item, propose where in the codebase the change likely belongs")
    [void]$sb.AppendLine("     and outline an implementation approach.")
    [void]$sb.AppendLine("  5. Flag anything ambiguous that needs clarification before coding.")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("Keep Swedish feedback meaning intact; you may respond in English.")
    [void]$sb.AppendLine('```')
    [void]$sb.AppendLine("")

    Set-Content -Path $briefPath -Value $sb.ToString() -Encoding UTF8
    return $briefPath
}

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
function Save-State { param($State) ConvertTo-JsonFile -Object $State -Path $script:StateFile }
function Get-State {
    if (Test-Path $script:StateFile) {
        try { return (Get-Content $script:StateFile -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
    }
    return $null
}
function Clear-State { if (Test-Path $script:StateFile) { Remove-Item $script:StateFile -Force -ErrorAction SilentlyContinue } }

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
function Invoke-Doctor {
    $config = Get-Config
    $checks = [System.Collections.Generic.List[object]]::new()

    function Add-Check { param($Name, $Status, $Detail, $Fix = '')
        $checks.Add([pscustomobject]@{ name = $Name; status = $Status; detail = $Detail; fix = $Fix }) }

    # PowerShell
    Add-Check 'PowerShell' 'ok' "v$($PSVersionTable.PSVersion)"

    # OBS
    $obs = Get-ObsExecutable
    if ($obs) { Add-Check 'OBS Studio' 'ok' $obs }
    else { Add-Check 'OBS Studio' 'missing' 'Not found' 'winget install OBSProject.OBSStudio' }

    # ffmpeg / ffprobe
    foreach ($tuple in @(@('FFmpeg', $config.ffmpeg.ffmpegPath), @('ffprobe', $config.ffmpeg.ffprobePath))) {
        $src = Test-Tool $tuple[1]
        if ($src) { Add-Check $tuple[0] 'ok' $src }
        else { Add-Check $tuple[0] 'missing' "'$($tuple[1])' not found" 'winget install Gyan.FFmpeg' }
    }

    # Python launcher
    $py = Test-Tool 'py'
    if ($py) { Add-Check 'Python launcher (py)' 'ok' $py }
    else { Add-Check 'Python launcher (py)' 'warn' 'py.exe not found' 'winget install Python.Python.3.12' }

    # venv + faster-whisper
    $venvPython = Resolve-RepoPath $config.transcription.pythonPath
    if (Test-Path $venvPython) {
        Add-Check 'Whisper venv' 'ok' $venvPython
        try {
            & $venvPython -c "import faster_whisper" 2>$null
            if ($LASTEXITCODE -eq 0) { Add-Check 'faster-whisper' 'ok' 'importable' }
            else { Add-Check 'faster-whisper' 'missing' 'not installed in venv' "$venvPython -m pip install faster-whisper" }
        }
        catch { Add-Check 'faster-whisper' 'missing' 'could not run venv python' "$venvPython -m pip install faster-whisper" }
    }
    else {
        Add-Check 'Whisper venv' 'missing' "'$venvPython' not found" 'py -3.12 -m venv .venv; .\.venv\Scripts\python.exe -m pip install faster-whisper'
    }

    # Copilot CLI
    $cop = Test-Tool $config.copilot.cliPath
    if ($cop) { Add-Check 'GitHub Copilot CLI' 'ok' $cop }
    else { Add-Check 'GitHub Copilot CLI' 'warn' 'optional; not found' 'npm install -g @github/copilot' }

    # config
    $cfgPath = Get-ConfigPath
    if (Test-Path $cfgPath) { Add-Check 'config.local.json' 'ok' $cfgPath }
    else { Add-Check 'config.local.json' 'warn' 'not created yet' '.\scripts\review-recorder.ps1 init' }

    if ($Json) {
        $checks | ConvertTo-Json -Depth 6
        $script:ExitCode = 0
        return
    }

    Write-Head 'OBSReviewRecorder - doctor'
    foreach ($c in $checks) {
        switch ($c.status) {
            'ok'      { Write-Ok   ("{0,-22} {1}" -f $c.name, $c.detail) }
            'warn'    { Write-Warn2 ("{0,-22} {1}" -f $c.name, $c.detail) }
            'missing' { Write-Bad  ("{0,-22} {1}" -f $c.name, $c.detail) }
        }
        if ($c.status -ne 'ok' -and $c.fix) { Write-Info "        fix: $($c.fix)" }
    }

    $missingRequired = $checks | Where-Object { $_.status -eq 'missing' -and $_.name -in @('FFmpeg', 'ffprobe') }
    Write-Host ""
    if ($missingRequired) {
        Write-Warn2 'Some media tools are missing. Recording still works; keyframes/transcription will be skipped until installed.'
    }
    else {
        Write-Ok 'Core media tools are present.'
    }
    Write-Info "Manual mode always works even without OBS WebSocket. Use: start -Manual"
    $script:ExitCode = 0
}

function Invoke-Init {
    Write-Head 'OBSReviewRecorder - init'
    $defaults = Get-DefaultConfig

    $samplePath = Join-Path $script:RepoRoot 'config.sample.json'
    ConvertTo-JsonFile -Object $defaults -Path $samplePath -Depth 6
    Write-Ok "Wrote sample config: $samplePath"

    $localPath = Join-Path $script:RepoRoot 'config.local.json'
    if ((Test-Path $localPath) -and -not $Force) {
        Write-Warn2 "Kept existing $localPath (use -Force to overwrite)."
    }
    else {
        ConvertTo-JsonFile -Object $defaults -Path $localPath -Depth 6
        Write-Ok "Wrote local config: $localPath"
    }

    $runsDir = Resolve-RepoPath $defaults.output.runsDirectory
    New-Item -ItemType Directory -Force -Path $runsDir | Out-Null
    Write-Ok "Ensured runs directory: $runsDir"

    Write-Host ""
    Write-Info 'Next steps:'
    Write-Info '  1. Edit config.local.json (set obs.recordingDirectory and obs.password).'
    Write-Info '  2. Create the Whisper venv:'
    Write-Info '       py -3.12 -m venv .venv'
    Write-Info '       .\.venv\Scripts\python.exe -m pip install --upgrade pip faster-whisper'
    Write-Info '  3. Run: .\scripts\review-recorder.ps1 doctor'
    return 0
}

function Invoke-Start {
    $config = Get-Config
    $now = Get-Date
    $recordingDir = $config.obs.recordingDirectory

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $script:StateFile) | Out-Null

    $state = [ordered]@{
        startedAt          = $now.ToString('o')
        mode               = 'manual'
        recordingDirectory = $recordingDir
        obsOutputPath      = $null
    }

    if ($Manual) {
        Write-Head 'Start (manual mode)'
        Write-Info 'Start the recording in OBS now, then perform your app review.'
        Write-Info 'When finished, run: .\scripts\review-recorder.ps1 stop'
        Save-State $state
        return 0
    }

    Write-Head 'Start'
    Write-Step "Connecting to OBS WebSocket at $($config.obs.webSocketUrl) ..."
    $conn = $null
    try {
        $conn = Connect-Obs -Url $config.obs.webSocketUrl -Password $config.obs.password
        $status = Invoke-ObsRequest -Connection $conn -RequestType 'GetRecordStatus'
        if ($status.responseData.outputActive) {
            Write-Warn2 'OBS is already recording. Reusing the active recording.'
        }
        else {
            $r = Invoke-ObsRequest -Connection $conn -RequestType 'StartRecord'
            if (-not $r.requestStatus.result) { throw "StartRecord failed: $($r.requestStatus.comment)" }
            Write-Ok 'OBS recording started.'
        }
        $state.mode = 'obs'
        Save-State $state
        Write-Info 'Perform your app review, then run: .\scripts\review-recorder.ps1 stop'
        return 0
    }
    catch {
        Write-Warn2 "OBS WebSocket unavailable: $($_.Exception.Message)"
        Write-Info 'Falling back to manual mode.'
        Write-Info 'Start the recording in OBS manually now, then run stop when finished.'
        $state.mode = 'manual'
        Save-State $state
        return 0
    }
    finally {
        Close-Obs $conn
    }
}

function Invoke-Stop {
    $config = Get-Config
    $state = Get-State
    $startedAt = $null
    $mode = 'manual'
    if ($state) {
        $mode = $state.mode
        try { $startedAt = [datetime]::Parse($state.startedAt) } catch { }
    }
    else {
        Write-Warn2 'No active start state found. Treating this as a manual stop.'
    }

    Write-Head 'Stop'
    $obsOutputPath = $null

    if ($mode -eq 'obs' -and -not $Manual) {
        $conn = $null
        try {
            Write-Step 'Stopping OBS recording ...'
            $conn = Connect-Obs -Url $config.obs.webSocketUrl -Password $config.obs.password
            $r = Invoke-ObsRequest -Connection $conn -RequestType 'StopRecord'
            if ($r.requestStatus.result -and $r.responseData -and ($r.responseData.PSObject.Properties.Name -contains 'outputPath')) {
                $obsOutputPath = $r.responseData.outputPath
                Write-Ok "OBS stopped. Output: $obsOutputPath"
            }
            else {
                Write-Warn2 'OBS stopped but did not report an output path. Will search the recording directory.'
            }
        }
        catch {
            Write-Warn2 "Could not stop via WebSocket: $($_.Exception.Message). Searching recording directory instead."
        }
        finally { Close-Obs $conn }
    }
    else {
        Write-Info 'Manual mode: make sure you have stopped the recording in OBS.'
    }

    # Resolve the video
    $video = $null
    if ($VideoPath) { $video = $VideoPath }
    elseif ($obsOutputPath -and (Test-Path $obsOutputPath)) { $video = $obsOutputPath }
    else {
        $latest = Get-LatestVideo -Directory $config.obs.recordingDirectory -Since $startedAt
        if ($latest) { $video = $latest.FullName }
    }

    # Build run folder
    $runId = (Get-Date).ToString('yyyy-MM-dd-HHmmss')
    $runsRoot = Resolve-RepoPath $config.output.runsDirectory
    $runDir = Join-Path $runsRoot $runId
    New-Item -ItemType Directory -Force -Path $runDir | Out-Null
    Write-Ok "Run folder: $runDir"

    $steps = [System.Collections.Generic.List[object]]::new()
    function Add-Step { param($Name, $Status, $Message = '') $steps.Add([pscustomobject]@{ name = $Name; status = $Status; message = $Message }) }

    $runInfo = [ordered]@{
        runId                  = $runId
        createdAt              = (Get-Date).ToString('o')
        mode                   = $mode
        keyframeIntervalSeconds = $config.ffmpeg.keyframeIntervalSeconds
        video                  = [ordered]@{ found = $false; sourcePath = $null; durationSeconds = $null; message = '' }
        steps                  = $steps
    }

    if (-not $video -or -not (Test-Path $video)) {
        Add-Step 'find-video' 'failed' 'No recording was found. Set obs.recordingDirectory or pass -VideoPath.'
        $runInfo.video.message = 'No recording found.'
        Write-Bad 'No video found - writing a brief with placeholders.'
        ConvertTo-JsonFile -Object $runInfo -Path (Join-Path $runDir 'run.json')
        $briefPath = New-AgentBrief -RunInfo $runInfo -RunDir $runDir
        Write-Info "Brief: $briefPath"
        Clear-State
        return 1
    }

    Write-Ok "Video: $video"
    Add-Step 'find-video' 'ok' $video
    $runInfo.video.found = $true
    $runInfo.video.sourcePath = $video

    if ($config.output.copyVideoToRun) {
        try {
            $dest = Join-Path $runDir ('review' + [System.IO.Path]::GetExtension($video))
            Copy-Item -Path $video -Destination $dest -Force
            $runInfo.video.sourcePath = $dest
            Write-Ok "Copied video into run folder."
        }
        catch { Write-Warn2 "Could not copy video: $($_.Exception.Message)" }
    }

    # Duration
    $ffmpegOk = [bool](Test-Tool $config.ffmpeg.ffprobePath)
    if ($ffmpegOk) {
        $dur = Get-VideoDuration -Config $config -Video $video
        if ($dur) { $runInfo.video.durationSeconds = $dur }
    }

    # Keyframes
    if ($NoKeyframes) {
        Add-Step 'keyframes' 'skipped' 'Disabled with -NoKeyframes.'
    }
    elseif (-not (Test-Tool $config.ffmpeg.ffmpegPath)) {
        Add-Step 'keyframes' 'skipped' 'ffmpeg not available.'
        Write-Warn2 'ffmpeg missing - skipping keyframes.'
    }
    else {
        Write-Step 'Extracting keyframes ...'
        $kfDir = Join-Path $runDir 'keyframes'
        $code = Export-Keyframes -Config $config -Video $video -OutDir $kfDir
        $count = (Get-ChildItem -Path $kfDir -Filter 'frame-*.jpg' -File -ErrorAction SilentlyContinue | Measure-Object).Count
        if ($code -eq 0 -and $count -gt 0) { Add-Step 'keyframes' 'ok' "$count frames"; Write-Ok "$count keyframes." }
        else { Add-Step 'keyframes' 'failed' "ffmpeg exit $code, $count frames." ; Write-Warn2 'Keyframe extraction had problems.' }
    }

    # Audio + transcription
    $doTranscribe = $config.transcription.enabled -and -not $NoTranscribe
    if (-not $doTranscribe) {
        Add-Step 'audio' 'skipped' 'Transcription disabled.'
        Add-Step 'transcription' 'skipped' 'Transcription disabled.'
    }
    elseif (-not (Test-Tool $config.ffmpeg.ffmpegPath)) {
        Add-Step 'audio' 'skipped' 'ffmpeg not available.'
        Add-Step 'transcription' 'skipped' 'No audio to transcribe.'
        Write-Warn2 'ffmpeg missing - skipping audio/transcription.'
    }
    else {
        Write-Step 'Extracting audio ...'
        $wav = Join-Path $runDir 'audio.wav'
        $ac = Export-Audio -Config $config -Video $video -WavPath $wav
        if ($ac -eq 0 -and (Test-Path $wav)) {
            Add-Step 'audio' 'ok' 'audio.wav'
            $venvPython = Resolve-RepoPath $config.transcription.pythonPath
            if (-not (Test-Path $venvPython)) {
                Add-Step 'transcription' 'skipped' "Python venv missing at $venvPython."
                Write-Warn2 'Whisper venv missing - skipping transcription.'
            }
            else {
                Write-Step "Transcribing with faster-whisper ($($config.transcription.model)/$($config.transcription.language)) ..."
                $tj = Join-Path $runDir 'transcript.json'
                $tt = Join-Path $runDir 'transcript.txt'
                $tc = Invoke-Transcription -Config $config -WavPath $wav -JsonPath $tj -TxtPath $tt
                if ($tc -eq 0 -and (Test-Path $tt)) { Add-Step 'transcription' 'ok' "model=$($config.transcription.model)"; Write-Ok 'Transcript created.' }
                else { Add-Step 'transcription' 'failed' "transcribe-whisper.py exit $tc." ; Write-Warn2 'Transcription failed - brief will note this.' }
            }
        }
        else {
            Add-Step 'audio' 'failed' "ffmpeg exit $ac."
            Add-Step 'transcription' 'skipped' 'No audio produced.'
        }
    }

    ConvertTo-JsonFile -Object $runInfo -Path (Join-Path $runDir 'run.json')
    $briefPath = New-AgentBrief -RunInfo $runInfo -RunDir $runDir
    Add-Step 'brief' 'ok' $briefPath

    Write-Host ""
    Write-Ok "Done. Brief: $briefPath"
    Write-Info "Optional: .\scripts\review-recorder.ps1 analyze `"$runDir`""
    Clear-State
    return 0
}

function Resolve-RunDir {
    param([string]$Path)
    if ($Path) { return (Resolve-RepoPath $Path) }
    $runsRoot = Resolve-RepoPath (Get-Config).output.runsDirectory
    if (-not (Test-Path $runsRoot)) { return $null }
    $latest = Get-ChildItem -Path $runsRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notlike '.*' } | Sort-Object Name -Descending | Select-Object -First 1
    if ($latest) { return $latest.FullName }
    return $null
}

function Invoke-Brief {
    Write-Head 'Brief'
    $runDir = Resolve-RunDir -Path $RunPath
    if (-not $runDir -or -not (Test-Path $runDir)) { Write-Bad 'No run folder found. Pass the run path or run stop first.'; return 1 }

    $runInfoPath = Join-Path $runDir 'run.json'
    if (Test-Path $runInfoPath) {
        $runInfo = Get-Content $runInfoPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    else {
        $runInfo = [pscustomobject]@{
            runId = Split-Path -Leaf $runDir
            createdAt = (Get-Date).ToString('o')
            mode = 'unknown'
            keyframeIntervalSeconds = (Get-Config).ffmpeg.keyframeIntervalSeconds
            video = [pscustomobject]@{ found = $false; sourcePath = $null; durationSeconds = $null; message = 'run.json not found' }
            steps = @()
        }
    }
    $briefPath = New-AgentBrief -RunInfo $runInfo -RunDir $runDir
    Write-Ok "Brief written: $briefPath"
    return 0
}

function Invoke-Analyze {
    Write-Head 'Analyze'
    $config = Get-Config
    if (-not $config.copilot.enabled) { Write-Warn2 'Copilot analysis is disabled in config.'; return 0 }

    $cli = Test-Tool $config.copilot.cliPath
    if (-not $cli) { Write-Bad "Copilot CLI '$($config.copilot.cliPath)' not found. Keeping the original brief."; return 1 }

    $runDir = Resolve-RunDir -Path $RunPath
    if (-not $runDir -or -not (Test-Path $runDir)) { Write-Bad 'No run folder found.'; return 1 }
    $briefPath = Join-Path $runDir 'agent-brief.md'
    if (-not (Test-Path $briefPath)) { Write-Bad "No agent-brief.md in $runDir."; return 1 }

    $rawBackup = Join-Path $runDir 'agent-brief.raw.md'
    if (-not (Test-Path $rawBackup)) { Copy-Item $briefPath $rawBackup -Force }

    $prompt = @"
Read agent-brief.md in this folder. It contains an app-review transcript (possibly Swedish),
a keyframe list, and a coding-agent prompt. Rewrite agent-brief.md so it is a sharper brief:
- Add a concise "Findings" section (bulleted, concrete).
- Add a prioritized "Work items" section (title + acceptance criteria).
- Keep the original transcript and keyframe references intact at the end.
Write the improved markdown back to agent-brief.md. Do not invent details that are not supported
by the transcript or keyframes.
"@

    Write-Step "Running Copilot CLI ($($config.copilot.model)) to improve the brief ..."
    Push-Location $runDir
    try {
        & $cli -p $prompt --model $config.copilot.model --allow-all-tools --allow-all-paths --no-color 2>&1 | Write-Host
        $code = $LASTEXITCODE
    }
    catch {
        $code = 1
        Write-Warn2 "Copilot CLI error: $($_.Exception.Message)"
    }
    finally { Pop-Location }

    if ($code -eq 0) { Write-Ok "Analysis complete. Original saved as agent-brief.raw.md." }
    else { Write-Warn2 "Copilot CLI exited $code. Original brief preserved at $rawBackup." }
    return $code
}

function Invoke-Help {
    Write-Host ""
    Write-Host "OBSReviewRecorder - record an app review and build a coding-agent brief" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Usage: .\scripts\review-recorder.ps1 <command> [options]"
    Write-Host ""
    Write-Host "Commands:"
    Write-Host "  doctor              Check prerequisites and show remediation."
    Write-Host "  init                Create config.sample.json + config.local.json and runs\."
    Write-Host "  start               Start OBS recording (WebSocket) or manual fallback."
    Write-Host "  stop                Stop recording, find video, extract media, build brief."
    Write-Host "  brief  [runPath]    Regenerate agent-brief.md for a run (default: latest)."
    Write-Host "  analyze [runPath]   Improve the brief with GitHub Copilot CLI (optional)."
    Write-Host "  help                Show this help."
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Manual             Force manual recording mode (skip OBS WebSocket)."
    Write-Host "  -VideoPath <path>   Use a specific video file in stop."
    Write-Host "  -NoKeyframes        Skip keyframe extraction in stop."
    Write-Host "  -NoTranscribe       Skip transcription in stop."
    Write-Host "  -ConfigPath <path>  Use an alternate config file."
    Write-Host "  -Force              Overwrite config.local.json in init."
    Write-Host "  -Json               Machine-readable output (doctor)."
    Write-Host ""
    return 0
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
$script:ExitCode = 0
$exit = 0
switch ($Command.ToLowerInvariant()) {
    'doctor'  { Invoke-Doctor; $exit = $script:ExitCode }
    'init'    { $exit = Invoke-Init }
    'start'   { $exit = Invoke-Start }
    'stop'    { $exit = Invoke-Stop }
    'brief'   { $exit = Invoke-Brief }
    'analyze' { $exit = Invoke-Analyze }
    'help'    { $exit = Invoke-Help }
    default   {
        Write-Host "Unknown command: $Command" -ForegroundColor Red
        $exit = Invoke-Help
        $exit = 2
    }
}
exit $exit
