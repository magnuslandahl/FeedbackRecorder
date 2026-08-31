#Requires -Version 5.1
<#
.SYNOPSIS
    Install the obs-review-recorder skill for the current user.

.DESCRIPTION
    Generates the user-level skill from skill\SKILL.md instead of copying it, so
    the repository stays the single source of truth.

    The repository skill assumes the current directory is the repository root.
    An installed skill is invoked from wherever the user happens to be working -
    normally the repository of the app being reviewed - so every repo-relative
    path is rewritten to an absolute one. review-recorder.ps1 anchors config,
    .venv and runs\ to its own location, so it is safe to call from any
    directory once the path is absolute.

    Every rewrite is asserted. If a future edit to SKILL.md removes something
    this script expects, installation fails loudly rather than silently
    producing a skill with paths that do not resolve.

.EXAMPLE
    .\scripts\install-skill.ps1
    .\scripts\install-skill.ps1 -WhatIf
    .\scripts\install-skill.ps1 -Uninstall
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$SkillsRoot,
    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot  = Split-Path -Parent $PSScriptRoot
$skillName = 'obs-review-recorder'

if (-not $SkillsRoot) { $SkillsRoot = Join-Path $env:USERPROFILE '.copilot\skills' }
$target    = Join-Path $SkillsRoot $skillName
$targetDoc = Join-Path $target 'SKILL.md'

function Write-Ok   { param([string]$T) Write-Host "  [ OK ]  $T" -ForegroundColor Green }
function Write-Bad  { param([string]$T) Write-Host "  [MISS]  $T" -ForegroundColor Red }
function Write-Info { param([string]$T) Write-Host "  $T" -ForegroundColor Gray }
function Write-Head { param([string]$T) Write-Host ''; Write-Host $T -ForegroundColor Cyan }

if ($Uninstall) {
    Write-Head "Uninstall $skillName"
    if (Test-Path $target) {
        if ($PSCmdlet.ShouldProcess($target, 'Remove skill')) {
            Remove-Item -Path $target -Recurse -Force
            Write-Ok "Removed $target"
        }
    }
    else {
        Write-Info "Not installed: $target"
    }
    exit 0
}

Write-Head "Install $skillName"

$sourceDoc = Join-Path $repoRoot 'skill\SKILL.md'
if (-not (Test-Path $sourceDoc)) {
    Write-Bad "Source skill not found: $sourceDoc"
    exit 1
}

$text = Get-Content -Path $sourceDoc -Raw -Encoding UTF8

# Ordered so that the longest, most specific patterns run first: rewriting
# '.venv\Scripts\python.exe' before '.venv' keeps the shorter rule from
# corrupting the longer path.
$rules = @(
    @{ Name = 'intro paragraph'
       Find = 'All commands run from the repository root on Windows PowerShell.'
       Replace = @"
The recorder lives at ``$repoRoot``. Always invoke it by its absolute path, as
shown below: it resolves its config, virtualenv and ``runs\`` folder relative to
its own location, so the current directory does not matter. That matters here,
because you are normally standing in the repository of the app being reviewed,
not in the recorder's own repository.
"@
       Min = 1 }

    @{ Name = 'CLI invocations'
       Find = '.\scripts\review-recorder.ps1'
       Replace = "& '$repoRoot\scripts\review-recorder.ps1'"
       Min = 8 }

    @{ Name = 'venv python'
       Find = '.\.venv\Scripts\python.exe'
       Replace = "& '$repoRoot\.venv\Scripts\python.exe'"
       Min = 1 }

    @{ Name = 'venv creation'
       Find = 'py -3.12 -m venv .venv'
       Replace = "py -3.12 -m venv '$repoRoot\.venv'"
       Min = 1 }

    @{ Name = 'agent prompt example'
       Find = 'skill/examples/app-review-agent-prompt.md'
       Replace = "$repoRoot\skill\examples\app-review-agent-prompt.md"
       Min = 1 }

    @{ Name = 'config file'
       Find = '`config.local.json`'
       Replace = "``$repoRoot\config.local.json``"
       Min = 2 }
)

$failed = $false
foreach ($rule in $rules) {
    $count = ([regex]::Matches($text, [regex]::Escape($rule.Find))).Count
    if ($count -lt $rule.Min) {
        Write-Bad ("{0}: expected at least {1} occurrence(s) of '{2}', found {3}" -f $rule.Name, $rule.Min, $rule.Find, $count)
        $failed = $true
        continue
    }
    $text = $text.Replace($rule.Find, $rule.Replace)
    Write-Ok ("{0}: rewrote {1} occurrence(s) to an absolute path" -f $rule.Name, $count)
}

if ($failed) {
    Write-Host ''
    Write-Bad 'skill\SKILL.md no longer matches what this installer expects.'
    Write-Info 'Update the rules in scripts\install-skill.ps1 to match, then reinstall.'
    Write-Info 'Nothing was written.'
    exit 1
}

# A leftover repo-relative path would only fail once the user is mid-review.
$leftovers = [regex]::Matches($text, '(?m)^.*(?<![\w''])\.\\(scripts|\.venv|runs)\\.*$')
if ($leftovers.Count -gt 0) {
    Write-Host ''
    Write-Bad 'Repo-relative paths remain after rewriting; they would break outside the repo:'
    foreach ($m in $leftovers) { Write-Info $m.Value.Trim() }
    Write-Info 'Nothing was written.'
    exit 1
}

$banner = @"
<!--
    Generated by scripts\install-skill.ps1 from
    $sourceDoc
    Do not edit this file: edit the source and reinstall, or your changes are
    lost on the next install.
-->

"@

# Keep the YAML frontmatter first, or the skill is not discovered.
$fm = [regex]::Match($text, '(?s)\A---\r?\n.*?\r?\n---\r?\n')
if (-not $fm.Success) {
    Write-Bad 'Could not find the end of the YAML frontmatter in skill\SKILL.md.'
    exit 1
}
$split = $fm.Length
$text = $text.Substring(0, $split) + $banner + $text.Substring($split)

if ($PSCmdlet.ShouldProcess($targetDoc, 'Write skill')) {
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    # No BOM: some readers treat a leading BOM as content and miss the frontmatter.
    [System.IO.File]::WriteAllText($targetDoc, $text, (New-Object System.Text.UTF8Encoding($false)))
    Write-Ok "Wrote $targetDoc"

    Write-Host ''
    Write-Ok 'Installed.'
    Write-Info 'Restart Copilot CLI to pick up the new skill.'
    Write-Info 'Then ask it to "record an app review" from any repository.'
}
