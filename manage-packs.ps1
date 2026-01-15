# Pack Management Script
# Helps move packs between workbench and polished directories

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("promote", "demote", "list", "clean")]
    [string]$Action,
    
    [Parameter(Mandatory=$false)]
    [string]$PackName
)

$WorkbenchDir = "packs\workbench"
$PolishedDir = "packs\polished"

function List-Packs {
    Write-Host "`n[WORKBENCH PACKS] Testing" -ForegroundColor Green
    Write-Host "=" * 50
    if (Test-Path $WorkbenchDir) {
        $workbenchPacks = Get-ChildItem -Path $WorkbenchDir -Filter "*.sqlite"
        if ($workbenchPacks.Count -eq 0) {
            Write-Host "  (none)" -ForegroundColor Gray
        } else {
            foreach ($pack in $workbenchPacks) {
                $sizeMB = [math]::Round($pack.Length / 1MB, 2)
                Write-Host "  $($pack.Name) ($sizeMB MB)" -ForegroundColor White
            }
        }
    }
    
    Write-Host "`n[POLISHED PACKS] Will be bundled" -ForegroundColor Cyan
    Write-Host "=" * 50
    if (Test-Path $PolishedDir) {
        $polishedPacks = Get-ChildItem -Path $PolishedDir -Filter "*.sqlite"
        if ($polishedPacks.Count -eq 0) {
            Write-Host "  (none)" -ForegroundColor Gray
        } else {
            foreach ($pack in $polishedPacks) {
                $sizeMB = [math]::Round($pack.Length / 1MB, 2)
                Write-Host "  $($pack.Name) ($sizeMB MB)" -ForegroundColor White
            }
        }
    }
    Write-Host ""
}

function Promote-Pack {
    param([string]$Name)
    
    if (-not $Name) {
        Write-Host "ERROR: Pack name required" -ForegroundColor Red
        Write-Host "Usage: manage-packs.ps1 promote packname.sqlite" -ForegroundColor Yellow
        return
    }
    
    $sourcePath = Join-Path $WorkbenchDir $Name
    $destPath = Join-Path $PolishedDir $Name
    
    if (-not (Test-Path $sourcePath)) {
        Write-Host "ERROR: Pack not found in workbench: $Name" -ForegroundColor Red
        return
    }
    
    if (Test-Path $destPath) {
        $confirm = Read-Host "$Name already exists in polished. Overwrite? (y/N)"
        if ($confirm -ne 'y' -and $confirm -ne 'Y') {
            Write-Host "Cancelled." -ForegroundColor Yellow
            return
        }
    }
    
    Copy-Item -Path $sourcePath -Destination $destPath -Force
    Write-Host "SUCCESS: Promoted $Name to polished" -ForegroundColor Green
    Write-Host "Run 'npm run build:polished' to bundle this pack" -ForegroundColor Gray
}

function Demote-Pack {
    param([string]$Name)
    
    if (-not $Name) {
        Write-Host "ERROR: Pack name required" -ForegroundColor Red
        Write-Host "Usage: manage-packs.ps1 demote packname.sqlite" -ForegroundColor Yellow
        return
    }
    
    $sourcePath = Join-Path $PolishedDir $Name
    $destPath = Join-Path $WorkbenchDir $Name
    
    if (-not (Test-Path $sourcePath)) {
        Write-Host "ERROR: Pack not found in polished: $Name" -ForegroundColor Red
        return
    }
    
    if (Test-Path $destPath) {
        $confirm = Read-Host "$Name already exists in workbench. Overwrite? (y/N)"
        if ($confirm -ne 'y' -and $confirm -ne 'Y') {
            Write-Host "Cancelled." -ForegroundColor Yellow
            return
        }
    }
    
    Copy-Item -Path $sourcePath -Destination $destPath -Force
    Write-Host "SUCCESS: Copied $Name to workbench" -ForegroundColor Green
}

function Clean-Workbench {
    $confirm = Read-Host "WARNING: Delete ALL packs from workbench? This cannot be undone. (y/N)"
    if ($confirm -ne 'y' -and $confirm -ne 'Y') {
        Write-Host "Cancelled." -ForegroundColor Yellow
        return
    }
    
    if (Test-Path $WorkbenchDir) {
        Get-ChildItem -Path $WorkbenchDir -Filter "*.sqlite" | Remove-Item -Force
        Write-Host "SUCCESS: Workbench cleaned" -ForegroundColor Green
    }
}

# Main execution
switch ($Action) {
    "list" { List-Packs }
    "promote" { Promote-Pack -Name $PackName }
    "demote" { Demote-Pack -Name $PackName }
    "clean" { Clean-Workbench }
}
