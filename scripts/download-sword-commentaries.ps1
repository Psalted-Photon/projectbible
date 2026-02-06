# Download Sword Commentary Modules from CrossWire FTP
# Downloads raw ZIP files and extracts them for OSIS conversion

param(
    [string]$OutputDir = "C:\Users\Marlowe\Desktop\ProjectBible\data-sources\commentaries\raw"
)

# Desired commentary modules with their CrossWire IDs
$DESIRED_COMMENTARIES = @{
    "MHC" = "Matthew Henry's Commentary"
    "JFB" = "Jamieson-Fausset-Brown"
    "Barnes" = "Albert Barnes' Notes"
    "Gill" = "John Gill's Expositor"
    "Clarke" = "Adam Clarke Commentary"
    "Wesley" = "John Wesley's Notes"
    "TSK" = "Treasury of Scripture Knowledge"
    "CatenaAurea" = "Catena Aurea"
    "Lightfoot" = "John Lightfoot"
    "Luther" = "Martin Luther"
    "Calvin" = "John Calvin's Commentaries"
    "FamilyBibleNotes" = "Family Bible Notes"
    "Abbott" = "Abbott Illustrated NT"
    "TFG" = "The Fourfold Gospel"
    "RWP" = "Robertson's Word Pictures"
    "KingComments" = "KingComments"
    "QuotingPassages" = "Quoting Passages"
    "NETFree" = "NET Bible Notes"
    "Personal" = "Personal Commentary"
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Sword Commentary Downloader" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Create output directory
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

Write-Host "Downloading commentary modules from CrossWire FTP..." -ForegroundColor Yellow
Write-Host ""

# CrossWire FTP base URL
$ftpBase = "https://www.crosswire.org/ftpmirror/pub/sword/rawzip"

$successCount = 0
$failedModules = @()

foreach ($moduleId in $DESIRED_COMMENTARIES.Keys) {
    $zipUrl = "$ftpBase/$moduleId.zip"
    $zipPath = Join-Path $OutputDir "$moduleId.zip"
    
    Write-Host "[$moduleId] Downloading from $zipUrl..." -ForegroundColor Cyan
    
    try {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -ErrorAction Stop
        Write-Host "  ✓ Downloaded $($DESIRED_COMMENTARIES[$moduleId])" -ForegroundColor Green
        
        # Extract ZIP
        $extractPath = Join-Path $OutputDir $moduleId.ToLower()
        if (-not (Test-Path $extractPath)) {
            New-Item -ItemType Directory -Path $extractPath -Force | Out-Null
        }
        
        Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
        Remove-Item $zipPath
        
        Write-Host "  ✓ Extracted to $extractPath" -ForegroundColor Green
        $successCount++
        
    } catch {
        Write-Host "  ✗ Failed: $_" -ForegroundColor Red
        $failedModules += $moduleId
    }
    
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Download Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Successfully downloaded: $successCount / $($DESIRED_COMMENTARIES.Count)" -ForegroundColor Green

if ($failedModules.Count -gt 0) {
    Write-Host "Failed modules: $($failedModules -join ', ')" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Convert modules to OSIS with mod2osis (requires Sword tools)" -ForegroundColor White
Write-Host "2. Run: node scripts/parse-commentary-sources.mjs" -ForegroundColor White
Write-Host "3. Run: node scripts/build-commentary-pack.mjs" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
