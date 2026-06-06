import sqlite3

conn = sqlite3.connect('data-sources/commentaries/raw/spurgeon-expositions.cmtx')
cur = conn.cursor()

cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = cur.fetchall()
print('Tables:', tables)

for (tname,) in tables:
    print(f'\n--- {tname} ---')
    cur.execute(f'PRAGMA table_info("{tname}")')
    cols = cur.fetchall()
    print('Columns:', cols)
    cur.execute(f'SELECT * FROM "{tname}" LIMIT 3')
    for row in cur.fetchall():
        print(row)

conn.close()
