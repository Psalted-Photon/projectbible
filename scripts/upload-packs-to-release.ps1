# Upload consolidated packs to GitHub release
# Requires GitHub CLI (gh) to be installed and authenticated

$REPO = "Psalted-Photon/ProjectBible"
$TAG = "packs-v1.0.0"
$PACK_DIR = "packs/consolidated"

# Packs to upload (excluding large audio packs for now)
$packs = @(
    "translations.sqlite",
    "dictionary-en.sqlite",
    "ancient-languages.sqlite",
    "lexical.sqlite",
    "study-tools.sqlite"
)

Write-Host "Uploading consolidated packs to release $TAG..." -ForegroundColor Cyan

foreach ($pack in $packs) {
    $filePath = Join-Path $PACK_DIR $pack
    
    if (Test-Path $filePath) {
        $sizeMB = [math]::Round((Get-Item $filePath).Length / 1MB, 2)
        Write-Host "Uploading $pack ($sizeMB MB)..." -ForegroundColor Yellow
        
        # Upload using GitHub CLI
        gh release upload $TAG $filePath --repo $REPO --clobber
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Uploaded $pack successfully" -ForegroundColor Green
        } else {
            Write-Host "Failed to upload $pack" -ForegroundColor Red
        }
    } else {
        Write-Host "File not found: $filePath" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Done! Check the release at:" -ForegroundColor Cyan
Write-Host "https://github.com/$REPO/releases/tag/$TAG" -ForegroundColor Cyan
