# Commentary Pack Report

**Generated:** 2026-04-12T00:13:03.417Z
**Pack:** C:\Users\Marlowe\Desktop\ProjectBible\packs\workbench\commentaries.sqlite
**Pack Size:** 187.01 MB (0.18 GB)
**Total Entries:** 86,819

## Testament Coverage

- Old Testament: 42,543 entries
- New Testament: 44,276 entries

## Entries by Author

| Author | Entries | Percentage |
|--------|---------|------------|
| Treasury of Scripture Knowledge | 17,748 | 20.4% |
| Jamieson-Fausset-Brown | 16,314 | 18.8% |
| John Calvin | 11,063 | 12.7% |
| KingComments | 7,590 | 8.7% |
| Albert Barnes | 7,355 | 8.5% |
| A.T. Robertson | 7,201 | 8.3% |
| Matthew Henry | 5,664 | 6.5% |
| Family Bible Notes | 5,224 | 6.0% |
| E.W. Bullinger | 4,229 | 4.9% |
| Abbott | 3,340 | 3.8% |
| Thomas Aquinas (Catena Aurea) | 821 | 0.9% |
| Charles Spurgeon | 270 | 0.3% |

## Entries by Book (Top 20)

| Book | Entries |
|------|----------|
| Matthew | 5,989 |
| Acts | 5,863 |
| Luke | 5,633 |
| John | 5,126 |
| Psalms | 5,060 |
| Jeremiah | 3,649 |
| Isaiah | 3,570 |
| Mark | 3,123 |
| Genesis | 2,674 |
| Ezekiel | 2,643 |
| 1 Corinthians | 2,609 |
| Romans | 2,527 |
| Job | 2,408 |
| Revelation | 2,051 |
| Proverbs | 1,873 |
| Hebrews | 1,857 |
| Exodus | 1,852 |
| Numbers | 1,643 |
| 2 Corinthians | 1,589 |
| Deuteronomy | 1,574 |

## Pack Metadata

```json
{
  "id": "commentaries.v1",
  "type": "commentary",
  "version": "1.0.3",
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
