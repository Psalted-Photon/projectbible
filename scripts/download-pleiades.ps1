# Download Pleiades Gazetteer JSON data
# https://atlantides.org/downloads/pleiades/json/

$outputDir = Join-Path $PSScriptRoot "..\data-sources\pleiades"
if (-not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir | Out-Null
}

$url = "https://atlantides.org/downloads/pleiades/json/pleiades-places-latest.json.gz"
$outputFile = Join-Path $outputDir "pleiades-places-latest.json.gz"

Write-Host "Downloading Pleiades gazetteer data (~50MB compressed)..." -ForegroundColor Cyan
Write-Host "URL: $url" -ForegroundColor Gray

try {
    Invoke-WebRequest -Uri $url -OutFile $outputFile -UseBasicParsing
    Write-Host "OK Downloaded to: $outputFile" -ForegroundColor Green
    
    $fileSize = (Get-Item $outputFile).Length / 1MB
    Write-Host "File size: $([Math]::Round($fileSize, 2)) MB" -ForegroundColor Gray
    
    Write-Host "`nExtracting..." -ForegroundColor Cyan
    $jsonFile = Join-Path $outputDir "pleiades-places-latest.json"
    
    # Use 7-Zip if available, otherwise use .NET
    if (Get-Command 7z -ErrorAction SilentlyContinue) {
        & 7z e $outputFile "-o$outputDir" -y
    } else {
        # PowerShell 5.1+ has built-in gzip support
        $gzStream = New-Object System.IO.FileStream($outputFile, [IO.FileMode]::Open)
        $decompressedStream = New-Object System.IO.Compression.GZipStream($gzStream, [IO.Compression.CompressionMode]::Decompress)
        $outStream = New-Object System.IO.FileStream($jsonFile, [IO.FileMode]::Create)
        $decompressedStream.CopyTo($outStream)
        $outStream.Close()
        $decompressedStream.Close()
        $gzStream.Close()
    }
    
    if (Test-Path $jsonFile) {
        $jsonSize = (Get-Item $jsonFile).Length / 1MB
        Write-Host "OK Extracted to: $jsonFile" -ForegroundColor Green
        Write-Host "Extracted size: $([Math]::Round($jsonSize, 2)) MB" -ForegroundColor Gray
        
        Write-Host "`nOK Pleiades data ready for import!" -ForegroundColor Green
        Write-Host "Next step: Run build-pleiades-pack.mjs to create pleiades.sqlite" -ForegroundColor Yellow
    } else {
        Write-Host "ERROR: Extraction failed" -ForegroundColor Red
    }
} catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
    exit 1
}
