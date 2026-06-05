import sqlite3, os

p = 'packs/consolidated/commentaries.sqlite'
con = sqlite3.connect(p)
cur = con.cursor()

tables = cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
print('Tables:', tables)

for t in tables:
    cols = cur.execute(f'PRAGMA table_info({t[0]})').fetchall()
    print(t[0], ':', [c[1] for c in cols])

# Count total rows
for t in tables:
    count = cur.execute(f'SELECT COUNT(*) FROM {t[0]}').fetchone()[0]
    print(f'{t[0]} rows: {count}')

# Get distinct authors
authors = cur.execute('SELECT DISTINCT author FROM commentary LIMIT 30').fetchall()
print('Authors:', [a[0] for a in authors])

# Get Genesis verse_start=0 entries (chapter level)
rows = cur.execute('SELECT book, chapter, verse_start, author, substr(text,1,200) FROM commentary WHERE book=? AND verse_start=0 LIMIT 20', ('Genesis',)).fetchall()
print(f'\nGenesis verse_start=0 entries: {len(rows)}')
for r in rows:
    print(r)

con.close()
