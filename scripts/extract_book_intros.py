"""
extract_book_intros.py
Extracts KingComments book introductions from commentaries.sqlite
and outputs apps/pwa-polished/src/data/book-introductions.json
"""
import sqlite3, json, re, os, html

DB_PATH = 'packs/consolidated/commentaries.sqlite'
OUT_PATH = 'apps/pwa-polished/src/data/book-introductions.json'

# KingComments writes complete book introductions in chapter 1's entry.
# The entire entry IS the introduction — no splitting needed.
MAX_INTRO_CHARS = 60000  # safety cap only; most books are well under this


def text_to_html(text):
    """Convert plain text commentary to clean HTML."""
    # The text uses \n for newlines; double newlines = paragraph breaks
    # Some entries have HTML tags already (like <i>, <b>)
    
    # Check if text already has HTML tags
    has_html = bool(re.search(r'<[a-z]+[^>]*>', text, re.IGNORECASE))
    
    if not has_html:
        # Escape HTML entities first
        text = html.escape(text)
    
    # Split into paragraphs on double newlines
    paragraphs = re.split(r'\n\n+', text.strip())
    
    html_parts = []
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        
        # Check if it looks like a heading (short, no period, often all-caps or title case)
        lines = para.split('\n')
        if len(lines) == 1 and len(para) < 80 and not para.endswith('.'):
            # Could be a heading
            html_parts.append(f'<h3>{para}</h3>')
        else:
            # Regular paragraph — join soft line breaks
            para_text = ' '.join(line.strip() for line in lines if line.strip())
            html_parts.append(f'<p>{para_text}</p>')
    
    return '\n'.join(html_parts)


def main():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    
    # Get all books in canonical order
    all_books = cur.execute(
        "SELECT book, MIN(id) as mid FROM commentary_entries GROUP BY book ORDER BY mid"
    ).fetchall()
    
    result = {}
    missing = []
    
    for (book, _) in all_books:
        # Get KingComments entry for chapter 1
        # For Genesis, the intro is at verse_start=2; for others, verse_start=1
        # Get the lowest verse_start entry that starts with INTRODUCTION
        rows = cur.execute(
            """SELECT verse_start, text FROM commentary_entries 
               WHERE book=? AND chapter=1 AND author='KingComments' 
               ORDER BY verse_start LIMIT 5""",
            (book,)
        ).fetchall()
        
        intro_text = None
        for (vs, text) in rows:
            if text and text.strip().startswith('INTRODUCTION'):
                intro_text = text
                break
        
        if not intro_text:
            # Try verse 0 (some books may have a dedicated intro entry)
            row = cur.execute(
                """SELECT text FROM commentary_entries 
                   WHERE book=? AND chapter=0 AND author='KingComments' LIMIT 1""",
                (book,)
            ).fetchone()
            if row and row[0]:
                intro_text = row[0]
        
        if not intro_text:
            missing.append(book)
            continue
        
        # Take the full text — KingComments writes the complete book intro
        # as the chapter 1 entry; no splitting needed.
        intro_text = intro_text[:MAX_INTRO_CHARS].strip()
        
        # Convert to HTML
        intro_html = text_to_html(intro_text)
        
        result[book] = intro_html
        print(f"  ✓ {book:25} chars={len(intro_text):6}  html={len(intro_html):6}")
    
    con.close()
    
    print(f"\n✓ Extracted {len(result)} books")
    if missing:
        print(f"✗ Missing: {missing}")
    
    # Write output
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"\nWrote {OUT_PATH} ({size_kb:.1f} KB)")


if __name__ == '__main__':
    main()
