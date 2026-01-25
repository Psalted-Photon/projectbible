# Upload manifest.json to GitHub release
# Simple script using curl.exe for reliable uploads

$REPO = "Psalted-Photon/projectbible"
$TAG = "packs-v1.0.0"
$MANIFEST_FILE = "packs/consolidated/manifest.json"

Write-Host "Uploading manifest.json to release $TAG..." -ForegroundColor Cyan

# Get the release ID and upload URL
Write-Host "Fetching release info..." -ForegroundColor Yellow
$releaseInfo = curl.exe -s "https://api.github.com/repos/$REPO/releases/tags/$TAG" | ConvertFrom-Json

if (-not $releaseInfo) {
    Write-Host "ERROR: Could not fetch release info. Release may not exist." -ForegroundColor Red
    exit 1
}

$releaseId = $releaseInfo.id
$uploadUrl = $releaseInfo.upload_url -replace '\{\?name,label\}', ''

Write-Host "Release ID: $releaseId" -ForegroundColor Green
Write-Host "Upload URL: $uploadUrl" -ForegroundColor Green

# Delete existing manifest.json if it exists
Write-Host "`nChecking for existing manifest.json..." -ForegroundColor Yellow
$existingAsset = $releaseInfo.assets | Where-Object { $_.name -eq "manifest.json" }

if ($existingAsset) {
    Write-Host "Found existing manifest.json (Asset ID: $($existingAsset.id))" -ForegroundColor Yellow
    Write-Host "Deleting old manifest..." -ForegroundColor Yellow
    
    # Use git credential helper to get token
    $output = ""
    $process = Start-Process -FilePath "git" -ArgumentList "credential", "fill" -NoNewWindow -PassThru -RedirectStandardInput "temp_input.txt" -RedirectStandardOutput "temp_output.txt" -Wait
    
    "protocol=https`nhost=github.com`n" | Out-File -FilePath "temp_input.txt" -Encoding ascii
    Start-Sleep -Seconds 1
    $output = Get-Content "temp_output.txt" -Raw
    Remove-Item "temp_input.txt", "temp_output.txt" -ErrorAction SilentlyContinue
    
    if ($output -match "password=([^\r\n]+)") {
        $token = $matches[1]
        
        $deleteResult = curl.exe -s -X DELETE `
            -H "Authorization: Bearer $token" `
            -H "Accept: application/vnd.github+json" `
            "https://api.github.com/repos/$REPO/releases/assets/$($existingAsset.id)"
        
        Write-Host "Deleted old manifest" -ForegroundColor Green
        Start-Sleep -Seconds 2
    } else {
        Write-Host "WARNING: Could not get auth token. Continuing anyway..." -ForegroundColor Yellow
    }
}

# Upload new manifest
Write-Host "`nUploading new manifest.json..." -ForegroundColor Yellow

if (Test-Path $MANIFEST_FILE) {
    $fileSize = [math]::Round((Get-Item $MANIFEST_FILE).Length / 1KB, 2)
    Write-Host "File size: $fileSize KB" -ForegroundColor Cyan
    
    # Try upload without auth first (works for public repos)
    $uploadResult = curl.exe -s -X POST `
        -H "Content-Type: application/json" `
        "$uploadUrl?name=manifest.json" `
        --data-binary "@$MANIFEST_FILE"
    
    $result = $uploadResult | ConvertFrom-Json
    
    if ($result.browser_download_url) {
        Write-Host "`nSUCCESS! Manifest uploaded:" -ForegroundColor Green
        Write-Host "  Name: $($result.name)" -ForegroundColor Cyan
        Write-Host "  Size: $($result.size) bytes" -ForegroundColor Cyan
        Write-Host "  URL: $($result.browser_download_url)" -ForegroundColor Cyan
        Write-Host "`nDone! View the release at:" -ForegroundColor Green
        Write-Host "https://github.com/$REPO/releases/tag/$TAG" -ForegroundColor Cyan
    } else {
        Write-Host "Upload may have failed. Result:" -ForegroundColor Red
        Write-Host $uploadResult -ForegroundColor Yellow
    }
} else {
    Write-Host "ERROR: File not found: $MANIFEST_FILE" -ForegroundColor Red
    exit 1
}
