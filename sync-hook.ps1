# sync-hook.ps1 — PostToolUse hook: auto-build after src/ edits
# Reads Claude Code hook JSON from stdin, runs the build if a src/ file changed.
$data = $input | ConvertFrom-Json
$f = $data.tool_input.file_path
if ($f -like '*/src/*' -or $f -like '*\src\*' -or $f -like 'src/*' -or $f -like 'src\*') {
    node (Join-Path $PSScriptRoot 'scripts/build.js')
}
