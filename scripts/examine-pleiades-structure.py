import json

print("Examining Pleiades JSON structure...")

with open(r'C:\Users\Marlowe\Desktop\ProjectBible\data-sources\pleiades\pleiades-places-latest.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
    
places = data.get('@graph', [])

# Look at first place in detail
print("Sample place structure:")
print(json.dumps(places[0], indent=2)[:2000])

print("\n" + "=" * 80)

# Check what fields exist
all_fields = set()
for p in places[:100]:
    all_fields.update(p.keys())

print(f"Fields found in places: {sorted(all_fields)}")

print("\n" + "=" * 80)

# Look for mountains, rivers, etc in titles or descriptions
print("Searching for natural features by title/description...")
keywords = {
    'mountain': [],
    'mount': [],
    'river': [],
    'valley': [],
    'spring': [],
    'island': [],
    'cape': [],
    'lake': [],
    'sea': [],
    'hill': [],
    'pass': []
}

for p in places:
    title = (p.get('title') or '').lower()
    desc = (p.get('description') or '').lower()
    combined = title + ' ' + desc
    
    for keyword in keywords:
        if keyword in combined:
            if len(keywords[keyword]) < 5:  # Collect samples
                keywords[keyword].append(p.get('title'))

for keyword, samples in keywords.items():
    if samples:
        print(f"\n{keyword.upper()} ({len(samples)} samples):")
        for s in samples[:5]:
            print(f"  {s}")
