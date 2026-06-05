import sqlite3, re

p = 'packs/consolidated/commentaries.sqlite'
con = sqlite3.connect(p)
cur = con.cursor()

# Get all distinct books
books = cur.execute(
    "SELECT DISTINCT book FROM commentary_entries ORDER BY id LIMIT 200"
).fetchall()
books = [b[0] for b in books]

# Get them in order by min id
books_ordered = cur.execute(
    "SELECT book, MIN(id) as mid FROM commentary_entries GROUP BY book ORDER BY mid"
).fetchall()
print("Books in DB order:")
for b in books_ordered:
    print(' ', b[0])

# Sample JFB for a few books to see how intro text looks
sample_books = ['Genesis', 'Exodus', 'Psalms', 'Isaiah', 'Matthew', 'Romans', 'Revelation']
for bk in sample_books:
    row = cur.execute(
        "SELECT text FROM commentary_entries WHERE book=? AND chapter=1 AND verse_start=1 AND author='Jamieson-Fausset-Brown' LIMIT 1",
        (bk,)
    ).fetchone()
    if row:
        txt = row[0]
        print(f"\n=== JFB {bk} (len={len(txt)}) ===")
        print(txt[:300])
        print("...")
        # Find where verse commentary starts (typical JFB pattern)
        # Pattern: short book abbreviation + space + digit:digit
        m = re.search(r'\b[A-Z][a-z]{0,4}\s+\d+:\d+', txt)
        if m:
            print(f"  -> verse marker at {m.start()}: {repr(txt[m.start():m.start()+60])}")

con.close()
