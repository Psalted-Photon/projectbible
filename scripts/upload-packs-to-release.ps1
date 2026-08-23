param(
    # Also upload the two ~1.7 GB BSB audio packs.
    [switch]$IncludeAudio
)

# Upload consolidated packs to GitHub release
# Requires GitHub CLI (gh) to be installed and authenticated

$REPO = "Psalted-Photon/ProjectBible"
$TAG = "packs-v1.0.0"
$PACK_DIR = "packs/consolidated"

# Every pack in the directory, so a newly built one cannot be forgotten here --
# a hardcoded list silently dropped art.sqlite and eight others. The audio packs
# are ~1.7 GB each, so they upload only when asked for with -IncludeAudio.
$packs = Get-ChildItem -Path $PACK_DIR -Filter *.sqlite |
    Where-Object { $IncludeAudio -or $_.Name -notlike "bsb-audio-*" } |
    Sort-Object Name |
    Select-Object -ExpandProperty Name

if (-not $packs) {
    Write-Host "No .sqlite packs found in $PACK_DIR" -ForegroundColor Red
    exit 1
}

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
