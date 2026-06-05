import sqlite3, re

p = 'packs/consolidated/commentaries.sqlite'
con = sqlite3.connect(p)
cur = con.cursor()

# Check Matthew Henry for various OT books
sample_books = ['Genesis', 'Exodus', 'Joshua', 'Psalms', 'Isaiah', 'Ezekiel', 'Daniel', 'Hosea', 'Matthew', 'Romans']
print("=== MATTHEW HENRY book intro lengths ===")
for bk in sample_books:
    row = cur.execute(
        "SELECT text FROM commentary_entries WHERE book=? AND chapter=1 AND verse_start=1 AND author='Matthew Henry' LIMIT 1",
        (bk,)
    ).fetchone()
    if row:
        txt = row[0]
        # Find verse marker
        m = re.search(r'\bv(?:erse)?\s*1\b', txt, re.IGNORECASE)
        m2 = re.search(r'\b[A-Z][a-z]{0,5}\b\.?\s+\d+:\d+', txt[100:])
        print(f"  {bk}: len={len(txt)}, verse marker at ~{m.start() if m else 'none'}, ref marker at ~{(m2.start()+100) if m2 else 'none'}")
        if len(txt) > 100:
            print(f"    Start: {txt[:150]}")
    else:
        print(f"  {bk}: NO ENTRY")

# Check Albert Barnes for OT books
print("\n=== ALBERT BARNES OT books ===")
ot_books = ['Genesis', 'Psalms', 'Isaiah', 'Jeremiah']
for bk in ot_books:
    row = cur.execute(
        "SELECT text FROM commentary_entries WHERE book=? AND chapter=1 AND verse_start=1 AND author='Albert Barnes' LIMIT 1",
        (bk,)
    ).fetchone()
    if row:
        print(f"  {bk}: len={len(row[0])}, start: {row[0][:100]}")
    else:
        print(f"  {bk}: NO ENTRY")

con.close()
