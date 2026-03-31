# Commentary Pack Report

**Generated:** 2026-03-31T01:41:42.809Z
**Pack:** C:\Users\Marlowe\Desktop\ProjectBible\packs\workbench\commentaries.sqlite
**Pack Size:** 145.63 MB (0.14 GB)
**Total Entries:** 119,082

## Testament Coverage

- Old Testament: 66,885 entries
- New Testament: 52,197 entries

## Entries by Author

| Author | Entries | Percentage |
|--------|---------|------------|
| NET Bible Translators | 25,233 | 21.2% |
| Adam Clarke | 21,051 | 17.7% |
| John Wesley | 16,715 | 14.0% |
| Treasury of Scripture Knowledge | 13,355 | 11.2% |
| John Calvin | 10,067 | 8.5% |
| KingComments | 7,590 | 6.4% |
| A.T. Robertson | 7,201 | 6.0% |
| Albert Barnes | 5,621 | 4.7% |
| E.W. Bullinger | 4,221 | 3.5% |
| Family Bible Notes | 3,867 | 3.2% |
| Abbott | 3,340 | 2.8% |
| Thomas Aquinas (Catena Aurea) | 821 | 0.7% |

## Entries by Book (Top 20)

| Book | Entries |
|------|----------|
| Acts | 7,891 |
| Matthew | 7,780 |
| Psalms | 7,748 |
| Luke | 7,538 |
| John | 6,873 |
| Isaiah | 5,267 |
| Jeremiah | 5,068 |
| Genesis | 4,640 |
| Mark | 3,855 |
| Ezekiel | 3,749 |
| Job | 3,513 |
| Exodus | 3,485 |
| Romans | 3,301 |
| Proverbs | 2,934 |
| Deuteronomy | 2,812 |
| Numbers | 2,774 |
| Hebrews | 2,309 |
| Leviticus | 2,309 |
| Joshua | 1,987 |
| 1 Samuel | 1,753 |

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
