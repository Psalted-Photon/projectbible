#!/usr/bin/env node

import fs from 'fs';

const data = JSON.parse(fs.readFileSync('./data-sources/maps/extracted/place-verse-links.json', 'utf8'));

console.log('📊 Place-Verse Correlations Preview\n');

console.log('Sample verse→places:');
Object.entries(data.verseToPlaces).slice(0, 10).forEach(([verse, placeIds]) => {
  const placeNames = placeIds.map(id => data.placeMetadata[id]?.name || id).join(', ');
  console.log(`  ${verse}: ${placeNames}`);
});

console.log('\nSample place→verses (places mentioned most):');
const sortedPlaces = Object.entries(data.placeToVerses)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 10);

sortedPlaces.forEach(([placeId, verses]) => {
  const place = data.placeMetadata[placeId];
  console.log(`  ${place.name}: ${verses.length} verses (${verses.slice(0, 3).join(', ')}...)`);
});

console.log(`\n✅ Total: ${Object.keys(data.verseToPlaces).length} verses, ${Object.keys(data.placeToVerses).length} places`);
