#!/usr/bin/env pwsh
# Download specific CrossWire commentary modules (retry failed ones)

$MODULES = @(
    'Barnes',
    'CalvinCommentaries', 
    'Family',
    'TFG',
    'TSK'
)

$RAW_DIR = "C:\Users\Marlowe\Desktop\ProjectBible\data-sources\commentaries\raw"
$BASE_URL = "https://crosswire.org/ftpmirror/pub/sword/packages/rawzip"

Write-Host "Downloading $($MODULES.Count) commentary modules from CrossWire...`n"

foreach ($module in $MODULES) {
    $zipFile = Join-Path $RAW_DIR "$module.zip"
    $url = "$BASE_URL/$module.zip"
    
    Write-Host "Downloading $module..."
    
    try {
        Invoke-WebRequest -Uri $url -OutFile $zipFile -ErrorAction Stop
        $size = (Get-Item $zipFile).Length / 1MB
        Write-Host "  Downloaded: $([math]::Round($size, 2)) MB"
    }
    catch {
        Write-Host "  Failed: $_" -ForegroundColor Red
    }
}

Write-Host "`nDownload complete!"
