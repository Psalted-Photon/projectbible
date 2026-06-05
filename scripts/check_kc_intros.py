import sqlite3, re

p = 'packs/consolidated/commentaries.sqlite'
con = sqlite3.connect(p)
cur = con.cursor()

# Check Genesis — maybe it's at a different verse
rows = cur.execute(
    "SELECT chapter, verse_start, verse_end, length(text), substr(text,1,100) FROM commentary_entries WHERE book='Genesis' AND author='KingComments' ORDER BY chapter, verse_start LIMIT 10"
).fetchall()
print("KingComments Genesis entries:")
for r in rows:
    print(f"  ch={r[0]} v={r[1]}-{r[2]} len={r[3]}  {r[4][:80]}")

# Look at a few books to understand where intro transitions to verse commentary
# Check where KingComments Matthew intro ends
row = cur.execute(
    "SELECT text FROM commentary_entries WHERE book='Matthew' AND chapter=1 AND verse_start=1 AND author='KingComments' LIMIT 1"
).fetchone()
if row:
    txt = row[0]
    # Find transition from intro to verse commentary
    # Look for patterns like all-caps phrases or verse references Mt 1:
    patterns = [
        r'\bMt\s+1:',
        r'\bMatt\s+1:',
        r'verse\s+1\b',
        r'Mt\. 1',
    ]
    for pat in patterns:
        m = re.search(pat, txt, re.IGNORECASE)
        if m:
            print(f"\nMatthew: '{pat}' found at {m.start()}")
            print(f"  Context: {repr(txt[max(0,m.start()-100):m.start()+100])}")
            break

# Check Romans intro transition
row = cur.execute(
    "SELECT text FROM commentary_entries WHERE book='Romans' AND chapter=1 AND verse_start=1 AND author='KingComments' LIMIT 1"
).fetchone()
if row:
    txt = row[0]
    # Find where intro ends - look for "Romans 1" or verse reference
    m = re.search(r'\bRom(?:ans)?\s+1:|\bverse\s+1\b', txt, re.IGNORECASE)
    if m:
        print(f"\nRomans: transition at {m.start()}: {repr(txt[m.start():m.start()+100])}")
    print(f"Romans total len: {len(txt)}")
    print(f"Romans first 200: {txt[:200]}")

# Check where Judges intro ends (long at 29386 chars)
row = cur.execute(
    "SELECT text FROM commentary_entries WHERE book='Judges' AND chapter=1 AND verse_start=1 AND author='KingComments' LIMIT 1"
).fetchone()
if row:
    txt = row[0]
    m = re.search(r'\bJudg(?:es)?\s+1:|\bJdg\s+1:', txt, re.IGNORECASE)
    if m:
        print(f"\nJudges: transition at {m.start()}: {repr(txt[m.start():m.start()+100])}")
    print(f"Judges total len: {len(txt)}, transition at: {m.start() if m else 'not found'}")

con.close()
