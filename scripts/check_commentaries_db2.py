import sqlite3, os

p = 'packs/consolidated/commentaries.sqlite'
con = sqlite3.connect(p)
cur = con.cursor()

# Table is commentary_entries
authors = cur.execute('SELECT DISTINCT author FROM commentary_entries LIMIT 30').fetchall()
print('Authors:', [a[0] for a in authors])

# Get Genesis verse_start=0 entries (chapter level)
rows = cur.execute('SELECT book, chapter, verse_start, author, substr(text,1,300) FROM commentary_entries WHERE book=? AND verse_start=0 LIMIT 20', ('Genesis',)).fetchall()
print(f'\nGenesis verse_start=0 entries: {len(rows)}')
for r in rows:
    print(r[:4], r[4][:100])

# Also check chapter=0 entries
rows2 = cur.execute('SELECT book, chapter, verse_start, author, substr(text,1,300) FROM commentary_entries WHERE book=? AND chapter=0 LIMIT 20', ('Genesis',)).fetchall()
print(f'\nGenesis chapter=0 entries: {len(rows2)}')
for r in rows2:
    print(r[:4], r[4][:100])

# Sample a Genesis entry to see data format
sample = cur.execute('SELECT book, chapter, verse_start, author, substr(text,1,500) FROM commentary_entries WHERE book=? AND chapter=1 AND verse_start=1 LIMIT 3', ('Genesis',)).fetchall()
print(f'\nGenesis 1:1 sample entries:')
for r in sample:
    print(r[:4])
    print(r[4][:200])
    print()

con.close()
