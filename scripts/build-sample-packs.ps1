#!/usr/bin/env pwsh
# Build sample packs for development

Write-Host "Building sample packs..." -ForegroundColor Cyan
Write-Host ""

# Create output directory
if (-not (Test-Path "packs")) {
    New-Item -ItemType Directory -Path "packs" | Out-Null
}

# Build KJV sample
Write-Host "📦 Building KJV sample pack..." -ForegroundColor Green
Set-Location packages/packtools
npx tsx src/cli.ts build ../../data-manifests/samples/kjv-sample.json -o ../../packs/kjv-sample-dev.sqlite
Set-Location ../..

# Build WEB sample
Write-Host "📦 Building WEB sample pack..." -ForegroundColor Green
Set-Location packages/packtools
npx tsx src/cli.ts build ../../data-manifests/samples/web-sample.json -o ../../packs/web-sample-dev.sqlite
Set-Location ../..

Write-Host ""
Write-Host "✅ Sample packs built successfully!" -ForegroundColor Green
Write-Host "   - packs/kjv-sample-dev.sqlite"
Write-Host "   - packs/web-sample-dev.sqlite"
