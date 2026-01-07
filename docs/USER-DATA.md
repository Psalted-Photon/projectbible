# User Data Storage

The user data storage system manages personal Bible study data: notes, highlights, bookmarks, and reading position.

## Features

✅ **Notes** - Add personal notes to any verse  
✅ **Highlights** - Highlight verses with custom colors  
✅ **Bookmarks** - Quick access to important verses  
✅ **Reading Position** - Automatically track where you left off  
✅ **IndexedDB Storage** - All data stored locally in browser

## Quick Start

```typescript
import { IndexedDBUserDataStore } from "./adapters";

const userDataStore = new IndexedDBUserDataStore();

// Add a note
const note = await userDataStore.saveNote({
  reference: { book: "John", chapter: 3, verse: 16 },
  text: "Amazing verse about God's love!",
});

// Get all notes for a verse
const notes = await userDataStore.getNotes({
  book: "John",
  chapter: 3,
  verse: 16,
});

// Get all notes (no filter)
const allNotes = await userDataStore.getNotes();
```

## Notes

### Save a Note

```typescript
const note = await userDataStore.saveNote({
  reference: { book: "Psalms", chapter: 23, verse: 1 },
  text: "The Lord is my shepherd - what comfort!",
});
// Returns: { id, reference, text, createdAt, updatedAt }
```

### Update a Note

```typescript
await userDataStore.updateNote(noteId, "Updated text here");
```

### Get Notes

```typescript
// Get all notes for a specific verse
const verseNotes = await userDataStore.getNotes({
  book: "Genesis",
  chapter: 1,
  verse: 1,
});

// Get all notes
const allNotes = await userDataStore.getNotes();
```

### Delete a Note

```typescript
await userDataStore.deleteNote(noteId);
```

## Highlights

### Save a Highlight

```typescript
const highlight = await userDataStore.saveHighlight({
  reference: { book: "Romans", chapter: 8, verse: 28 },
  color: "#ffeb3b", // Yellow
});
```

### Common Highlight Colors

- Yellow: `#ffeb3b`
- Green: `#4caf50`
- Blue: `#2196f3`
- Pink: `#e91e63`
- Orange: `#ff9800`

### Get Highlights

```typescript
// For a specific verse
const highlights = await userDataStore.getHighlights({
  book: "John",
  chapter: 3,
  verse: 16,
});

// All highlights
const allHighlights = await userDataStore.getHighlights();
```

### Delete a Highlight

```typescript
await userDataStore.deleteHighlight(highlightId);
```

## Bookmarks

### Save a Bookmark

```typescript
const bookmark = await userDataStore.saveBookmark({
  reference: { book: "Proverbs", chapter: 3, verse: 5 },
  label: "Trust in the LORD", // Optional
});
```

### Get Bookmarks

```typescript
const bookmarks = await userDataStore.getBookmarks();
// Returns most recent first
```

### Delete a Bookmark

```typescript
await userDataStore.deleteBookmark(bookmarkId);
```

## Reading Position

The reading position feature automatically tracks where the user left off reading.

### Save Reading Position

```typescript
// User is reading John 3:16
await userDataStore.saveReadingPosition({
  book: "John",
  chapter: 3,
  verse: 16,
});
```

### Get Reading Position

```typescript
const position = await userDataStore.getReadingPosition();

if (position) {
  console.log(
    `Resume reading at ${position.book} ${position.chapter}:${position.verse}`
  );
} else {
  console.log("No reading position saved");
}
```

### Auto-Resume Example

```typescript
// When the app starts, check for saved position
const lastPosition = await userDataStore.getReadingPosition();

if (lastPosition) {
  // Navigate to the last reading position
  navigateToVerse(lastPosition.book, lastPosition.chapter, lastPosition.verse);
}
```

## Data Structure

All user data is stored in IndexedDB under the `projectbible` database:

- **user_notes** - Personal notes on verses
- **user_highlights** - Highlighted verses with colors
- **user_bookmarks** - Bookmarked verses for quick access
- Reading position is stored as a special bookmark with key `reading-position`

## Integration Example

```typescript
import { IndexedDBTextStore, IndexedDBUserDataStore } from "./adapters";

const textStore = new IndexedDBTextStore();
const userDataStore = new IndexedDBUserDataStore();

// Display a verse with user annotations
async function displayVerse(book: string, chapter: number, verse: number) {
  // Get verse text
  const text = await textStore.getVerse("KJV", book, chapter, verse);

  // Get user annotations
  const reference = { book, chapter, verse };
  const notes = await userDataStore.getNotes(reference);
  const highlights = await userDataStore.getHighlights(reference);

  // Display verse (highlighted if user highlighted it)
  const hasHighlight = highlights.length > 0;
  const highlightColor = hasHighlight ? highlights[0].color : "transparent";

  console.log(`${book} ${chapter}:${verse}`);
  console.log(`Text: ${text}`);
  console.log(`Highlight: ${highlightColor}`);
  console.log(`Notes: ${notes.length}`);

  // Save this as reading position
  await userDataStore.saveReadingPosition(reference);
}
```

## Future Enhancements

When sync is implemented later:

- Notes/highlights/bookmarks will sync across devices
- Reading position will be synced
- Conflict resolution for simultaneous edits
- Export to JSON for backup
