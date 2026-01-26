# Commentary Pack Report

**Generated:** 2026-01-25T22:25:42.206Z
**Pack:** C:\Users\Marlowe\Desktop\ProjectBible\packs\workbench\commentaries.sqlite
**Pack Size:** 0.05 MB (0.00 GB)
**Total Entries:** 16

## Testament Coverage

- Old Testament: 10 entries
- New Testament: 6 entries

## Entries by Author

| Author | Entries | Percentage |
|--------|---------|------------|
| Unknown | 16 | 100.0% |

## Entries by Book (Top 20)

| Book | Entries |
|------|----------|
| Genesis | 6 |
| Romans | 6 |
| Psalms | 4 |

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
