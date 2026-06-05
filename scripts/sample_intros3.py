import sqlite3, re

p = 'packs/consolidated/commentaries.sqlite'
con = sqlite3.connect(p)
cur = con.cursor()

# Get ALL books and their JFB ch1v1 intro lengths
all_books = cur.execute(
    "SELECT book, MIN(id) as mid FROM commentary_entries GROUP BY book ORDER BY mid"
).fetchall()

print("JFB ch1 v1 intro lengths for all books:")
for (bk, _) in all_books:
    row = cur.execute(
        "SELECT length(text), substr(text,1,80) FROM commentary_entries WHERE book=? AND chapter=1 AND verse_start=1 AND author='Jamieson-Fausset-Brown' LIMIT 1",
        (bk,)
    ).fetchone()
    if row:
        ln, start = row
        print(f"  {bk:25} len={ln:6}  {start[:60]}")
    else:
        print(f"  {bk:25} NO JFB ENTRY")

con.close()
