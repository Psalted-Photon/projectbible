#!/usr/bin/env pwsh
# Wrapper script to run packtools from repo root

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:WORKSPACE_ROOT = Split-Path -Parent $scriptDir
$packToolsDir = Join-Path -Path $env:WORKSPACE_ROOT -ChildPath "packages\packtools"

Push-Location $packToolsDir
try {
    npx tsx src/cli.ts $args
} finally {
    Pop-Location
}
