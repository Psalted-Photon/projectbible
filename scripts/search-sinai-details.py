import sqlite3

db = sqlite3.connect(r'C:\Users\Marlowe\Desktop\ProjectBible\packs\pleiades.sqlite')
cursor = db.cursor()

# Search for all Sinai-related places
print("All places with 'Sinai' in title or description:")
print("=" * 80)
cursor.execute("""
    SELECT id, title, description, place_type 
    FROM places 
    WHERE title LIKE '%sinai%' OR description LIKE '%sinai%'
    ORDER BY title
""")
results = cursor.fetchall()
print(f"Found {len(results)} results\n")
for row in results:
    print(f"{row[1]}")
    if row[3]:
        print(f"  Type: {row[3]}")
    if row[2]:
        print(f"  Description: {row[2][:150]}")
    print()

# Check for place_locations with coordinates for Sinai
print("=" * 80)
print("Checking coordinates for Sinai places:")
cursor.execute("""
    SELECT p.title, pl.latitude, pl.longitude, pl.title as loc_title
    FROM places p
    JOIN place_locations pl ON p.id = pl.place_id
    WHERE p.title LIKE '%sinai%'
""")
for row in cursor.fetchall():
    print(f"{row[0]}: ({row[1]}, {row[2]}) - {row[3]}")

# Also check nearby mountains
print("\n" + "=" * 80)
print("Mountains in the Sinai region (approx coordinates):")
cursor.execute("""
    SELECT p.title, pl.latitude, pl.longitude, p.description
    FROM places p
    JOIN place_locations pl ON p.id = pl.place_id
    WHERE pl.latitude BETWEEN 27 AND 30
    AND pl.longitude BETWEEN 32 AND 35
    AND (p.title LIKE '%mount%' OR p.title LIKE '%mountain%' 
         OR p.description LIKE '%mountain%' OR p.description LIKE '%mount%')
    LIMIT 20
""")
mountains = cursor.fetchall()
print(f"Found {len(mountains)} mountains in Sinai area:")
for row in mountains:
    print(f"\n{row[0]}")
    print(f"  Coords: ({row[1]}, {row[2]})")
    if row[3]:
        print(f"  Desc: {row[3][:150]}")

db.close()
