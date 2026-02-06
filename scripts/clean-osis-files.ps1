#!/usr/bin/env pwsh
# Remove mod2osis warning and unprocessed tokens from OSIS files

$osisDir = "C:\Users\Marlowe\Desktop\ProjectBible\data-sources\commentaries\osis"

Get-ChildItem "$osisDir\*.osis.xml" | ForEach-Object {
    Write-Host "Cleaning $($_.Name)..."
    
    $content = Get-Content $_.FullName -Raw
    
    # Find the start of the actual XML
    $xmlStart = $content.IndexOf('<?xml')
    
    if ($xmlStart -gt 0) {
        $content = $content.Substring($xmlStart)
    }
    
    # Remove Unprocessed Token lines
    $content = $content -replace '(?m)^Unprocessed Token:.*$\r?\n', ''
    
    # Write cleaned content back
    Set-Content -Path $_.FullName -Value $content -NoNewline
    
    Write-Host "  Done"
}

Write-Host ""
Write-Host "All files cleaned"
