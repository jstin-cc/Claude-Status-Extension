# sync.ps1 — Sync shared sources to both extension directories
# Edit files in src/ — then run this script to propagate changes.
# Only manifest.json is browser-specific and NOT overwritten.

$shared  = @("shared.js", "content.js", "content.css", "popup.js", "popup.html", "popup.css", "background.js")
$targets = @("claude-status-extension-firefox-v3", "claude-status-extension-chrome-v3")

$root = $PSScriptRoot

foreach ($target in $targets) {
    $dest = Join-Path $root $target
    foreach ($file in $shared) {
        Copy-Item (Join-Path $root "src\$file") (Join-Path $dest $file) -Force
    }
    Copy-Item -Path (Join-Path $root "src\icons\*") -Destination (Join-Path $dest "icons\") -Recurse -Force
    Write-Host "  -> $target synced"
}

Write-Host "Sync complete."
