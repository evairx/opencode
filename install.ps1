<#
.SYNOPSIS
    evairx opencode installer (Windows).
.DESCRIPTION
    Installs the evairx opencode fork (build 1.0 / identity evairx-1.0) as the
    global `opencode`.

    Default (replace-only):
      1. Detects an already installed opencode.
      2. Replaces the global binary with this build at ~\.opencode\bin.
      3. Makes sure ~\.opencode\bin is first on the user PATH.
      Your config files and plugins are NOT touched.

    Optional cleanup (-Clean):
      Backs up the whole opencode config/data folders to
      ~\.opencode-evairx-backups\<timestamp>\ and removes previous "custom"
      provider/model sections from the global opencode config (plugins and
      everything else are preserved). Safe and reversible.

    The official package-manager installs (npm/scoop/choco) are not removed;
    this installer owns ~\.opencode\bin and wins when it is earlier on PATH.
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File install.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File install.ps1 -Force
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File install.ps1 -Clean
#>
param(
    [string]$Version = "1.0",
    [string]$Repo = "evairx/opencode",
    [switch]$Force,
    [switch]$Clean,
    [switch]$SkipBackup,
    [switch]$NoModifyPath,
    [switch]$SkipPath
)

$ErrorActionPreference = "Stop"

$IDENTITY = "evairx-1.0"
$INSTALL_DIR = Join-Path $HOME ".opencode\bin"
$ASSET = "opencode-windows-x64.zip"
$URL = "https://github.com/$Repo/releases/download/v$Version/$ASSET"

$MUTED = "$([char]0x1b)[2m"
$GREEN = "$([char]0x1b)[32m"
$RED = "$([char]0x1b)[31m"
$NC = "$([char]0x1b)[0m"

function Write-Step($message) { Write-Host "${GREEN}==>${NC} $message" }
function Write-Info($message) { Write-Host "${MUTED}$message${NC}" }
function Write-Warn($message) { Write-Host "${RED}WARN:${NC} $message" }

# ---------------------------------------------------------------- helpers
function Get-CurrentOpenCode {
    $cmd = Get-Command opencode -ErrorAction SilentlyContinue
    return $cmd
}

function Test-OpencodeRunning {
    return @(Get-Process -Name "opencode" -ErrorAction SilentlyContinue).Count -gt 0
}

function Add-ToUserPath([string]$dir) {
    if ($NoModifyPath -or $SkipPath) { return }
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $needle = ($userPath + ";").ToLowerInvariant()
    if ($needle.Contains($dir.ToLowerInvariant() + ";")) {
        Write-Info "PATH already contains $dir"
        return
    }
    # Prepend so this install wins over any other opencode (npm, scoop, choco).
    $newPath = if ($userPath) { "$dir;$userPath" } else { $dir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    Write-Info "Prepended $dir to your user PATH (new terminals only)."
}

# ------------------------------------------------------------------ backup
function Backup-Previous([string]$configDir, [string]$dataDir) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $root = Join-Path $HOME ".opencode-evairx-backups"
    $backup = Join-Path $root $stamp
    New-Item -ItemType Directory -Path $backup -Force | Out-Null

    foreach ($src in @($configDir, $dataDir)) {
        if (-not (Test-Path -LiteralPath $src)) { continue }
        $name = Split-Path -Leaf $src
        $dest = Join-Path $backup $name
        Write-Info "Backing up $src -> $dest"
        Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force
    }
    Write-Step "Backup created at $backup"
    return $backup
}

function Clear-CustomProviders([string]$configDir) {
    $jsonPath = $null
    foreach ($candidate in @(
            (Join-Path $configDir "opencode.json"),
            (Join-Path $configDir "opencode.jsonc")
        )) {
        if (Test-Path -LiteralPath $candidate) { $jsonPath = $candidate; break }
    }
    if (-not $jsonPath) { return }

    $raw = Get-Content -LiteralPath $jsonPath -Raw
    try {
        $null = $raw | ConvertFrom-Json
    } catch {
        Write-Warn "opencode.json has comments (jsonc); leaving it untouched (it is fully backed up)."
        return
    }

    $obj = $raw | ConvertFrom-Json
    $changed = $false
    foreach ($key in @("provider", "providers")) {
        if ($null -ne $obj.PSObject.Properties[$key]) {
            $obj.PSObject.Properties.Remove($key)
            $changed = $true
        }
    }
    if (-not $changed) {
        Write-Info "No custom provider/model blocks to clean."
        return
    }
    # re-serialize with 2-space indent (opencode accepts standard JSON too)
    $out = $obj | ConvertTo-Json -Depth 64
    Set-Content -LiteralPath $jsonPath -Value $out -Encoding UTF8
    Write-Info "Removed custom provider/model sections from $jsonPath (plugins preserved)."
}

# --------------------------------------------------------------- install
function Install-Binary {
    Write-Step "Downloading opencode v$Version ($ASSET)"
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) "evairx-opencode-install"
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force }
    New-Item -ItemType Directory -Path $tmp | Out-Null
    $zip = Join-Path $tmp $ASSET
    try {
        Invoke-WebRequest -Uri $URL -OutFile $zip -UseBasicParsing
    } catch {
        Write-Warn "Download failed: $($_.Exception.Message)"
        Write-Warn "Check the release exists: https://github.com/$Repo/releases/tag/v$Version"
        exit 1
    }

    Write-Step "Extracting and installing to $INSTALL_DIR"
    New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    $exe = Get-ChildItem -LiteralPath $tmp -Recurse -Filter "opencode.exe" | Select-Object -First 1
    if (-not $exe) {
        Write-Warn "opencode.exe was not found inside the archive."
        exit 1
    }
    Copy-Item -LiteralPath $exe.FullName -Destination (Join-Path $INSTALL_DIR "opencode.exe") -Force
    Remove-Item -LiteralPath $tmp -Recurse -Force

    $versionOutput = & (Join-Path $INSTALL_DIR "opencode.exe") --version 2>$null
    Write-Step "Installed. Version reported: $versionOutput"
    if ($versionOutput -and $versionOutput.Trim() -ne $IDENTITY) {
        Write-Warn "Unexpected version string ($versionOutput). Expected '$IDENTITY'."
    }
}

# ------------------------------------------------------------------ main
$configDir = Join-Path $HOME ".config\opencode"
$dataDir = Join-Path $HOME ".local\share\opencode"

$installed = Get-CurrentOpenCode
if ($installed) {
    Write-Step "Found an existing opencode: $($installed.Source)"
    if (-not $Force -and (Test-Path -LiteralPath (Join-Path $INSTALL_DIR "opencode.exe"))) {
        $current = (& (Join-Path $INSTALL_DIR "opencode.exe") --version 2>$null).Trim()
        if ($current -eq $IDENTITY) {
            Write-Info "evairx-1.0 is already installed. Use -Force to reinstall."
            exit 0
        }
    }
    if ((Test-OpencodeRunning) -and -not $Force) {
        Write-Warn "opencode is currently running. Close it first, or pass -Force."
        exit 1
    }
    Write-Info "Config files and plugins are preserved (replace-only)."
    if ($Clean) {
        if (-not $SkipBackup) {
            Backup-Previous $configDir $dataDir | Out-Null
        }
        Clear-CustomProviders $configDir
    }
} else {
    Write-Info "No opencode found on PATH. Installing fresh."
}

Install-Binary
Add-ToUserPath $INSTALL_DIR

Write-Host ""
Write-Host "${GREEN}evairx opencode installed.${NC}"
Write-Host "${MUTED}Run 'opencode' in a new terminal to start. Version: evairx-1.0${NC}"
Write-Host ""
