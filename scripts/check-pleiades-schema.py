import sqlite3

db = sqlite3.connect(r'C:\Users\Marlowe\Desktop\ProjectBible\packs\pleiades.sqlite')
cursor = db.cursor()

# Get table schema
cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='places'")
schema = cursor.fetchone()
print("Places table schema:")
print(schema[0] if schema else "Table not found")

print("\n" + "=" * 80)

# Get sample data
cursor.execute("SELECT * FROM places LIMIT 1")
row = cursor.fetchone()
if row:
    cursor.execute("PRAGMA table_info(places)")
    columns = cursor.fetchall()
    print("Columns and sample data:")
    for i, col in enumerate(columns):
        print(f"{col[1]:20s}: {row[i]}")

db.close()
