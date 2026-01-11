import sqlite3

db = sqlite3.connect(r'C:\Users\Marlowe\Desktop\ProjectBible\packs\lxx2012-english.sqlite')
cursor = db.cursor()

# Search for verses with ⌃ symbol
cursor.execute("SELECT book, chapter, verse, text FROM verses WHERE text LIKE '%⌃%' LIMIT 15")
rows = cursor.fetchall()

print("Verses with ⌃ symbol:")
print("=" * 80)
for row in rows:
    print(f"{row[0]} {row[1]}:{row[2]}")
    print(f"  {row[3]}")
    print()

db.close()
