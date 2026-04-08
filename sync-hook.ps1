# sync-hook.ps1 — PostToolUse hook: auto-sync src/ after edits
# Reads Claude Code hook JSON from stdin, runs sync.ps1 if a src/ file was changed.
$data = $input | ConvertFrom-Json
$f = $data.tool_input.file_path
if ($f -like '*/src/*' -or $f -like '*\src\*' -or $f -like 'src/*' -or $f -like 'src\*') {
    & "$PSScriptRoot\sync.ps1"
}
