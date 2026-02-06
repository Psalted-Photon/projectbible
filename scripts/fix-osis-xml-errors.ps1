#!/usr/bin/env pwsh
# Fix common XML errors in OSIS files

$osisDir = "C:\Users\Marlowe\Desktop\ProjectBible\data-sources\commentaries\osis"

$filesToFix = @(
    "barnes.osis.xml",
    "calvincommentaries.osis.xml",
    "family.osis.xml",
    "tfg.osis.xml",
    "tsk.osis.xml",
    "wesley.osis.xml"
)

foreach ($file in $filesToFix) {
    $filePath = Join-Path $osisDir $file
    
    if (-not (Test-Path $filePath)) {
        Write-Host "Skipping $file - not found"
        continue
    }
    
    Write-Host "Fixing $file..."
    
    $content = Get-Content $filePath -Raw
    
    # Fix common XML issues
    # 1. Fix malformed entities (& not followed by valid entity)
    $content = $content -replace '&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)', '&amp;'
    
    # 2. Remove incomplete/broken tags at line endings
    $content = $content -replace '<\s*$', ''
    $content = $content -replace '<\s*\r?\n', ''
    
    # 3. Fix attributes without values (attr= followed by space or >)
    $content = $content -replace '(\w+)=\s*([>\s])', '$1=""$2'
    
    # 4. Remove orphaned closing tags (>) without opening
    $content = $content -replace '(?<!<[^>]{0,500})>\s*>', '>'
    
    # 5. Fix common broken scripture references
    $content = $content -replace '<scripRef\s+([^>]*?)(?<!/)>(\s*)</scripRef>', '<scripRef $1/>'
    
    # Write back
    Set-Content -Path $filePath -Value $content -NoNewline
    
    Write-Host "  Done"
}

Write-Host ""
Write-Host "XML fixes applied!"
