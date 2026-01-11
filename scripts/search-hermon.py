import sqlite3

db = sqlite3.connect(r'C:\Users\Marlowe\Desktop\ProjectBible\packs\pleiades.sqlite')
cursor = db.cursor()

# Search for Hermon
print("Searching for 'Hermon' in places:")
cursor.execute("SELECT id, title, description FROM places WHERE title LIKE '%hermon%' OR description LIKE '%hermon%'")
results = cursor.fetchall()
print(f"Found {len(results)} results")
for row in results:
    print(f"\n{row[1]}")
    print(f"  ID: {row[0]}")
    if row[2]:
        print(f"  Desc: {row[2][:200]}")

# Check place_names table
print("\n" + "=" * 80)
print("Searching for 'Hermon' in place_names:")
cursor.execute("""
    SELECT p.title, pn.name, pn.language
    FROM place_names pn
    JOIN places p ON pn.place_id = p.id
    WHERE pn.name LIKE '%hermon%'
""")
results = cursor.fetchall()
print(f"Found {len(results)} results")
for row in results:
    print(f"  {row[0]} -> {row[1]} ({row[2]})")

# Try some other biblical locations
print("\n" + "=" * 80)
print("Searching for other biblical mountains:")
for term in ['Sinai', 'Zion', 'Olive', 'Carmel', 'Tabor']:
    cursor.execute(f"SELECT COUNT(*) FROM places WHERE title LIKE '%{term}%'")
    count = cursor.fetchone()[0]
    if count > 0:
        cursor.execute(f"SELECT title FROM places WHERE title LIKE '%{term}%' LIMIT 3")
        results = cursor.fetchall()
        print(f"\n{term}: {count} found")
        for r in results:
            print(f"  {r[0]}")

db.close()
