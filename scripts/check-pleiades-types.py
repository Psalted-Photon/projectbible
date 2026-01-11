import sqlite3

db = sqlite3.connect(r'C:\Users\Marlowe\Desktop\ProjectBible\packs\pleiades.sqlite')
cursor = db.cursor()

# Get all unique place types and their counts
cursor.execute("""
    SELECT placeTypes, COUNT(*) as count 
    FROM places 
    WHERE placeTypes IS NOT NULL AND placeTypes != ''
    GROUP BY placeTypes 
    ORDER BY count DESC
    LIMIT 50
""")

print("Place Types in Pleiades Database:")
print("=" * 80)
total = 0
for row in cursor.fetchall():
    print(f"{row[1]:5d}  {row[0]}")
    total += row[1]

print("=" * 80)
print(f"Total places with types: {total}")

# Check for specific geographic features
print("\n" + "=" * 80)
print("Searching for geographic features:")
print("=" * 80)

features = [
    ("mountain", "Mountains/Hills"),
    ("river", "Rivers"),
    ("valley", "Valleys"),
    ("spring", "Springs/Water"),
    ("lake", "Lakes"),
    ("sea", "Seas"),
    ("island", "Islands"),
    ("cape", "Capes/Promontories"),
    ("pass", "Passes"),
    ("forest", "Forests"),
    ("desert", "Deserts")
]

for keyword, label in features:
    cursor.execute(f"""
        SELECT COUNT(*) 
        FROM places 
        WHERE placeTypes LIKE '%{keyword}%' OR title LIKE '%{keyword}%'
    """)
    count = cursor.fetchone()[0]
    if count > 0:
        print(f"{label:25s}: {count:5d}")

# Sample some geographic features
print("\n" + "=" * 80)
print("Sample Geographic Features:")
print("=" * 80)

cursor.execute("""
    SELECT title, placeTypes 
    FROM places 
    WHERE placeTypes LIKE '%mountain%' OR placeTypes LIKE '%river%' 
       OR placeTypes LIKE '%valley%' OR placeTypes LIKE '%spring%'
    LIMIT 20
""")

for row in cursor.fetchall():
    print(f"{row[0]:40s} -> {row[1]}")

db.close()
