# Journey sources

Three things live here:

| | |
|---|---|
| `ubs-routes/` | 179 GeoJSON files from UBS Project MARBLE. **Gitignored.** Re-fetch with `node scripts/atlas/fetch-ubs-routes.mjs`. |
| `LICENSE.md` | The CC BY-SA 4.0 notice, verbatim, and where the licence boundary sits. |
| `journey-index.json` | Ours. The editorial layer — which journeys ship, what they are called, which places are stops, in what order, in what colour. |

UBS supplies lines. The index decides what those lines mean.

## What the survey of the 179 files found

Worth writing down, because it is why `journey-index.json` has the shape it has
and not a simpler one.

**The geometry is bare.** 508 LineStrings across 179 files, and `properties` is
empty on all but three of them (`025`, `177` carry a stray `"Overlay (Copy)"`;
`061` has a null feature). No names, no dates, no verse references, no stop
markers. That is convenient for the licence boundary — there is nothing in
these files to separate out, because they are pure coordinates — but it means
every name a reader will see has to come from us.

**Segments are not in travel order.** This is the finding that shaped the file.
In `202. First Missionary Journey`, segment 0 is Attalia→Antioch, which is the
*return* leg, and segment 6 is Seleucia→Salamis, which is near the start.
Reading the segments in file order would draw the journey scrambled.

**And they cannot simply be auto-chained.** Greedy nearest-endpoint chaining
works on some routes (First Journey joins with a 28 km worst gap, Voyage to Rome
23 km) and fails badly on others — Second Journey leaves a 309 km gap, Third
Journey 370 km. Those gaps are not errors in the data. They are open water that
Ritmeyer drew as separate strokes: the Second Journey's segments genuinely do
not form one connected path, because Paul sailed between coasts that no drawn
line connects. A generic chainer would either give up or invent a line across
the Aegean that UBS never drew.

So the index maps legs to segments **explicitly**, by index and direction. It is
more typing, and it is the only version that is correct.

**Direction is unreliable too.** Several files are drawn against the direction
their own name implies: `001. Abram's Journey to Haran` runs Haran→Chaldeans,
and `155a. Bethlehem to Egypt` runs Egypt→Bethlehem. Hence `"reverse": true`
rather than trusting the filename.

**Stop names resolve well.** Of 96 candidate stops checked against
`atlas_biblical_places`, 93 matched by id directly. The three that did not have
answers in the gazetteer under other names — `Forum of Appius` for Appii Forum,
`Dalmanutha` for Magdala (modern Majdal) — except Antipatris, which is genuinely
absent and is not used.

## Shape of `journey-index.json`

```
journeys[]
  id           our id, kebab-case, stable — the join key for all three tables
  name         what the reader sees
  traveller    who
  dates        display string, already era-labelled ("AD 46–48", "1446–1406 BC")
  testament    "old" | "new"  — the grouping in the Layers sub-list
  colour       this journey's line colour
  sort_order   order within its testament
  description  one line
  source[]     which UBS file, which segments, in which direction
    file         filename under ubs-routes/
    segments[]   segment indices, in travel order
    reverse[]    segment indices that are drawn backwards
  stops[]
    place_id     must resolve in atlas_biblical_places — Phase 3 fails loudly
    by           "foot" | "ship" | … — decides solid vs dashed
    note         what happened here
```

`stops[]` carries no coordinates and no verses on purpose. Both are looked up
from `atlas_biblical_places` by `place_id` at build time, so there is one place
where a stop's location is recorded and the journeys do not drift from the
gazetteer.
