import sqlite3

db = sqlite3.connect(r'C:\Users\Marlowe\Desktop\ProjectBible\packs\pleiades.sqlite')
cursor = db.cursor()

# Get all unique place types and their counts
cursor.execute("""
    SELECT place_type, COUNT(*) as count 
    FROM places 
    WHERE place_type IS NOT NULL AND place_type != ''
    GROUP BY place_type 
    ORDER BY count DESC
""")

print("Place Types in Pleiades Database:")
print("=" * 80)
total = 0
for row in cursor.fetchall():
    print(f"{row[1]:5d}  {row[0]}")
    total += row[1]

print("=" * 80)
print(f"Total places with types: {total}")

# Get count of places without type
cursor.execute("SELECT COUNT(*) FROM places WHERE place_type IS NULL OR place_type = ''")
no_type = cursor.fetchone()[0]
print(f"Places without type: {no_type}")

# Sample some places with interesting types
print("\n" + "=" * 80)
print("Sample places by type:")
print("=" * 80)

interesting_types = ['mountain', 'river', 'valley', 'spring', 'pass', 'island', 'cape', 'lake']

for ptype in interesting_types:
    cursor.execute(f"""
        SELECT title, place_type 
        FROM places 
        WHERE place_type LIKE '%{ptype}%'
        LIMIT 5
    """)
    results = cursor.fetchall()
    if results:
        print(f"\n{ptype.upper()}S:")
        for row in results:
            print(f"  {row[0]}")

db.close()
