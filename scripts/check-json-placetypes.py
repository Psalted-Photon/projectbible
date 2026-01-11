import json

print("Checking Pleiades JSON for placeType data...")

with open(r'C:\Users\Marlowe\Desktop\ProjectBible\data-sources\pleiades\pleiades-places-latest.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
    
places = data.get('@graph', [])
print(f"Total places in JSON: {len(places)}")

# Find places with placeType
with_type = [p for p in places if p.get('placeType')]
print(f"Places with placeType: {len(with_type)}")

# Show unique place types
place_types = {}
for p in with_type:
    ptype = p.get('placeType')
    if isinstance(ptype, list):
        ptype = ', '.join(ptype)
    place_types[ptype] = place_types.get(ptype, 0) + 1

print("\nPlace types found:")
for ptype, count in sorted(place_types.items(), key=lambda x: x[1], reverse=True)[:30]:
    print(f"{count:5d}  {ptype}")

# Show sample geographic features
print("\nSample mountains/natural features:")
natural_features = [p for p in with_type if any(term in str(p.get('placeType', '')).lower() 
                    for term in ['mountain', 'river', 'valley', 'spring', 'island', 'cape', 'lake', 'sea'])]
for p in natural_features[:15]:
    print(f"  {p.get('title')}: {p.get('placeType')}")
