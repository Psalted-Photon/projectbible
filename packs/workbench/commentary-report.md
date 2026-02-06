# Commentary Pack Report

**Generated:** 2026-02-05T01:00:07.695Z
**Pack:** C:\Users\Marlowe\Desktop\ProjectBible\packs\workbench\commentaries.sqlite
**Pack Size:** 143.86 MB (0.14 GB)
**Total Entries:** 93,837

## Testament Coverage

- Old Testament: 48,367 entries
- New Testament: 45,470 entries

## Entries by Author

| Author | Entries | Percentage |
|--------|---------|------------|
| Adam Clarke | 21,051 | 22.4% |
| John Wesley | 16,709 | 17.8% |
| Treasury of Scripture Knowledge | 13,355 | 14.2% |
| John Calvin | 10,067 | 10.7% |
| KingComments | 7,590 | 8.1% |
| A.T. Robertson | 7,201 | 7.7% |
| Albert Barnes | 5,621 | 6.0% |
| E.W. Bullinger | 4,221 | 4.5% |
| Family Bible Notes | 3,861 | 4.1% |
| Abbott | 3,340 | 3.6% |
| Thomas Aquinas (Catena Aurea) | 821 | 0.9% |

## Entries by Book (Top 20)

| Book | Entries |
|------|----------|
| Matthew | 6,943 |
| Acts | 6,905 |
| Luke | 6,416 |
| John | 6,041 |
| Psalms | 5,542 |
| Isaiah | 4,108 |
| Jeremiah | 3,803 |
| Mark | 3,348 |
| Genesis | 3,327 |
| Romans | 2,996 |
| Ezekiel | 2,914 |
| Job | 2,524 |
| Exodus | 2,507 |
| Hebrews | 2,094 |
| Deuteronomy | 2,088 |
| Proverbs | 2,038 |
| Numbers | 2,034 |
| Leviticus | 1,587 |
| 1 Corinthians | 1,533 |
| Joshua | 1,504 |

## Pack Metadata

```json
{
  "id": "commentaries.v1",
  "type": "commentary",
  "version": "1.0.0",
  "schemaVersion": "1.0",
  "name": "Bible Commentaries Collection",
  "description": "Historical and modern Bible commentaries including Matthew Henry, JFB, Barnes, Keil & Delitzsch, and more",
  "language": "en",
  "license": "Public Domain / Free for Personal Use",
  "attribution": "CrossWire Sword Project, Plano Bible Chapel, and various authors. See individual commentary metadata for specific licensing."
}
```

## Next Steps

1. Test pack import:
   ```bash
   npm run dev:polished
   # Open DevTools > Application > IndexedDB
   # Upload pack via Import UI
   ```

2. Validate commentary retrieval:
   - Navigate to Romans 5
   - Select verse 1
   - Click "Commentary" button
   - Should see entries from multiple authors

3. Promote to production:
   ```bash
   # Copy to polished bundled packs
   cp packs/workbench/commentaries.sqlite apps/pwa-polished/public/packs/
   ```
