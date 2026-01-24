# Create GitHub release and upload packs using API
# Usage: Set $env:GITHUB_TOKEN before running

param(
    [string]$Token = $env:GITHUB_TOKEN
)

if (-not $Token) {
    Write-Host "ERROR: GitHub token not found. Set GITHUB_TOKEN environment variable." -ForegroundColor Red
    exit 1
}

$REPO_OWNER = "Psalted-Photon"
$REPO_NAME = "projectbible"
$TAG = "packs-v1.0.0"
$RELEASE_NAME = "Consolidated Packs v1.0.0"
$PACK_DIR = "packs/consolidated"

$headers = @{
    "Authorization" = "Bearer $Token"
    "Accept" = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

# Step 1: Create the release
Write-Host "Creating release $TAG..." -ForegroundColor Cyan

$releaseBody = @{
    tag_name = $TAG
    name = $RELEASE_NAME
    body = "Consolidated Bible study packs for ProjectBible PWA. Includes translations, lexicons, study tools, and dictionaries."
    draft = $false
    prerelease = $false
} | ConvertTo-Json

try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases" `
        -Method Post `
        -Headers $headers `
        -Body $releaseBody `
        -ContentType "application/json"
    
    Write-Host "Release created successfully!" -ForegroundColor Green
    $uploadUrl = $release.upload_url -replace '\{\?name,label\}', ''
} catch {
    if ($_.Exception.Response.StatusCode -eq 422) {
        Write-Host "Release already exists, fetching it..." -ForegroundColor Yellow
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/tags/$TAG" `
            -Headers $headers
        $uploadUrl = $release.upload_url -replace '\{\?name,label\}', ''
    } else {
        Write-Host "Failed to create release: $_" -ForegroundColor Red
        exit 1
    }
}

# Step 2: Upload manifest.json first
Write-Host ""
Write-Host "Uploading manifest.json..." -ForegroundColor Cyan
$manifestPath = Join-Path $PACK_DIR "manifest.json"

if (Test-Path $manifestPath) {
    $manifestBytes = [System.IO.File]::ReadAllBytes($manifestPath)
    $manifestSize = [math]::Round($manifestBytes.Length / 1KB, 2)
    
    try {
        $uploadHeaders = $headers.Clone()
        $uploadHeaders["Content-Type"] = "application/json"
        
        Invoke-RestMethod -Uri "$uploadUrl?name=manifest.json" `
            -Method Post `
            -Headers $uploadHeaders `
            -Body $manifestBytes | Out-Null
        
        Write-Host "  Uploaded manifest.json ($manifestSize KB)" -ForegroundColor Green
    } catch {
        Write-Host "  Failed to upload manifest.json: $_" -ForegroundColor Red
    }
} else {
    Write-Host "  manifest.json not found at $manifestPath" -ForegroundColor Red
}

# Step 3: Upload SQLite packs
$packs = @(
    "translations.sqlite",
    "dictionary-en.sqlite", 
    "ancient-languages.sqlite",
    "lexical.sqlite",
    "study-tools.sqlite"
)

Write-Host ""
Write-Host "Uploading consolidated packs..." -ForegroundColor Cyan

foreach ($pack in $packs) {
    $filePath = Join-Path $PACK_DIR $pack
    
    if (Test-Path $filePath) {
        $sizeMB = [math]::Round((Get-Item $filePath).Length / 1MB, 2)
        Write-Host "  Uploading $pack ($sizeMB MB)..." -ForegroundColor Yellow
        
        try {
            $packBytes = [System.IO.File]::ReadAllBytes($filePath)
            
            $uploadHeaders = $headers.Clone()
            $uploadHeaders["Content-Type"] = "application/x-sqlite3"
            
            Invoke-RestMethod -Uri "$uploadUrl?name=$pack" `
                -Method Post `
                -Headers $uploadHeaders `
                -Body $packBytes | Out-Null
            
            Write-Host "  Uploaded $pack successfully" -ForegroundColor Green
        } catch {
            Write-Host "  Failed to upload $pack: $_" -ForegroundColor Red
        }
    } else {
        Write-Host "  File not found: $filePath" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Done! View the release at:" -ForegroundColor Cyan
Write-Host "https://github.com/$REPO_OWNER/$REPO_NAME/releases/tag/$TAG" -ForegroundColor Cyan
