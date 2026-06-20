# Commentary Pack Report

**Generated:** 2026-06-20T20:26:40.488Z
**Pack:** C:\Users\Marlowe\Desktop\ProjectBible\packs\workbench\commentaries.sqlite
**Pack Size:** 179.80 MB (0.18 GB)
**Total Entries:** 85,713

## Testament Coverage

- Old Testament: 41,405 entries
- New Testament: 44,308 entries

## Entries by Author

| Author | Entries | Percentage |
|--------|---------|------------|
| Treasury of Scripture Knowledge | 17,748 | 20.7% |
| Jamieson-Fausset-Brown | 16,743 | 19.5% |
| John Calvin | 11,063 | 12.9% |
| KingComments | 7,590 | 8.9% |
| Albert Barnes | 7,355 | 8.6% |
| A.T. Robertson | 7,201 | 8.4% |
| Family Bible Notes | 5,224 | 6.1% |
| Matthew Henry | 4,249 | 5.0% |
| E.W. Bullinger | 4,229 | 4.9% |
| Abbott | 3,340 | 3.9% |
| Thomas Aquinas (Catena Aurea) | 821 | 1.0% |
| Charles Spurgeon | 150 | 0.2% |

## Entries by Book (Top 20)

| Book | Entries |
|------|----------|
| Matthew | 5,989 |
| Acts | 5,863 |
| Luke | 5,633 |
| John | 5,126 |
| Psalms | 4,076 |
| Isaiah | 3,611 |
| Jeremiah | 3,606 |
| Mark | 3,123 |
| Genesis | 2,674 |
| 1 Corinthians | 2,609 |
| Romans | 2,522 |
| Ezekiel | 2,458 |
| Revelation | 2,035 |
| Proverbs | 2,024 |
| Exodus | 1,852 |
| Hebrews | 1,850 |
| Job | 1,806 |
| 2 Corinthians | 1,603 |
| Numbers | 1,567 |
| Deuteronomy | 1,536 |

## Pack Metadata

```json
{
  "id": "commentaries.v1",
  "type": "commentary",
  "version": "1.1.0",
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
