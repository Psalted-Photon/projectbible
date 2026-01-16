# Validate verse counts against known Bible structure
# This checks for missing verses by comparing verse sequences

$books = @(
    @{Name='Ruth'; Chapters=@(22,23,18,22)},
    @{Name='I Samuel'; Chapters=@(28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13)},
    @{Name='II Samuel'; Chapters=@(27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25)},
    @{Name='I Kings'; Chapters=@(53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53)},
    @{Name='II Kings'; Chapters=@(18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30)},
    @{Name='I Chronicles'; Chapters=@(54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30)},
    @{Name='II Chronicles'; Chapters=@(17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23)},
    @{Name='Ezra'; Chapters=@(11,70,13,24,17,22,28,36,15,44)}
)

Write-Host "=== Validating KJV Pack ===" -ForegroundColor Cyan
$kjvIssues = 0

foreach ($book in $books) {
    for ($ch = 1; $ch -le $book.Chapters.Count; $ch++) {
        $expectedVerses = $book.Chapters[$ch - 1]
        $result = sqlite3 packs/kjv.sqlite "SELECT verse FROM verses WHERE book = '$($book.Name)' AND chapter = $ch ORDER BY verse;"
        $verses = $result -split "`n" | Where-Object { $_ -ne '' }
        
        if ($verses.Count -ne $expectedVerses) {
            Write-Host "❌ $($book.Name) $ch : Expected $expectedVerses verses, found $($verses.Count)" -ForegroundColor Red
            $kjvIssues++
        }
        
        # Check for gaps in verse numbers
        for ($v = 1; $v -le $expectedVerses; $v++) {
            if ($v -notin $verses) {
                Write-Host "❌ $($book.Name) $ch`:$v is MISSING" -ForegroundColor Red
                $kjvIssues++
            }
        }
        
        # Check for blank verses
        $blanks = sqlite3 packs/kjv.sqlite "SELECT verse FROM verses WHERE book = '$($book.Name)' AND chapter = $ch AND (text = '' OR text IS NULL);"
        if ($blanks) {
            $blankVerses = $blanks -split "`n" | Where-Object { $_ -ne '' }
            foreach ($bv in $blankVerses) {
                Write-Host "❌ $($book.Name) $ch`:$bv is BLANK" -ForegroundColor Red
                $kjvIssues++
            }
        }
    }
}

if ($kjvIssues -eq 0) {
    Write-Host "✅ KJV Pack: All verses present and accounted for!" -ForegroundColor Green
} else {
    Write-Host "Found $kjvIssues issues in KJV pack" -ForegroundColor Red
}

Write-Host "`n=== Validating WEB Pack ===" -ForegroundColor Cyan
$webIssues = 0

foreach ($book in $books) {
    for ($ch = 1; $ch -le $book.Chapters.Count; $ch++) {
        $expectedVerses = $book.Chapters[$ch - 1]
        $result = sqlite3 packs/web.sqlite "SELECT verse FROM verses WHERE book = '$($book.Name)' AND chapter = $ch ORDER BY verse;"
        $verses = $result -split "`n" | Where-Object { $_ -ne '' }
        
        if ($verses.Count -ne $expectedVerses) {
            Write-Host "❌ $($book.Name) $ch : Expected $expectedVerses verses, found $($verses.Count)" -ForegroundColor Red
            $webIssues++
        }
        
        # Check for gaps
        for ($v = 1; $v -le $expectedVerses; $v++) {
            if ($v -notin $verses) {
                Write-Host "❌ $($book.Name) $ch`:$v is MISSING" -ForegroundColor Red
                $webIssues++
            }
        }
        
        # Check for blank verses (this is expected in WEB for some verses)
        $blanks = sqlite3 packs/web.sqlite "SELECT verse FROM verses WHERE book = '$($book.Name)' AND chapter = $ch AND (text = '' OR text IS NULL);"
        if ($blanks) {
            $blankVerses = $blanks -split "`n" | Where-Object { $_ -ne '' }
            foreach ($bv in $blankVerses) {
                Write-Host "⚠️  $($book.Name) $ch`:$bv is BLANK (may be intentional)" -ForegroundColor Yellow
            }
        }
    }
}

if ($webIssues -eq 0) {
    Write-Host "✅ WEB Pack: All verses present and accounted for!" -ForegroundColor Green
} else {
    Write-Host "Found $webIssues issues in WEB pack" -ForegroundColor Red
}
