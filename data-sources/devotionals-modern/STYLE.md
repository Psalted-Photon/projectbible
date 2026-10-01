# Modern-English Spurgeon: style guide

This folder holds a plain modern-English version of Spurgeon's *Morning and Evening* and *Faith's Checkbook*, with notes on the old words and phrases. The app shows it beside the original (an Original / Modern switch) and puts the notes behind an (i) in the top bar.

It is our own writing, not a download, so it is kept in git (see the exception in `.gitignore`).

## Where the original comes from

`node scripts/export-devotionals-for-modernizing.mjs [month]` writes each reading out of the built pack as numbered blocks to `data-sources/devotionals/modernize-export/<workId>-<MM>.md` (gitignored). A block is one paragraph or one poem. Write against those numbers.

## File layout

One JSON file per work per month: `spurgeon-me/01.json`, `faiths-checkbook/01.json`. Each key is the reading, `MM-DD:slot` (slot is `morning` or `evening` for *Morning and Evening*, `day` for *Faith's Checkbook*):

```json
{
  "01-03:morning": {
    "modern": ["First block, rewritten.\n\nIt can split into paragraphs.", null],
    "notes": [
      { "term": "Entailed", "note": "An old legal term…" }
    ]
  }
}
```

- `modern` has exactly one entry per original block, in the same order.
- An entry may split into several paragraphs, with a blank line (`\n\n`) between them. Spurgeon's long single-paragraph readings should be split where the thought turns.
- A poem or hymn verse is `null`. The app shows the original verse unchanged.
- `notes` are in the order the terms come up in the reading.

Markup, the same as the export:

- `*words*` for emphasis
- `^words^` for small caps (rarely needed: Spurgeon's small caps stress the words of the text, and emphasis does that job in modern text)
- `[[Osis|label]]` for a Scripture link, e.g. `[[Ps.42.1|Psalm 42:1]]`. Book codes are the pack's OSIS codes (`Gen`, `Exod`, `Ps`, `Song`, `1Kgs`, `Matt`, `1John`…). A range is `Song.4.13-Song.4.14`.

Every Scripture link in an original block must also be in its modern entry. The pack build checks this.

## Voice

Set from the approved sample, Spurgeon's "a living dog… a dead lion" passage with its notes on "unction", "quicken" and "dead calms":

- **Plain words.** Say "make alive", not "quicken"; "pure", not "unalloyed". A word that is still in ordinary use stays, even if it sounds a little formal.
- **Shorter sentences.** Break up the long chains of clauses. Keep his rhythm where it carries the feeling: the piled-up lists, the exclamations, the closing prayer.
- **Contractions.** "Don't", "we'll", "it's", the way people talk.
- **Metaphors explained lightly.** Keep the picture and add just enough to make it land: "it's like a dead lion: to the living God, it's nothing but a rotting carcass." Don't turn an image into a lecture.
- **Spurgeon's meaning kept.** Nothing added that he didn't say, nothing softened. "Absence from Christ is hell" stays hell. If he is stern, the modern text is stern.
- **His warmth kept.** He talks to the reader and to God in the same breath. Keep the "you", the "my soul", the "O Lord" (as "Oh, Lord" only where it is an exclamation rather than an address).

### Conversions

- thee, thou, thy, thine → you, your, yours (outside quotations)
- -eth, -est verbs → modern forms (continueth → keeps going; dost thou → do you)
- "beloved", "my brother" (to the reader) → "dear reader", "dear friend", "my friend"
- "O for…" → "Oh, for…"
- American spelling in the modern text (honor, Savior, plow). Quotations keep their own spelling.
- Curly quotes and apostrophes throughout: “ ” ‘ ’

### What stays word for word

- **Anything in quotation marks.** Bible quotes stay exactly as Spurgeon quotes them, King James wording and all, even where he quotes from memory and it differs from the KJV. The same goes for quoted hymn lines and sayings. A note can point out a misquote.
- **Hymn and poem verses** (the `null` blocks).
- **Echoes of Scripture without quotation marks** can be put in plain words ("as the hart panteth after the water-brooks" → "the way a deer pants for streams of water"), with a note giving the source when it helps.
- **The italic headings** that walk through the text's own words (January 3, evening) keep the Bible's wording where it's already plain.

### Fixes

The sources have a few typos. Fix them quietly in the modern text ("so are we preserve" → "preserved"; a quotation that never closes gets closed). Never fix them in the original.

## Notes

The (i) panel works in both views, so notes explain what a reader of the *original* trips over:

- old words ("vouchsafed", "miry", "holpen")
- words whose meaning has shifted ("complacency", "virtually", "corn")
- church words of the time ("covenant of grace", "imputed", "ordinances")
- allusions he doesn't name: a Bible story, a hymn, a proverb, a line of Shakespeare

Each note: start with the meaning, plain, in one to three sentences. Add the source as a Scripture link when there is one. Skip words a modern reader already knows. Aim for about five to ten a reading.

## Glossary

So a word is explained the same way every time it comes up. Add to this as the year goes on.

| Term | Explanation |
|---|---|
| Advent | A coming or arrival. The Second Advent is Christ's return. |
| Bowels (yearned) | Deep feelings. The King James Bible places tender feelings in the gut, the way we place them in the heart. |
| Carnal | Of the flesh: the desires of our fallen human nature, not only sexual ones. |
| The Comforter | The Holy Spirit; Jesus' name for him in John 14:26. |
| Communion | Close fellowship and sharing, with God or with each other. (Also the Lord's Supper.) |
| Complacency | In Spurgeon's day, quiet pleasure and satisfaction, without today's sense of being smug. |
| Contrite | Crushed with sorrow over sin. |
| Corruptions | The sinful desires still at work in a believer. |
| Covenant of grace | God's binding promise to save his people through Christ, freely, as a gift and not a reward. |
| Despondency | Feeling low and discouraged. |
| Draught | A drink; a long swallow. |
| Earnest | A deposit paid up front to promise the rest will follow (Ephesians 1:14). |
| Effectual | Effective; actually doing what it sets out to do. |
| Hart | A male deer. |
| Imputed | Credited to someone's account. Christ's righteousness is counted as the believer's own. |
| Kinsman | A relative, especially one with the right and duty to rescue family (as Boaz did for Ruth). |
| Means (of grace) | The ordinary ways God feeds faith: the Bible, prayer, preaching, the Lord's Supper. |
| Meet | Suitable, fitting. |
| Ordinances | The practices Christ gave the church, chiefly baptism and the Lord's Supper. |
| Portion | A share of an inheritance. When God is "our portion", he himself is what we inherit, and he is enough. |
| Profession, professing | Publicly claiming to be a Christian. A "dead profession" is the claim with no faith behind it. |
| Quicken | To make alive. "Quick" once meant "living", as in "the quick and the dead". |
| Seed | Offspring, descendants. |
| Unction | Literally "anointing": the Holy Spirit's power in a sermon or prayer, the thing that makes it reach the heart. |
| Virtually | In effect, in all that matters (not "almost"). |
| Vouchsafe(d) | Graciously give or grant. |
| Woe to | An old warning: "how terrible it will be for…". |
