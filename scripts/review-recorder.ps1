#Requires -Version 5.1
<#
.SYNOPSIS
    OBSReviewRecorder - record an app review with OBS and build a coding-agent brief.

.DESCRIPTION
    Windows-first PowerShell CLI. Commands:
        doctor   Check prerequisites and OBS capture readiness.
        miccheck Sample OBS audio levels to prove narration will be captured.
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

    [string]$Window,

    [int]$Seconds = 8,

    [switch]$Display,
    [switch]$NoLaunch,
    [switch]$KeepObsOpen,
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

function Get-SelfInvocation {
    # Every hint this tool prints should be runnable exactly as printed. The
    # installed skill calls the recorder from the repository of the app being
    # reviewed, where a repo-relative path resolves to nothing.
    param(
        [string]$ScriptPath,
        [string]$RepoRoot,
        [string]$CurrentDirectory
    )
    $full = {
        param([string]$P)
        if ([string]::IsNullOrWhiteSpace($P)) { return '' }
        try { return ([System.IO.Path]::GetFullPath($P)).TrimEnd('\') } catch { return $P.TrimEnd('\') }
    }
    if ((& $full $CurrentDirectory) -ieq (& $full $RepoRoot)) {
        return '.\scripts\review-recorder.ps1'
    }
    if ([string]::IsNullOrWhiteSpace($ScriptPath)) { return '.\scripts\review-recorder.ps1' }
    return "& '$ScriptPath'"
}

$script:Self = Get-SelfInvocation -ScriptPath $PSCommandPath -RepoRoot $script:RepoRoot -CurrentDirectory (Get-Location).Path

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
            webSocketUrl            = 'ws://127.0.0.1:4455'
            password                = ''
            recordingDirectory      = (Join-Path $env:USERPROFILE 'Videos')
            launchIfNotRunning      = $true
            startupTimeoutSeconds   = 45
            windowCaptureSourceName = 'Review Window Capture'
            defaultCaptureTarget    = ''
            closeAfterStop          = $true
            shutdownTimeoutSeconds  = 20
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
    param([string]$Url, [string]$Password, [int]$TimeoutSec = 8, [int]$EventSubscriptions = -1)
    $socket = [System.Net.WebSockets.ClientWebSocket]::new()
    $cts = [System.Threading.CancellationTokenSource]::new()
    $cts.CancelAfter([TimeSpan]::FromSeconds($TimeoutSec))
    $token = $cts.Token
    $socket.ConnectAsync([Uri]$Url, $token).GetAwaiter().GetResult() | Out-Null

    $hello = Receive-ObsFrame -Socket $socket -Token $token
    $identify = @{ op = 1; d = @{ rpcVersion = 1 } }
    if ($EventSubscriptions -ge 0) { $identify.d.eventSubscriptions = $EventSubscriptions }
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
# Launching OBS and choosing what it captures
#
# The agent-driven flow starts from "record a review of this window", so the
# tool has to be able to bring OBS up itself and point it at a specific window.
# Leaving the target to whatever happened to be selected in the OBS UI records
# the wrong thing and the mistake is only discovered after the review is done.
# ---------------------------------------------------------------------------
$script:ObsCaptureKinds = @('window_capture', 'monitor_capture', 'game_capture')

function Test-ObsRunning {
    return [bool](@(Get-Process -Name 'obs64' -ErrorAction SilentlyContinue).Count -gt 0)
}

function Start-ObsProcess {
    <#
      OBS resolves its locale and plugins relative to the working directory, so
      it must be launched from its own bin folder or it dies on startup.
    #>
    param([string]$ExePath)
    if (-not $ExePath -or -not (Test-Path -LiteralPath $ExePath)) { return $false }
    $workDir = Split-Path -Parent $ExePath
    Start-Process -FilePath $ExePath -WorkingDirectory $workDir -ArgumentList '--disable-shutdown-check' | Out-Null
    return $true
}

function Stop-ObsProcess {
    <#
      Close OBS once recording has stopped, before the video is read.

      Asking the window to close is the only correct way to do it. OBS writes a
      sentinel file per session and removes it on a clean exit; killing the
      process instead leaves that sentinel behind, and OBS then opens a "crash
      detected" dialog on its next launch that blocks its WebSocket server. So
      a hung OBS is left alone and reported rather than killed - a stuck process
      is recoverable, a corrupted next launch wastes the following review.

      Returns a status string: 'not-running', 'closed', or 'timeout'.
    #>
    param([int]$TimeoutSeconds = 20)

    $procs = @(Get-Process -Name 'obs64' -ErrorAction SilentlyContinue)
    if ($procs.Count -eq 0) { return 'not-running' }

    foreach ($p in $procs) {
        try { [void]$p.CloseMainWindow() } catch { }
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (@(Get-Process -Name 'obs64' -ErrorAction SilentlyContinue).Count -eq 0) { return 'closed' }
        Start-Sleep -Milliseconds 500
    }
    return 'timeout'
}

function Test-ObsOutputActive {
    <#
      True when an obs-websocket status response reports a running output.
      Kept separate from the polling loop so the decision can be tested
      without a live OBS.
    #>
    param($ResponseData)
    if ($null -eq $ResponseData) { return $false }
    return [bool](Get-Prop $ResponseData 'outputActive' $false)
}

function Wait-ObsOutputsIdle {
    <#
      Closing OBS while any output still runs makes it open the modal "OBS is
      still currently active" prompt, which nobody is there to click when the
      agent drives the tool - the close silently turns into a hang.

      StopRecord returns as soon as OBS accepts the request, not when the
      recorder has flushed and closed the file, so stopping and closing back to
      back loses that race. Poll until every output reports idle.

      Returns $true when OBS is idle (or its state cannot be read, which is no
      worse than not having asked), $false only when an output is still active
      at the deadline.
    #>
    param($Connection, [int]$TimeoutSeconds = 20)
    if (-not $Connection) { return $true }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ($true) {
        $active = $false
        foreach ($request in @('GetRecordStatus', 'GetStreamStatus', 'GetVirtualCamStatus', 'GetReplayBufferStatus')) {
            try {
                $response = Invoke-ObsRequest -Connection $Connection -RequestType $request
                if (Test-ObsOutputActive $response.responseData) { $active = $true; break }
            }
            catch { }
        }
        if (-not $active) { return $true }
        if ((Get-Date) -ge $deadline) { return $false }
        Start-Sleep -Milliseconds 300
    }
}

function Test-ObsDialogTitle {
    <#
      After an unclean exit OBS opens a modal dialog before it loads plugins, so
      the WebSocket server never starts. Waiting out the full timeout and then
      falling back to manual mode hides the one thing the user must act on.
    #>
    param([string]$Title)
    if (-not $Title) { return $false }
    return [bool]($Title -match '(?i)crash detected|safe mode|missing files|auto-?configuration')
}

function Get-ObsBlockingDialog {
    foreach ($p in @(Get-Process -Name 'obs64' -ErrorAction SilentlyContinue)) {
        $title = [string]$p.MainWindowTitle
        if (Test-ObsDialogTitle $title) { return $title }
    }
    return $null
}

function Connect-ObsWithRetry {
    <#
      A freshly launched OBS accepts WebSocket connections seconds after the
      process appears, so a single attempt would fail for reasons that are not
      an error. Returns an object rather than throwing, so the caller can tell
      "still starting" apart from "waiting for a human to click a dialog".
    #>
    param([string]$Url, [string]$Password, [int]$TimeoutSeconds = 45)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ($true) {
        try { return [pscustomobject]@{ Connection = (Connect-Obs -Url $Url -Password $Password -TimeoutSec 4); Blocked = $null } }
        catch {
            $dialog = Get-ObsBlockingDialog
            if ($dialog) { return [pscustomobject]@{ Connection = $null; Blocked = $dialog } }
            if ((Get-Date) -ge $deadline) { return [pscustomobject]@{ Connection = $null; Blocked = $null } }
            Start-Sleep -Milliseconds 1000
        }
    }
}

function Connect-ObsEnsured {
    <#
      Connect to OBS, launching it first when it is not running. Returns an
      object with the connection (possibly $null) and a human-readable reason.
    #>
    param($Config, [switch]$NoLaunchOverride)

    $url = $Config.obs.webSocketUrl
    $password = $Config.obs.password

    try { return [pscustomobject]@{ Connection = (Connect-Obs -Url $url -Password $password -TimeoutSec 4); Launched = $false; Reason = $null } }
    catch { }

    $mayLaunch = (-not $NoLaunchOverride) -and [bool](Get-Prop $Config.obs 'launchIfNotRunning' $true)
    if (-not $mayLaunch) {
        return [pscustomobject]@{ Connection = $null; Launched = $false; Reason = 'OBS is not reachable and launching is disabled.' }
    }

    $exe = Get-ObsExecutable
    if (-not $exe) {
        return [pscustomobject]@{ Connection = $null; Launched = $false; Reason = 'OBS Studio is not installed.' }
    }

    $launched = $false
    if (-not (Test-ObsRunning)) {
        Write-Step 'Starting OBS Studio ...'
        $launched = Start-ObsProcess -ExePath $exe
        if (-not $launched) {
            return [pscustomobject]@{ Connection = $null; Launched = $false; Reason = "Could not start OBS from $exe." }
        }
    }

    $timeout = [int](Get-Prop $Config.obs 'startupTimeoutSeconds' 45)
    $result = Connect-ObsWithRetry -Url $url -Password $password -TimeoutSeconds $timeout
    if (-not $result.Connection) {
        if ($result.Blocked) {
            $reason = "OBS is waiting for you to answer its '$($result.Blocked)' dialog. Click through it and run this again."
        }
        elseif ($launched) {
            $reason = "OBS started but its WebSocket server did not answer within $timeout s. Enable Tools > WebSocket Server Settings."
        }
        else {
            $reason = 'OBS is running but its WebSocket server is not answering.'
        }
        return [pscustomobject]@{ Connection = $null; Launched = $launched; Reason = $reason }
    }
    return [pscustomobject]@{ Connection = $result.Connection; Launched = $launched; Reason = $null }
}

function ConvertFrom-ObsWindowItem {
    <#
      OBS labels a window "[chrome.exe]: Some title" and identifies it as
      "Some title:ClassName:chrome.exe", escaping ':' in the title as '#3A'.
      Both halves are needed: the label is what a human recognises, the value is
      what has to be written back into the source settings.
    #>
    param([string]$ItemName, [string]$ItemValue)

    $process = ''
    $title = [string]$ItemName
    if ($ItemName -match '^\s*\[([^\]]+)\]\s*:\s*(.*)$') {
        $process = $Matches[1]
        $title = $Matches[2]
    }
    elseif ($ItemValue -and $ItemValue.Contains(':')) {
        $parts = $ItemValue.Split(':')
        if ($parts.Count -ge 3) { $process = $parts[$parts.Count - 1] }
    }

    return [pscustomobject]@{
        Title   = $title.Trim()
        Process = $process.Trim()
        Value   = [string]$ItemValue
        Label   = [string]$ItemName
    }
}

function Find-ObsWindowMatch {
    <#
      Resolve what the user said into exactly one window. Tiers are tried in
      order of confidence so that an exact title never loses to an accidental
      substring, and an ambiguous request is reported rather than guessed:
      recording the wrong window is only noticed once the review is over.
    #>
    param($Windows, [string]$Pattern)

    $list = @($Windows)
    $p = ([string]$Pattern).Trim()
    if (-not $p) { return [pscustomobject]@{ Status = 'none'; Match = $null; Candidates = @() } }

    $bare = $p -replace '\.exe$', ''
    $ic = [System.StringComparison]::OrdinalIgnoreCase
    $tiers = @(
        { param($w) $w.Title -and $w.Title.Equals($p, $ic) },
        { param($w) $w.Process -and ($w.Process.Equals($p, $ic) -or ($w.Process -replace '\.exe$', '').Equals($bare, $ic)) },
        { param($w) $w.Title -and $w.Title.IndexOf($p, $ic) -ge 0 },
        { param($w) $w.Process -and $w.Process.IndexOf($bare, $ic) -ge 0 },
        { param($w) $w.Label -and $w.Label.IndexOf($p, $ic) -ge 0 }
    )

    foreach ($tier in $tiers) {
        $hits = @($list | Where-Object { & $tier $_ })
        if ($hits.Count -eq 1) { return [pscustomobject]@{ Status = 'ok'; Match = $hits[0]; Candidates = $hits } }
        if ($hits.Count -gt 1) { return [pscustomobject]@{ Status = 'ambiguous'; Match = $null; Candidates = $hits } }
    }
    return [pscustomobject]@{ Status = 'none'; Match = $null; Candidates = @() }
}

function Get-ObsCurrentScene {
    param($Connection)
    return [string](Invoke-ObsRequest -Connection $Connection -RequestType 'GetSceneList').responseData.currentProgramSceneName
}

function Get-ObsCaptureItems {
    param($Connection, [string]$SceneName)
    $items = @((Invoke-ObsRequest -Connection $Connection -RequestType 'GetSceneItemList' -RequestData @{ sceneName = $SceneName }).responseData.sceneItems)
    return @($items | Where-Object { $script:ObsCaptureKinds -contains [string](Get-Prop $_ 'inputKind' '') })
}

function New-ObsWindowCaptureSource {
    param($Connection, [string]$SceneName, [string]$SourceName)
    $r = Invoke-ObsRequest -Connection $Connection -RequestType 'CreateInput' -RequestData @{
        sceneName     = $SceneName
        inputName     = $SourceName
        inputKind     = 'window_capture'
        inputSettings = @{ method = 2; capture_cursor = $true }
    }
    if (-not $r.requestStatus.result) { throw "Could not create a window capture source: $(Get-Prop $r.requestStatus 'comment' '')" }
    return $SourceName
}

function Resolve-ObsWindowSource {
    <#
      Return the name of a window capture source in the current scene, creating
      one when the scene has none so a fresh OBS install still works.
    #>
    param($Connection, [string]$SceneName, [string]$PreferredName, [switch]$CreateIfMissing)
    $items = @(Get-ObsCaptureItems -Connection $Connection -SceneName $SceneName)
    $windows = @($items | Where-Object { [string](Get-Prop $_ 'inputKind' '') -eq 'window_capture' })
    if ($windows.Count -gt 1 -and $PreferredName) {
        $named = @($windows | Where-Object { [string](Get-Prop $_ 'sourceName' '') -eq $PreferredName })
        if ($named.Count -eq 1) { return [string]$named[0].sourceName }
    }
    if ($windows.Count -ge 1) { return [string]$windows[0].sourceName }
    if (-not $CreateIfMissing) { return $null }
    $name = if ($PreferredName) { $PreferredName } else { 'Review Window Capture' }
    return (New-ObsWindowCaptureSource -Connection $Connection -SceneName $SceneName -SourceName $name)
}

function Get-ObsWindowList {
    param($Connection, [string]$SourceName)
    $r = Invoke-ObsRequest -Connection $Connection -RequestType 'GetInputPropertiesListPropertyItems' -RequestData @{
        inputName    = $SourceName
        propertyName = 'window'
    }
    if (-not $r.requestStatus.result) { return @() }
    $items = @(Get-Prop $r.responseData 'propertyItems' @())
    $out = @()
    foreach ($i in $items) {
        if (-not [bool](Get-Prop $i 'itemEnabled' $true)) { continue }
        $out += (ConvertFrom-ObsWindowItem -ItemName ([string](Get-Prop $i 'itemName' '')) -ItemValue ([string](Get-Prop $i 'itemValue' '')))
    }
    return $out
}

function Set-ObsCaptureTarget {
    <#
      Point the scene at one capture source and mute the competing ones. Only
      capture sources are touched: disabling everything else would silently
      strip overlays the user deliberately put in the scene.
    #>
    param($Connection, [string]$SceneName, [string]$ActiveSourceName)
    $items = @(Get-ObsCaptureItems -Connection $Connection -SceneName $SceneName)
    foreach ($item in $items) {
        $name = [string](Get-Prop $item 'sourceName' '')
        $id = Get-Prop $item 'sceneItemId' $null
        if ($null -eq $id) { continue }
        Invoke-ObsRequest -Connection $Connection -RequestType 'SetSceneItemEnabled' -RequestData @{
            sceneName        = $SceneName
            sceneItemId      = $id
            sceneItemEnabled = ($name -eq $ActiveSourceName)
        } | Out-Null
    }
}

function Select-ObsWindow {
    <#
      Resolve a user-supplied pattern to a window and make OBS capture it.
      Returns a result object rather than writing output so callers decide how
      to report, and so an ambiguous pattern can be handed back for a question.
    #>
    param($Connection, $Config, [string]$Pattern)

    $scene = Get-ObsCurrentScene -Connection $Connection
    $preferred = [string](Get-Prop $Config.obs 'windowCaptureSourceName' 'Review Window Capture')
    $source = Resolve-ObsWindowSource -Connection $Connection -SceneName $scene -PreferredName $preferred -CreateIfMissing
    $windows = @(Get-ObsWindowList -Connection $Connection -SourceName $source)

    $match = Find-ObsWindowMatch -Windows $windows -Pattern $Pattern
    if ($match.Status -ne 'ok') {
        return [pscustomobject]@{
            Status     = $match.Status
            Scene      = $scene
            Source     = $source
            Window     = $null
            Candidates = @($match.Candidates)
            Windows    = $windows
        }
    }

    $settings = @{ window = $match.Match.Value; method = 2 }
    $r = Invoke-ObsRequest -Connection $Connection -RequestType 'SetInputSettings' -RequestData @{
        inputName     = $source
        inputSettings = $settings
        overlay       = $true
    }
    if (-not $r.requestStatus.result) { throw "Could not select the window: $(Get-Prop $r.requestStatus 'comment' '')" }

    Set-ObsCaptureTarget -Connection $Connection -SceneName $scene -ActiveSourceName $source
    return [pscustomobject]@{
        Status     = 'ok'
        Scene      = $scene
        Source     = $source
        Window     = $match.Match
        Candidates = @($match.Match)
        Windows    = $windows
    }
}

function Select-ObsDisplay {
    param($Connection)
    $scene = Get-ObsCurrentScene -Connection $Connection
    $items = @(Get-ObsCaptureItems -Connection $Connection -SceneName $scene)
    $monitors = @($items | Where-Object { [string](Get-Prop $_ 'inputKind' '') -eq 'monitor_capture' })
    if ($monitors.Count -eq 0) {
        return [pscustomobject]@{ Status = 'none'; Scene = $scene; Source = $null }
    }
    $source = [string]$monitors[0].sourceName
    Set-ObsCaptureTarget -Connection $Connection -SceneName $scene -ActiveSourceName $source
    return [pscustomobject]@{ Status = 'ok'; Scene = $scene; Source = $source }
}

function Get-ObsActiveCaptureTarget {
    <#
      Describe what OBS would record right now, so start and doctor can show it
      before a review begins instead of after it has been wasted.
    #>
    param($Connection)
    try {
        $scene = Get-ObsCurrentScene -Connection $Connection
        $items = @(Get-ObsCaptureItems -Connection $Connection -SceneName $scene)
        $enabled = @($items | Where-Object { [bool](Get-Prop $_ 'sceneItemEnabled' $true) })
        if ($enabled.Count -eq 0) { return 'nothing (no capture source is enabled)' }
        $parts = @()
        foreach ($item in $enabled) {
            $name = [string](Get-Prop $item 'sourceName' '')
            $kind = [string](Get-Prop $item 'inputKind' '')
            if ($kind -eq 'window_capture') {
                $s = (Invoke-ObsRequest -Connection $Connection -RequestType 'GetInputSettings' -RequestData @{ inputName = $name }).responseData.inputSettings
                $w = [string](Get-Prop $s 'window' '')
                if ($w) {
                    $title = ($w.Split(':')[0] -replace '#3A', ':')
                    $parts += "window '$title'"
                }
                else { $parts += "window (none selected)" }
            }
            elseif ($kind -eq 'monitor_capture') { $parts += 'the whole display' }
            else { $parts += $name }
        }
        return ($parts -join ' + ')
    }
    catch { return $null }
}

# ---------------------------------------------------------------------------
# OBS capture readiness
#
# doctor checks the toolchain, but a green toolchain still produces a useless
# run if the OBS scene captures nothing. These helpers inspect what OBS would
# actually record: a rendered frame and the audio inputs feeding the mix.
# ---------------------------------------------------------------------------
function Get-Prop {
    param($Object, [string]$Name, $Default = $null)
    if ($null -eq $Object) { return $Default }
    if ($Object.PSObject.Properties.Name -contains $Name) {
        $value = $Object.$Name
        if ($null -eq $value) { return $Default }
        return $value
    }
    return $Default
}

function Get-BmpLuma {
    <#
      Parse an uncompressed 24/32-bpp BMP and summarise brightness.
      Mean alone cannot tell a black capture from a dark theme, so Range
      (max-min) is the signal that actually matters: a blank capture has
      almost no variation, real UI always does.
    #>
    param([byte[]]$Bytes)

    if ($null -eq $Bytes -or $Bytes.Length -lt 54) { return $null }
    if ($Bytes[0] -ne 0x42 -or $Bytes[1] -ne 0x4D) { return $null }

    $offset = [int][BitConverter]::ToUInt32($Bytes, 10)
    $width  = [int][BitConverter]::ToInt32($Bytes, 18)
    $height = [int][BitConverter]::ToInt32($Bytes, 22)
    $bpp    = [int][BitConverter]::ToUInt16($Bytes, 28)
    $comp   = [int][BitConverter]::ToUInt32($Bytes, 30)

    if ($comp -ne 0) { return $null }
    if ($bpp -ne 24 -and $bpp -ne 32) { return $null }
    if ($width -le 0 -or $height -eq 0) { return $null }

    $bytesPerPixel = [int]($bpp / 8)
    $absHeight = [Math]::Abs($height)
    $rowSize = [int]([Math]::Floor((($bpp * $width) + 31) / 32) * 4)

    $stepX = [Math]::Max(1, [int]($width / 64))
    $stepY = [Math]::Max(1, [int]($absHeight / 64))

    $sum = 0.0; $count = 0
    $min = 255.0; $max = 0.0

    for ($y = 0; $y -lt $absHeight; $y += $stepY) {
        $rowStart = $offset + ($y * $rowSize)
        for ($x = 0; $x -lt $width; $x += $stepX) {
            $i = $rowStart + ($x * $bytesPerPixel)
            if (($i + 2) -ge $Bytes.Length) { continue }
            $luma = (0.299 * $Bytes[$i + 2]) + (0.587 * $Bytes[$i + 1]) + (0.114 * $Bytes[$i])
            $sum += $luma
            $count++
            if ($luma -lt $min) { $min = $luma }
            if ($luma -gt $max) { $max = $luma }
        }
    }
    if ($count -eq 0) { return $null }

    return [pscustomobject]@{
        Mean   = [Math]::Round($sum / $count, 1)
        Min    = [Math]::Round($min, 1)
        Max    = [Math]::Round($max, 1)
        Range  = [Math]::Round($max - $min, 1)
        Width  = $width
        Height = $absHeight
    }
}

function Get-ObsAudioInputs {
    param($Connection)
    $inputs = @((Invoke-ObsRequest -Connection $Connection -RequestType 'GetInputList').responseData.inputs)
    $audio = [System.Collections.Generic.List[object]]::new()
    foreach ($inp in $inputs) {
        $kind = [string](Get-Prop $inp 'inputKind' '')
        if ($kind -notmatch 'wasapi|coreaudio|pulse|alsa|audio_line') { continue }
        $name = [string](Get-Prop $inp 'inputName' '')
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        $muted = $false
        try {
            $muted = [bool](Invoke-ObsRequest -Connection $Connection -RequestType 'GetInputMute' -RequestData @{ inputName = $name }).responseData.inputMuted
        }
        catch { }
        $audio.Add([pscustomobject]@{ Name = $name; Kind = $kind; Muted = $muted })
    }
    return $audio
}

function Get-ObsReadinessChecks {
    param($Config)

    $obsChecks = [System.Collections.Generic.List[object]]::new()
    function Add-ObsCheck {
        param($Name, $Status, $Detail, $Fix = '')
        $obsChecks.Add([pscustomobject]@{ name = $Name; status = $Status; detail = $Detail; fix = $Fix })
    }

    $conn = $null
    try {
        $conn = Connect-Obs -Url $Config.obs.webSocketUrl -Password $Config.obs.password -TimeoutSec 5
    }
    catch {
        Add-ObsCheck 'OBS WebSocket' 'warn' "unreachable at $($Config.obs.webSocketUrl)" `
            'Start OBS, then Tools > WebSocket Server Settings > Enable WebSocket server. Manual mode works without it.'
        return $obsChecks
    }

    try {
        $ver = (Invoke-ObsRequest -Connection $conn -RequestType 'GetVersion').responseData
        Add-ObsCheck 'OBS WebSocket' 'ok' "OBS $(Get-Prop $ver 'obsVersion' '?'), obs-websocket $(Get-Prop $ver 'obsWebSocketVersion' '?')"

        # Recording directory must match config, or stop cannot find the file.
        $recDir = [string](Invoke-ObsRequest -Connection $conn -RequestType 'GetRecordDirectory').responseData.recordDirectory
        $cfgDir = [string]$Config.obs.recordingDirectory
        $normRec = ($recDir -replace '/', '\').TrimEnd('\').ToLowerInvariant()
        $normCfg = ($cfgDir -replace '/', '\').TrimEnd('\').ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($cfgDir) -or $normRec -eq $normCfg) {
            Add-ObsCheck 'Recording directory' 'ok' $recDir
        }
        else {
            Add-ObsCheck 'Recording directory' 'warn' "OBS writes to '$recDir' but config expects '$cfgDir'" `
                "Set obs.recordingDirectory to '$recDir' in config.local.json"
        }

        # Scene must contain something to capture.
        $scene = [string](Invoke-ObsRequest -Connection $conn -RequestType 'GetSceneList').responseData.currentProgramSceneName
        $items = @((Invoke-ObsRequest -Connection $conn -RequestType 'GetSceneItemList' -RequestData @{ sceneName = $scene }).responseData.sceneItems)
        $enabled = @($items | Where-Object { Get-Prop $_ 'sceneItemEnabled' $false })
        if ($enabled.Count -eq 0) {
            Add-ObsCheck 'OBS scene sources' 'missing' "scene '$scene' has no enabled sources" `
                'In OBS, Sources > + > Display Capture (or Window Capture) and pick a monitor/window.'
        }
        else {
            $names = ($enabled | ForEach-Object { Get-Prop $_ 'sourceName' '?' }) -join ', '
            Add-ObsCheck 'OBS scene sources' 'ok' "scene '$scene': $names"
        }

        # Ground truth: render a frame and measure it.
        $luma = $null
        try {
            $shot = Invoke-ObsRequest -Connection $conn -RequestType 'GetSourceScreenshot' -RequestData @{
                sourceName             = $scene
                imageFormat            = 'bmp'
                imageWidth             = 160
                imageCompressionQuality = -1
            }
            if ($shot.requestStatus.result) {
                $data = [string]$shot.responseData.imageData
                $comma = $data.IndexOf(',')
                if ($comma -ge 0) { $data = $data.Substring($comma + 1) }
                $luma = Get-BmpLuma ([Convert]::FromBase64String($data))
            }
        }
        catch { }

        if ($null -eq $luma) {
            Add-ObsCheck 'OBS video output' 'warn' 'could not render a preview frame' 'Check the scene manually in the OBS preview.'
        }
        elseif ($luma.Range -lt 8) {
            Add-ObsCheck 'OBS video output' 'missing' "frame is blank (brightness range $($luma.Range)/255)" `
                'The capture source is producing nothing. Open its Properties and select a display/window.'
        }
        elseif ($luma.Mean -lt 6) {
            Add-ObsCheck 'OBS video output' 'warn' "frame is very dark (mean $($luma.Mean)/255)" `
                'Confirm the OBS preview shows the app you want to review.'
        }
        else {
            Add-ObsCheck 'OBS video output' 'ok' "frame has content (mean $($luma.Mean), range $($luma.Range))"
        }

        # Audio: an unmuted input is required or the transcript comes out empty.
        $audio = Get-ObsAudioInputs -Connection $conn
        $live = @($audio | Where-Object { -not $_.Muted })
        if ($audio.Count -eq 0) {
            Add-ObsCheck 'OBS audio inputs' 'missing' 'no audio devices configured' `
                'OBS > Settings > Audio > set a Mic/Auxiliary device.'
        }
        elseif ($live.Count -eq 0) {
            $muted = ($audio | ForEach-Object { $_.Name }) -join ', '
            Add-ObsCheck 'OBS audio inputs' 'missing' "all inputs muted: $muted" `
                'Unmute the mic in the OBS Audio Mixer, or narration will not be recorded.'
        }
        else {
            Add-ObsCheck 'OBS audio inputs' 'ok' (($live | ForEach-Object { $_.Name }) -join ', ') 
        }
    }
    catch {
        Add-ObsCheck 'OBS capture readiness' 'warn' "check failed: $($_.Exception.Message)" ''
    }
    finally {
        Close-Obs $conn
    }

    return $obsChecks
}

# ---------------------------------------------------------------------------
# Media pipeline
# ---------------------------------------------------------------------------

# PowerShell turns a native program's stderr into ErrorRecord objects, so under
# $ErrorActionPreference = 'Stop' a merely informational ffmpeg message aborts
# the script. That is worse than it sounds: ffmpeg is killed mid-write and
# leaves a truncated file that still looks plausible. Redirect stderr to a file
# instead, and decide success from the exit code.
function Invoke-NativeCapture {
    param(
        [Parameter(Mandatory)][string]$Exe,
        [string[]]$Arguments = @()
    )
    $errFile = [System.IO.Path]::GetTempFileName()
    $prevEap = $ErrorActionPreference
    $stdout = $null
    $code = -1
    try {
        $ErrorActionPreference = 'Continue'
        $stdout = & $Exe @Arguments 2>$errFile
        $code = $LASTEXITCODE
    }
    catch {
        $code = -1
        Add-Content -LiteralPath $errFile -Value $_.Exception.Message -ErrorAction SilentlyContinue
    }
    finally {
        $ErrorActionPreference = $prevEap
    }

    $stderrText = ''
    if (Test-Path -LiteralPath $errFile) {
        $raw = Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue
        if ($raw) { $stderrText = $raw.Trim() }
        Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue
    }

    return [pscustomobject]@{
        ExitCode = $code
        StdOut   = (@($stdout) -join "`n").Trim()
        StdErr   = $stderrText
    }
}

# ffmpeg wants '.' as the decimal separator regardless of the operator's locale.
function Format-Invariant {
    param([double]$Value)
    return $Value.ToString([System.Globalization.CultureInfo]::InvariantCulture)
}

# OBS reports the output path the moment it stops, but the muxer may still be
# flushing samples and writing the moov atom. Reading the file at that point
# yields a short, still-valid-looking video: keyframe extraction quietly stops
# early and the tail of the narration is lost. Wait for the size to settle.
function Wait-ForStableFile {
    param(
        [string]$Path,
        [int]$TimeoutSeconds = 30,
        [int]$QuietMilliseconds = 1500
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastSize = -1L
    $stableSince = $null
    while ((Get-Date) -lt $deadline) {
        $size = -1L
        if (Test-Path -LiteralPath $Path) {
            try { $size = (Get-Item -LiteralPath $Path -ErrorAction Stop).Length }
            catch { $size = -1L }
        }
        if ($size -gt 0 -and $size -eq $lastSize) {
            if ($null -eq $stableSince) { $stableSince = Get-Date }
            if (((Get-Date) - $stableSince).TotalMilliseconds -ge $QuietMilliseconds) { return $true }
        }
        else {
            $stableSince = $null
        }
        $lastSize = $size
        Start-Sleep -Milliseconds 250
    }
    return $false
}

function Get-MediaDuration {
    param($Config, [string]$Path)
    if (-not $Path -or -not (Test-Path -LiteralPath $Path)) { return $null }
    $r = Invoke-NativeCapture -Exe $Config.ffmpeg.ffprobePath -Arguments @(
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', '--', $Path)
    if ($r.ExitCode -ne 0 -or -not $r.StdOut) { return $null }
    $line = @($r.StdOut -split "`r?`n") | Where-Object { $_ -match '^\s*\d+([.,]\d+)?\s*$' } | Select-Object -First 1
    if (-not $line) { return $null }
    $parsed = 0.0
    $ok = [double]::TryParse(
        ($line.Trim() -replace ',', '.'),
        [System.Globalization.NumberStyles]::Float,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [ref]$parsed)
    if ($ok) { return $parsed }
    return $null
}

function Get-VideoDuration {
    param($Config, [string]$Video)
    return Get-MediaDuration -Config $Config -Path $Video
}

function Export-Keyframes {
    param($Config, [string]$Video, [string]$OutDir)
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $interval = [double]$Config.ffmpeg.keyframeIntervalSeconds
    if ($interval -le 0) { $interval = 2 }
    $fps = 'fps=1/' + (Format-Invariant $interval)
    $pattern = Join-Path $OutDir 'frame-%06d.jpg'
    return Invoke-NativeCapture -Exe $Config.ffmpeg.ffmpegPath -Arguments @(
        '-hide_banner', '-loglevel', 'error', '-y', '-i', $Video,
        '-vf', $fps, '-qscale:v', "$($Config.ffmpeg.imageQuality)", '--', $pattern)
}

function Export-Audio {
    param($Config, [string]$Video, [string]$WavPath)
    return Invoke-NativeCapture -Exe $Config.ffmpeg.ffmpegPath -Arguments @(
        '-hide_banner', '-loglevel', 'error', '-y', '-i', $Video,
        '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '--', $WavPath)
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
function Format-Timecode {
    param([double]$Seconds)
    if ($Seconds -lt 0) { $Seconds = 0 }
    $ts = [TimeSpan]::FromSeconds($Seconds)
    if ($ts.TotalHours -ge 1) { return ('{0:hh\:mm\:ss}' -f $ts) }
    return ('{0:mm\:ss}' -f $ts)
}

function Get-ReviewTimeline {
    <#
      Pair each spoken segment with the screenshot that was on screen while it
      was said. Without this the brief hands an agent a wall of text next to an
      unordered pile of images and nothing connects the two, so "this button is
      wrong" cannot be resolved to a screen.

      ffmpeg's fps filter emits output frame k (1-based) at exactly
      (k-1) * interval seconds, verified against showinfo, so the frame index
      is itself a timestamp and no extra probing is needed.
    #>
    param(
        [string]$RunDir,
        $KeyframeFiles,
        [double]$IntervalSeconds
    )

    $transcriptJson = Join-Path $RunDir 'transcript.json'
    if (-not (Test-Path -LiteralPath $transcriptJson)) { return @() }
    if ($IntervalSeconds -le 0) { $IntervalSeconds = 2 }

    $data = $null
    try { $data = Get-Content -LiteralPath $transcriptJson -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { return @() }

    $segments = @(Get-Prop $data 'segments' @())
    if ($segments.Count -eq 0) { return @() }

    $files = @($KeyframeFiles)
    $frames = @()
    for ($i = 0; $i -lt $files.Count; $i++) {
        $frames += [pscustomobject]@{
            Name = $files[$i].Name
            Time = [Math]::Round($i * $IntervalSeconds, 2)
        }
    }

    $rows = @()
    foreach ($seg in $segments) {
        $start = [double](Get-Prop $seg 'start' 0)
        $end = [double](Get-Prop $seg 'end' $start)
        $text = ([string](Get-Prop $seg 'text' '')).Trim()

        $matched = @()
        if ($frames.Count -gt 0) {
            # The screen a sentence describes is the one sampled at or before the
            # moment it was spoken, not merely the frames landing inside the
            # sentence: speech starting at 6.4 s refers to the frame taken at 6 s.
            $first = [int][Math]::Floor($start / $IntervalSeconds)
            $last = [int][Math]::Floor($end / $IntervalSeconds)
            if ($first -lt 0) { $first = 0 }
            if ($last -gt ($frames.Count - 1)) { $last = $frames.Count - 1 }
            if ($first -gt ($frames.Count - 1)) { $first = $frames.Count - 1 }
            if ($last -lt $first) { $last = $first }
            $matched = @($frames[$first..$last])
        }

        $rows += [pscustomobject]@{
            Start  = $start
            End    = $end
            Text   = $text
            Frames = $matched
        }
    }
    # Call sites wrap this in @() because PowerShell 5.1 unwraps a single-element
    # array, which would make .Count throw under StrictMode.
    return $rows
}

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
        $keyframeFiles = @(Get-ChildItem -Path $keyframeDir -Filter 'frame-*.jpg' -File -ErrorAction SilentlyContinue |
            Sort-Object Name)
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

    $interval = [double]$RunInfo.keyframeIntervalSeconds
    if ($interval -le 0) { $interval = 2 }
    $timeline = @(Get-ReviewTimeline -RunDir $RunDir -KeyframeFiles $keyframeFiles -IntervalSeconds $interval)

    [void]$sb.AppendLine("## Timeline")
    [void]$sb.AppendLine("")
    if ($timeline.Count -gt 0) {
        [void]$sb.AppendLine("What was on screen while each sentence was spoken. Use this to resolve")
        [void]$sb.AppendLine("references like ""this button"" or ""that screen"" to an actual keyframe.")
        [void]$sb.AppendLine("")
        [void]$sb.AppendLine("| Time | Said | Keyframe |")
        [void]$sb.AppendLine("| --- | --- | --- |")
        foreach ($row in $timeline) {
            $time = '{0}-{1}' -f (Format-Timecode $row.Start), (Format-Timecode $row.End)
            $said = ($row.Text -replace '\|', '\|')
            $links = '_none_'
            $rowFrames = @($row.Frames)
            if ($rowFrames.Count -gt 0) {
                $links = (($rowFrames | ForEach-Object { "[$($_.Name)](keyframes/$($_.Name))" }) -join '<br>')
            }
            [void]$sb.AppendLine("| $time | $said | $links |")
        }
    }
    elseif ($keyframeFiles.Count -gt 0) {
        [void]$sb.AppendLine("_No timed transcript, so speech could not be aligned with the keyframes._")
    }
    else {
        [void]$sb.AppendLine("_Nothing to align: neither keyframes nor a timed transcript are available._")
    }
    [void]$sb.AppendLine("")

    [void]$sb.AppendLine("## Keyframes")
    [void]$sb.AppendLine("")
    if ($keyframeFiles.Count -gt 0) {
        [void]$sb.AppendLine("$($keyframeFiles.Count) keyframe(s) in ``keyframes\``, one every $interval s.")
        [void]$sb.AppendLine("Frame _k_ is the screen at (k-1) x $interval seconds. First frames:")
        [void]$sb.AppendLine("")
        $shown = 0
        foreach ($f in ($keyframeFiles | Select-Object -First 12)) {
            $stamp = Format-Timecode ($shown * $interval)
            [void]$sb.AppendLine("- **$stamp** ![]($('keyframes/' + $f.Name))")
            $shown++
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
    [void]$sb.AppendLine("  - transcript.txt   (spoken feedback, may be in Swedish)")
    [void]$sb.AppendLine("  - transcript.json  (the same text with start/end times per sentence)")
    [void]$sb.AppendLine("  - keyframes\       (screenshots, one every $interval s)")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("The Timeline table above already pairs each sentence with the screenshot")
    [void]$sb.AppendLine("that was visible while it was spoken. The rule is: keyframe k (1-based)")
    [void]$sb.AppendLine("shows the screen at (k-1) x $interval seconds, so a segment starting at")
    [void]$sb.AppendLine("t seconds corresponds to frame floor(t / $interval) + 1. Use it whenever the")
    [void]$sb.AppendLine("narration says ""this"", ""here"" or ""that one"" without naming the element,")
    [void]$sb.AppendLine("and cite the keyframe you relied on for each finding.")
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
    else { Add-Check 'config.local.json' 'warn' 'not created yet' "$script:Self init" }

    # OBS capture readiness (only meaningful while OBS is running)
    foreach ($c in (Get-ObsReadinessChecks -Config $config)) { $checks.Add($c) }

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
    $captureBroken = $checks | Where-Object { $_.status -eq 'missing' -and $_.name -in @('OBS scene sources', 'OBS video output', 'OBS audio inputs') }
    Write-Host ""
    if ($missingRequired) {
        Write-Warn2 'Some media tools are missing. Recording still works; keyframes/transcription will be skipped until installed.'
    }
    else {
        Write-Ok 'Core media tools are present.'
    }
    if ($captureBroken) {
        Write-Bad 'OBS would record an empty screen or silent audio. Fix the items above before recording.'
    }
    Write-Info "Verify the mic actually carries sound with: miccheck"
    Write-Info "Manual mode always works even without OBS WebSocket. Use: start -Manual"
    $script:ExitCode = 0
}

function Invoke-MicCheck {
    $config = Get-Config
    $seconds = if ($Seconds -gt 0) { $Seconds } else { 8 }

    Write-Head "OBSReviewRecorder - miccheck ($seconds s)"

    $conn = $null
    try {
        # 1 <<< 16 = InputVolumeMeters. It is a high-volume event, so OBS only
        # sends it when explicitly subscribed.
        $conn = Connect-Obs -Url $config.obs.webSocketUrl -Password $config.obs.password `
            -TimeoutSec ($seconds + 20) -EventSubscriptions (1 -shl 16)
    }
    catch {
        Write-Warn2 "OBS unavailable: $($_.Exception.Message)"
        Write-Info 'Start OBS and enable the WebSocket server, then retry.'
        return 1
    }

    $peaks = @{}
    $kinds = @{}
    try {
        foreach ($a in (Get-ObsAudioInputs -Connection $conn)) { $kinds[$a.Name] = $a.Kind }
    }
    catch { }

    try {
        Write-Info 'Speak normally until the countdown finishes ...'
        $deadline = (Get-Date).AddSeconds($seconds)
        while ((Get-Date) -lt $deadline) {
            $frame = Receive-ObsFrame -Socket $conn.Socket -Token $conn.Token
            if ((Get-Prop $frame 'op' -1) -ne 5) { continue }
            if ([string](Get-Prop $frame.d 'eventType' '') -ne 'InputVolumeMeters') { continue }
            foreach ($inp in @($frame.d.eventData.inputs)) {
                $name = [string](Get-Prop $inp 'inputName' '')
                if ([string]::IsNullOrWhiteSpace($name)) { continue }
                if (-not $peaks.ContainsKey($name)) { $peaks[$name] = 0.0 }
                foreach ($channel in @(Get-Prop $inp 'inputLevelsMul' @())) {
                    foreach ($mul in @($channel)) {
                        $v = [double]$mul
                        if ($v -gt $peaks[$name]) { $peaks[$name] = $v }
                    }
                }
            }
        }
    }
    catch {
        Write-Warn2 "Sampling stopped: $($_.Exception.Message)"
    }
    finally {
        Close-Obs $conn
    }

    Write-Host ""
    if ($peaks.Count -eq 0) {
        Write-Bad 'No level data received. Check that OBS has audio devices configured.'
        return 1
    }

    $speech = $false
    $liveDevices = 0
    $deadMics = 0
    foreach ($name in ($peaks.Keys | Sort-Object)) {
        $mul = $peaks[$name]
        $db = if ($mul -gt 0) { [Math]::Round(20 * [Math]::Log10($mul), 1) } else { -100.0 }
        $label = "{0,-22} peak {1,7:N1} dB" -f $name, $db
        # Desktop/output capture is legitimately silent when nothing is playing,
        # so only a dead *microphone* is an actual problem for narration.
        $isMic = ([string]$kinds[$name]) -notmatch 'output'

        # The distinction that matters is live-vs-dead, not loud-vs-quiet: a
        # device with a noise floor is working, it just heard no speech.
        if ($db -gt -50) {
            Write-Ok "$label  speech-level signal"
            $speech = $true
            $liveDevices++
        }
        elseif ($db -gt -85) {
            Write-Warn2 "$label  live, but only room noise - no speech detected"
            $liveDevices++
        }
        elseif ($isMic) {
            Write-Bad "$label  digital silence - this microphone records nothing"
            $deadMics++
        }
        else {
            Write-Info "$label  silent (normal unless the app plays sound)"
        }
    }

    Write-Host ""
    if ($speech) {
        Write-Ok 'Narration will be captured.'
        return 0
    }
    if ($liveDevices -gt 0) {
        Write-Warn2 'A device is live but picked up no speech during the sample.'
        Write-Info "Rerun and talk continuously: miccheck -Seconds $seconds"
        return 0
    }
    if ($deadMics -gt 0) {
        Write-Bad 'Every microphone is digitally silent. The transcript would come out empty.'
        Write-Info 'Pick a working device in OBS > Settings > Audio, then rerun miccheck.'
        return 1
    }
    Write-Bad 'No microphone is configured in OBS. Narration cannot be recorded.'
    Write-Info 'OBS > Settings > Audio > set a Mic/Auxiliary device.'
    return 1
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
    Write-Info "  3. Run: $script:Self doctor"
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
        Write-Info "When finished, run: $script:Self stop"
        Save-State $state
        return 0
    }

    Write-Head 'Start'
    $conn = $null
    try {
        $attempt = Connect-ObsEnsured -Config $config -NoLaunchOverride:$NoLaunch
        $conn = $attempt.Connection
        if (-not $conn) { throw [System.InvalidOperationException]::new($attempt.Reason) }
        if ($attempt.Launched) { Write-Ok 'OBS Studio is up.' }

        $target = [string]$Window
        if (-not $target -and -not $Display) { $target = [string](Get-Prop $config.obs 'defaultCaptureTarget' '') }

        if ($Display) {
            $sel = Select-ObsDisplay -Connection $conn
            if ($sel.Status -eq 'ok') { Write-Ok "Capturing the whole display (source '$($sel.Source)')." }
            else { Write-Warn2 "Scene '$($sel.Scene)' has no display capture source; leaving the scene as it is." }
        }
        elseif ($target) {
            $sel = Select-ObsWindow -Connection $conn -Config $config -Pattern $target
            if ($sel.Status -eq 'ok') {
                Write-Ok "Capturing window: $($sel.Window.Label)"
            }
            elseif ($sel.Status -eq 'ambiguous') {
                Write-Bad "'$target' matches $(@($sel.Candidates).Count) windows. Be more specific:"
                foreach ($c in $sel.Candidates) { Write-Info "  $($c.Label)" }
                return 2
            }
            else {
                Write-Bad "No open window matches '$target'."
                Write-Info "Run: $script:Self windows"
                return 2
            }
        }

        $active = Get-ObsActiveCaptureTarget -Connection $conn
        if ($active) { Write-Info "OBS will record $active." }

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
        Write-Info "Perform your app review, then run: $script:Self stop"
        return 0
    }
    catch {
        # Falling back to manual mode is intended when OBS simply is not
        # reachable. Any other failure is a defect in this script, and hiding it
        # behind the same friendly message is how a broken start silently costs
        # the user a review.
        $expected = $_.Exception -is [System.InvalidOperationException]
        if ($expected) {
            Write-Warn2 "OBS unavailable: $($_.Exception.Message)"
        }
        else {
            Write-Bad "Unexpected failure while preparing OBS: $($_.Exception.Message)"
            $script:ExitCode = 1
        }
        Write-Info 'Falling back to manual mode.'
        Write-Info 'Start the recording in OBS manually now, then run stop when finished.'
        $state.mode = 'manual'
        Save-State $state
        if ($expected) { return 0 }
        return 1
    }
    finally {
        Close-Obs $conn
    }
}

function Invoke-Windows {
    <#
      List what can be recorded. The agent-driven flow starts from "record a
      review of this app", so it needs to offer the user a concrete choice
      before any recording begins rather than capturing whatever the OBS UI
      happened to be pointing at.
    #>
    $config = Get-Config
    $conn = $null
    try {
        if (-not $Json) { Write-Head 'Capturable windows' }
        $attempt = Connect-ObsEnsured -Config $config -NoLaunchOverride:$NoLaunch
        $conn = $attempt.Connection
        if (-not $conn) {
            if ($Json) { Write-Output (([ordered]@{ error = $attempt.Reason; windows = @() } | ConvertTo-Json -Depth 4)) }
            else { Write-Bad $attempt.Reason }
            $script:ExitCode = 1
            return
        }
        if ($attempt.Launched -and -not $Json) { Write-Ok 'OBS Studio is up.' }

        $scene = Get-ObsCurrentScene -Connection $conn
        $preferred = [string](Get-Prop $config.obs 'windowCaptureSourceName' 'Review Window Capture')
        $source = Resolve-ObsWindowSource -Connection $conn -SceneName $scene -PreferredName $preferred -CreateIfMissing
        $windows = @(Get-ObsWindowList -Connection $conn -SourceName $source)
        $active = Get-ObsActiveCaptureTarget -Connection $conn

        if ($Json) {
            $payload = [ordered]@{
                scene   = $scene
                source  = $source
                active  = $active
                windows = @($windows | ForEach-Object { [ordered]@{ title = $_.Title; process = $_.Process; label = $_.Label } })
            }
            Write-Output ($payload | ConvertTo-Json -Depth 6)
            return
        }

        if ($windows.Count -eq 0) {
            Write-Warn2 'OBS reports no capturable windows.'
            $script:ExitCode = 1
            return
        }
        $i = 0
        foreach ($w in $windows) {
            $i++
            Write-Host ("  {0,2}. {1}" -f $i, $w.Title) -ForegroundColor White
            Write-Info ("     [$($w.Process)]")
        }
        Write-Host ''
        Write-Info 'Record one of them with:'
        Write-Info "  $script:Self start -Window `"<part of the title>`""
        Write-Info "  $script:Self start -Display      (whole screen)"
        if ($active) { Write-Info "Right now OBS would record $active." }
        return
    }
    catch {
        Write-Bad "Could not list windows: $($_.Exception.Message)"
        $script:ExitCode = 1
        return
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
    $obsIdle = $false
    $idleTimeout = [int](Get-Prop $config.obs 'shutdownTimeoutSeconds' 20)

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

            $obsIdle = Wait-ObsOutputsIdle -Connection $conn -TimeoutSeconds $idleTimeout
            if (-not $obsIdle) { Write-Warn2 'OBS still reports an active output after stopping.' }
        }
        catch {
            Write-Warn2 "Could not stop via WebSocket: $($_.Exception.Message). Searching recording directory instead."
        }
        finally { Close-Obs $conn }
    }
    else {
        Write-Info 'Manual mode: make sure you have stopped the recording in OBS.'
    }

    # Close OBS before the video is read. OBS finalizes the container on exit,
    # and holding the file open has already produced a "partial file" failure
    # once in this project.
    $closeObs = (-not $KeepObsOpen) -and [bool](Get-Prop $config.obs 'closeAfterStop' $true)
    if ($closeObs) {
        $shutdownTimeout = [int](Get-Prop $config.obs 'shutdownTimeoutSeconds' 20)
        if (Test-ObsRunning) {
            if (-not $obsIdle) {
                # Manual mode, or the stop above failed: ask OBS directly rather
                # than walking into the "still currently active" prompt.
                $idleConn = $null
                try {
                    $idleConn = Connect-Obs -Url $config.obs.webSocketUrl -Password $config.obs.password -TimeoutSec 4
                    if (-not (Wait-ObsOutputsIdle -Connection $idleConn -TimeoutSeconds $shutdownTimeout)) {
                        Write-Warn2 'An OBS output is still running. OBS may ask you to confirm closing it.'
                    }
                }
                catch { }
                finally { Close-Obs $idleConn }
            }
            Write-Step 'Closing OBS ...'
            switch (Stop-ObsProcess -TimeoutSeconds $shutdownTimeout) {
                'closed'  { Write-Ok 'OBS closed.' }
                'timeout' {
                    Write-Warn2 "OBS did not close within ${shutdownTimeout}s and was left running."
                    Write-Info  'It is probably showing a dialog. Close it by hand; the recording is unaffected.'
                }
            }
        }
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

    if (-not (Wait-ForStableFile -Path $video)) {
        Write-Warn2 'Recording is still being written - processing it anyway; results may be incomplete.'
        Add-Step 'finalize' 'partial' 'File size had not settled before the timeout.'
    }
    else {
        Add-Step 'finalize' 'ok' 'Recording finalized.'
    }

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
        $res = Export-Keyframes -Config $config -Video $video -OutDir $kfDir
        $count = (Get-ChildItem -Path $kfDir -Filter 'frame-*.jpg' -File -ErrorAction SilentlyContinue | Measure-Object).Count
        if ($res.ExitCode -eq 0 -and $count -gt 0) {
            # Compare against what the duration implies. ffmpeg exits 0 after a
            # short read, so the count is the only signal that the video was
            # processed before it was complete.
            $expected = 0
            if ($runInfo.video.durationSeconds) {
                $iv = [double]$config.ffmpeg.keyframeIntervalSeconds
                if ($iv -le 0) { $iv = 2 }
                $expected = [math]::Floor($runInfo.video.durationSeconds / $iv)
            }
            if ($expected -gt 0 -and $count -lt ($expected - 1)) {
                Add-Step 'keyframes' 'partial' "$count frames, expected about $expected."
                Write-Warn2 ("Only $count keyframes for a {0:N1}s video - expected about $expected." -f $runInfo.video.durationSeconds)
            }
            else {
                Add-Step 'keyframes' 'ok' "$count frames"
                Write-Ok "$count keyframes."
            }
        }
        else {
            Add-Step 'keyframes' 'failed' "ffmpeg exit $($res.ExitCode), $count frames. $($res.StdErr)"
            Write-Warn2 'Keyframe extraction had problems.'
        }
        if ($res.StdErr) { Write-Warn2 "ffmpeg: $($res.StdErr)" }
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
        $res = Export-Audio -Config $config -Video $video -WavPath $wav
        if ($res.StdErr) { Write-Warn2 "ffmpeg: $($res.StdErr)" }
        if ($res.ExitCode -eq 0 -and (Test-Path $wav)) {
            # A zero exit is not proof of a complete extraction. Compare the
            # WAV against the video so a short read cannot silently drop the
            # tail of the narration, which would only surface as a suspiciously
            # short transcript long after the review is over.
            $audioNote = 'audio.wav'
            $audioStatus = 'ok'
            $wavDur = Get-MediaDuration -Config $config -Path $wav
            $vidDur = $runInfo.video.durationSeconds
            if ($wavDur) { $audioNote = 'audio.wav ({0:N1}s)' -f $wavDur }
            if ($wavDur -and $vidDur -and $wavDur -lt ($vidDur - 1.0)) {
                $audioStatus = 'partial'
                $audioNote = 'audio.wav covers {0:N1}s of {1:N1}s - narration is truncated.' -f $wavDur, $vidDur
                Write-Warn2 $audioNote
                Write-Warn2 'Transcribing the incomplete audio anyway.'
            }
            Add-Step 'audio' $audioStatus $audioNote
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
            Add-Step 'audio' 'failed' "ffmpeg exit $($res.ExitCode). $($res.StdErr)"
            Add-Step 'transcription' 'skipped' 'No audio produced.'
            Write-Warn2 'Audio extraction failed - brief will note this.'
        }
    }

    ConvertTo-JsonFile -Object $runInfo -Path (Join-Path $runDir 'run.json')
    $briefPath = New-AgentBrief -RunInfo $runInfo -RunDir $runDir
    Add-Step 'brief' 'ok' $briefPath

    Write-Host ""
    Write-Ok "Done. Brief: $briefPath"
    Write-Info "Optional: $script:Self analyze `"$runDir`""
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
    Write-Host "Usage: $script:Self <command> [options]"
    Write-Host ""
    Write-Host "Commands:"
    Write-Host "  doctor              Check prerequisites and OBS capture readiness."
    Write-Host "  miccheck            Sample OBS audio levels to prove narration is captured."
    Write-Host "  windows             List the windows OBS can record."
    Write-Host "  init                Create config.sample.json + config.local.json and runs\."
    Write-Host "  start               Launch OBS if needed and start recording."
    Write-Host "  stop                Stop recording, find video, extract media, build brief."
    Write-Host "  brief  [runPath]    Regenerate agent-brief.md for a run (default: latest)."
    Write-Host "  analyze [runPath]   Improve the brief with GitHub Copilot CLI (optional)."
    Write-Host "  help                Show this help."
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Window <text>      Record the window whose title or process matches."
    Write-Host "  -Display            Record the whole display instead of one window."
    Write-Host "  -NoLaunch           Never start OBS automatically."
    Write-Host "  -KeepObsOpen        Leave OBS running after stop (default: close it)."
    Write-Host "  -Manual             Force manual recording mode (skip OBS WebSocket)."
    Write-Host "  -VideoPath <path>   Use a specific video file in stop."
    Write-Host "  -NoKeyframes        Skip keyframe extraction in stop."
    Write-Host "  -NoTranscribe       Skip transcription in stop."
    Write-Host "  -ConfigPath <path>  Use an alternate config file."
    Write-Host "  -Seconds <n>        Sampling duration for miccheck (default 8)."
    Write-Host "  -Force              Overwrite config.local.json in init."
    Write-Host "  -Json               Machine-readable output (doctor, windows)."
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
    'miccheck' { $exit = Invoke-MicCheck }
    'windows' { Invoke-Windows; $exit = $script:ExitCode }
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
