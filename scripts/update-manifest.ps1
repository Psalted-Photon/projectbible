# Update manifest.json on GitHub release
$ErrorActionPreference = "Stop"

$repo = "Psalted-Photon/projectbible"
$tag = "packs-v1.0.0"
$manifestPath = Join-Path $PSScriptRoot "..\packs\consolidated\manifest.json"

Write-Host "Getting GitHub token..."
$token = $null

# Try to get token from git credential helper
$credHelper = git config --get credential.https://github.com.helper
if ($credHelper) {
    $input = "protocol=https`nhost=github.com`n`n"
    $credOutput = $input | git credential fill 2>$null
    $token = ($credOutput | Where-Object {$_ -match '^password='} | ForEach-Object {$_.Substring(9)}) | Select-Object -First 1
}

if (-not $token) {
    Write-Error "Could not get GitHub token. Please run: gh auth login"
    exit 1
}

Write-Host "Got token"
$headers = @{
    "Authorization" = "Bearer $token"
    "Accept" = "application/vnd.github+json"
}

# Get release info
Write-Host "Fetching release info..."
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$tag" -Headers $headers

# Find and delete existing manifest.json
$manifestAsset = $release.assets | Where-Object { $_.name -eq "manifest.json" }
if ($manifestAsset) {
    Write-Host "Deleting old manifest.json (Asset ID: $($manifestAsset.id))..."
    Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/assets/$($manifestAsset.id)" -Method Delete -Headers $headers
    Write-Host "Deleted"
    Start-Sleep -Seconds 2
}

# Upload new manifest
Write-Host "Uploading new manifest.json..."
$uploadUrl = $release.upload_url.Replace('{?name,label}', '') + "?name=manifest.json"
$uploadHeaders = $headers.Clone()
$uploadHeaders["Content-Type"] = "application/json"

$manifestBytes = [System.IO.File]::ReadAllBytes($manifestPath)
Invoke-RestMethod -Uri $uploadUrl -Method Post -Headers $uploadHeaders -Body $manifestBytes

Write-Host "✅ Manifest updated successfully!"
