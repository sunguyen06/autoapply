param([switch]$Submit)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
& node src/cli.js discover --headless
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$applyArgs = @('src/cli.js', 'apply', '--headless')
if ($Submit) { $applyArgs += '--submit' }
& node @applyArgs
exit $LASTEXITCODE
