import sqlite3

p = 'packs/consolidated/commentaries.sqlite'
con = sqlite3.connect(p)
cur = con.cursor()

# Get ALL books in order
all_books = cur.execute(
    "SELECT book, MIN(id) as mid FROM commentary_entries GROUP BY book ORDER BY mid"
).fetchall()

print("KingComments ch1 v1 entries:")
for (bk, _) in all_books:
    row = cur.execute(
        "SELECT length(text), substr(text,1,120) FROM commentary_entries WHERE book=? AND chapter=1 AND verse_start=1 AND author='KingComments' LIMIT 1",
        (bk,)
    ).fetchone()
    if row:
        ln, start = row
        print(f"  {bk:25} len={ln:6}  {start.strip()[:80]}")
    else:
        print(f"  {bk:25} NO ENTRY")

# Sample a few full entries
print("\n\n=== FULL SAMPLE: KingComments Genesis ===")
row = cur.execute(
    "SELECT text FROM commentary_entries WHERE book='Genesis' AND chapter=1 AND verse_start=1 AND author='KingComments' LIMIT 1"
).fetchone()
if row:
    print(row[0][:3000])

print("\n\n=== FULL SAMPLE: KingComments Matthew ===")
row = cur.execute(
    "SELECT text FROM commentary_entries WHERE book='Matthew' AND chapter=1 AND verse_start=1 AND author='KingComments' LIMIT 1"
).fetchone()
if row:
    print(row[0][:3000])

print("\n\n=== FULL SAMPLE: KingComments Isaiah ===")
row = cur.execute(
    "SELECT text FROM commentary_entries WHERE book='Isaiah' AND chapter=1 AND verse_start=1 AND author='KingComments' LIMIT 1"
).fetchone()
if row:
    print(row[0][:3000])

con.close()
