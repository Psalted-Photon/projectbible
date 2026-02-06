# Download Sword Commentary Modules from CrossWire
# Parses the official module list and downloads English commentaries

param(
    [string]$OutputDir = "C:\Users\Marlowe\Desktop\ProjectBible\data-sources\commentaries\raw"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "CrossWire Commentary Downloader" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Create output directory
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

# Define the modules we want (based on user's request)
$DESIRED_MODULES = @(
    "MHC",           # Matthew Henry's Commentary
    "JFB",           # Jamieson-Fausset-Brown
    "Barnes",        # Albert Barnes' Notes
    "Gill",          # John Gill's Expositor
    "Clarke",        # Adam Clarke Commentary
    "Wesley",        # John Wesley's Notes
    "TSK",           # Treasury of Scripture Knowledge
    "CatenaAurea",   # Catena Aurea (seems not available)
    "Lightfoot",     # John Lightfoot
    "Luther",        # Martin Luther (may be German)
    "Calvin",        # John Calvin's Commentaries
    "Abbott",        # Abbott Illustrated NT
    "TFG",           # The Fourfold Gospel
    "RWP",           # Robertson's Word Pictures
    "Personal"       # Personal Commentary
)

Write-Host "Fetching module list from CrossWire..." -ForegroundColor Yellow

# Download the module list page
$listUrl = "https://www.crosswire.org/sword/modules/ModDisp.jsp?modType=Commentaries"
try {
    $htmlContent = Invoke-WebRequest -Uri $listUrl -UseBasicParsing
} catch {
    Write-Host "Failed to fetch module list: $_" -ForegroundColor Red
    exit 1
}

Write-Host "Parsing English commentary modules..." -ForegroundColor Yellow
Write-Host ""

# Extract all zip links from the HTML
$allLinks = [regex]::Matches($htmlContent.Content, 'href="(https://www\.crosswire\.org/ftpmirror/pub/sword/packages/rawzip/([^"]+?)\.zip)"')

# English commentary modules available on CrossWire (actual module IDs)
$commonModules = @{
    "Abbott" = "Abbott's Illustrated NT"
    "Barnes" = "Albert Barnes' Notes"
    "Burkitt" = "Burkitt Expository Notes"
    "CalvinCommentaries" = "John Calvin's Commentaries"
    "Catena" = "Catena Aurea"
    "Clarke" = "Adam Clarke Commentary"
    "DTN" = "Darby Translation Notes"
    "Family" = "Family Bible Notes"
    "Geneva" = "Geneva Bible Notes"
    "Gill" = "John Gill's Expositor"
    "JFB" = "Jamieson-Fausset-Brown"
    "KingComments" = "KingComments"
    "Lightfoot" = "John Lightfoot"
    "Luther" = "Martin Luther Commentary"
    "MHC" = "Matthew Henry Complete"
    "MHCC" = "Matthew Henry Concise"
    "NETnotesfree" = "NET Bible Notes (Free)"
    "Personal" = "Personal Commentary"
    "Poole" = "Matthew Poole Commentary"
    "QuotingPassages" = "Quoting Passages"
    "RWP" = "Robertson's Word Pictures"
    "Scofield" = "Scofield Reference Notes"
    "TSK" = "Treasury of Scripture Knowledge"
    "TFG" = "The Fourfold Gospel"
    "Wesley" = "John Wesley's Notes"
}

$successCount = 0
$failedModules = @()
$downloadedModules = @()

# Extract all module links from the English section
$enMatch = [regex]::Match($htmlContent.Content, '(?s)<br id="lang_en".+?(?:<br id="lang_|$)')
$enSection = $enMatch.Value

# Find all module names in the English section
$moduleMatches = [regex]::Matches($enSection, 'HREF="/sword/servlet/SwordMod\.Verify\?modName=([^&]+)')

foreach ($match in $moduleMatches) {
    $moduleId = $match.Groups[1].Value
    
    # Check if this is one of our common modules
    if ($commonModules.ContainsKey($moduleId)) {
        $moduleName = $commonModules[$moduleId]
        $zipUrl = "https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/$moduleId.zip"
        $zipPath = Join-Path $OutputDir "$moduleId.zip"
        
        Write-Host "[$moduleId] Downloading $moduleName..." -ForegroundColor Cyan
        Write-Host "  URL: $zipUrl" -ForegroundColor Gray
        
        try {
            Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -ErrorAction Stop
            Write-Host "  ✓ Downloaded" -ForegroundColor Green
            
            # Extract ZIP
            $extractPath = Join-Path $OutputDir $moduleId.ToLower()
            if (-not (Test-Path $extractPath)) {
                New-Item -ItemType Directory -Path $extractPath -Force | Out-Null
            }
            
            Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
            Remove-Item $zipPath
            
            Write-Host "  ✓ Extracted to $extractPath" -ForegroundColor Green
            $successCount++
            $downloadedModules += $moduleId
            
        } catch {
            Write-Host "  ✗ Failed: $_" -ForegroundColor Red
            $failedModules += $moduleId
        }
        
        Write-Host ""
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Download Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Successfully downloaded: $successCount modules" -ForegroundColor Green
Write-Host "Downloaded: $($downloadedModules -join ', ')" -ForegroundColor White

if ($failedModules.Count -gt 0) {
    Write-Host "Failed modules: $($failedModules -join ', ')" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Modules saved to: $OutputDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Convert Sword modules to OSIS XML" -ForegroundColor White
Write-Host "2. Run: node scripts/parse-commentary-sources.mjs" -ForegroundColor White
Write-Host "3. Run: node scripts/build-commentary-pack.mjs" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
