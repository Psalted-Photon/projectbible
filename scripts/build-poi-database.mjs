#!/usr/bin/env node

/**
 * Build Points of Interest (POI) database
 * 
 * Creates database of significant biblical locations with icons, descriptions,
 * events, and verse references.
 * 
 * Output: data-sources/maps/extracted/poi-database.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const OUTPUT_DIR = path.join(projectRoot, 'data-sources/maps/extracted');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'poi-database.json');

/**
 * POI type enum with icons
 */
const POI_TYPES = {
  TEMPLE: { icon: '🏛️', label: 'Temple / Sacred Site' },
  BATTLE: { icon: '⚔️', label: 'Battle Site' },
  CITY: { icon: '🏙️', label: 'Major City' },
  VILLAGE: { icon: '🏘️', label: 'Village' },
  MOUNTAIN: { icon: '🏔️', label: 'Mountain' },
  WATER: { icon: '🌊', label: 'Water Crossing / Sea' },
  WELL: { icon: '🪣', label: 'Well / Spring' },
  ALTAR: { icon: '🔥', label: 'Altar / Sacrifice Site' },
  TOMB: { icon: '⚰️', label: 'Tomb / Burial Site' },
  MIRACLE: { icon: '✨', label: 'Miracle Site' },
  VISION: { icon: '👁️', label: 'Vision / Revelation Location' },
  GATE: { icon: '🚪', label: 'City Gate' },
  PALACE: { icon: '👑', label: 'Palace / Royal Site' },
  SYNAGOGUE: { icon: '📜', label: 'Synagogue' },
  CHURCH: { icon: '✝️', label: 'Early Church' },
  PRISON: { icon: '⛓️', label: 'Prison / Captivity' }
};

/**
 * Points of Interest definitions
 */
const POIS = [
  {
    id: 'poi-temple-solomon',
    name: 'Temple of Solomon (First Temple)',
    type: 'TEMPLE',
    coordinates: [35.2354, 31.7780],
    significance: 'First Temple, center of Israelite worship for 400 years',
    events: [
      {
        description: 'Solomon dedicates the Temple',
        verses: ['1 Kgs 8:1-66', '2 Chr 5-7'],
        year: -950,
        type: 'dedication'
      },
      {
        description: 'Ark of the Covenant placed in Holy of Holies',
        verses: ['1 Kgs 8:6'],
        year: -950
      },
      {
        description: 'Destroyed by Babylonians under Nebuchadnezzar',
        verses: ['2 Kgs 25:8-9', '2 Chr 36:19'],
        year: -586,
        type: 'destruction'
      }
    ],
    verses: ['1 Kgs 6-8', '2 Chr 3-7', 'Ezek 40-48'],
    timePeriod: 'United Kingdom - Babylonian Exile',
    modernStatus: 'built-over',
    modernName: 'Temple Mount, Jerusalem'
  },
  
  {
    id: 'poi-temple-second',
    name: 'Second Temple (Herod\'s Temple)',
    type: 'TEMPLE',
    coordinates: [35.2354, 31.7780],
    significance: 'Rebuilt temple, site of Jesus\' ministry and early church',
    events: [
      {
        description: 'Temple rebuilt after Babylonian exile',
        verses: ['Ezra 6:15'],
        year: -516,
        type: 'dedication'
      },
      {
        description: 'Herod begins massive reconstruction',
        verses: ['John 2:20'],
        year: -20
      },
      {
        description: 'Jesus cleanses the temple',
        verses: ['Matt 21:12-13', 'Mark 11:15-17'],
        year: 30,
        type: 'miracle'
      },
      {
        description: 'Destroyed by Romans under Titus',
        verses: ['Matt 24:1-2'],
        year: 70,
        type: 'destruction'
      }
    ],
    verses: ['Ezra 3-6', 'John 2:13-22', 'Matt 24:1-2'],
    timePeriod: 'Persian - Roman',
    modernStatus: 'ruins',
    modernName: 'Western Wall, Jerusalem'
  },
  
  {
    id: 'poi-golgotha',
    name: 'Golgotha (Calvary)',
    type: 'MIRACLE',
    coordinates: [35.2295, 31.7784],
    significance: 'Site of Jesus\' crucifixion and resurrection',
    events: [
      {
        description: 'Jesus crucified',
        verses: ['Matt 27:33-56', 'Mark 15:22-41', 'Luke 23:33-49', 'John 19:17-37'],
        year: 30,
        type: 'crucifixion'
      },
      {
        description: 'Jesus buried in nearby tomb',
        verses: ['Matt 27:57-61', 'John 19:38-42'],
        year: 30
      },
      {
        description: 'Jesus resurrected',
        verses: ['Matt 28', 'Mark 16', 'Luke 24', 'John 20-21'],
        year: 30,
        type: 'resurrection'
      }
    ],
    verses: ['Matt 27-28', 'Mark 15-16', 'Luke 23-24', 'John 19-20'],
    timePeriod: 'Roman',
    modernStatus: 'preserved',
    modernName: 'Church of the Holy Sepulchre or Garden Tomb, Jerusalem'
  },
  
  {
    id: 'poi-mount-sinai',
    name: 'Mount Sinai (Horeb)',
    type: 'MOUNTAIN',
    coordinates: [33.97, 28.54],
    significance: 'Where God gave Moses the Ten Commandments',
    events: [
      {
        description: 'Moses receives Ten Commandments',
        verses: ['Exod 19-20', 'Deut 5'],
        year: -1446,
        type: 'revelation'
      },
      {
        description: 'Covenant established between God and Israel',
        verses: ['Exod 24'],
        year: -1446
      },
      {
        description: 'Moses sees God\'s glory',
        verses: ['Exod 33:18-23'],
        year: -1446,
        type: 'vision'
      },
      {
        description: 'Elijah flees here, hears still small voice',
        verses: ['1 Kgs 19:8-18'],
        year: -850
      }
    ],
    verses: ['Exod 19-34', '1 Kgs 19', 'Gal 4:24-25'],
    timePeriod: 'Bronze Age',
    modernStatus: 'preserved',
    modernName: 'Jebel Musa, Sinai Peninsula, Egypt'
  },
  
  {
    id: 'poi-bethlehem',
    name: 'Bethlehem',
    type: 'CITY',
    coordinates: [35.2, 31.7],
    significance: 'Birthplace of King David and Jesus Christ',
    events: [
      {
        description: 'David born and anointed king',
        verses: ['1 Sam 16:1-13'],
        year: -1040
      },
      {
        description: 'Jesus born in a manger',
        verses: ['Luke 2:1-20', 'Matt 2:1'],
        year: -4,
        type: 'nativity'
      },
      {
        description: 'Shepherds visit baby Jesus',
        verses: ['Luke 2:8-20'],
        year: -4
      },
      {
        description: 'Wise men arrive from the East',
        verses: ['Matt 2:1-12'],
        year: -4
      }
    ],
    verses: ['Ruth 1:1', 'Mic 5:2', 'Matt 2', 'Luke 2'],
    timePeriod: 'Iron Age - Roman',
    modernStatus: 'inhabited',
    modernName: 'Bethlehem, West Bank'
  },
  
  {
    id: 'poi-jericho-walls',
    name: 'Walls of Jericho',
    type: 'BATTLE',
    coordinates: [35.4444, 31.8697],
    significance: 'First conquest victory in Promised Land',
    events: [
      {
        description: 'Israelites march around city, walls collapse',
        verses: ['Josh 6:1-27'],
        year: -1406,
        type: 'miracle'
      },
      {
        description: 'Rahab and family spared',
        verses: ['Josh 6:22-25'],
        year: -1406
      }
    ],
    verses: ['Josh 6', 'Heb 11:30'],
    timePeriod: 'Bronze Age',
    modernStatus: 'ruins',
    modernName: 'Tell es-Sultan, West Bank'
  },
  
  {
    id: 'poi-jacob-well',
    name: 'Jacob\'s Well',
    type: 'WELL',
    coordinates: [35.275, 32.213],
    significance: 'Where Jesus met the Samaritan woman',
    events: [
      {
        description: 'Jacob dug the well',
        verses: ['John 4:6'],
        year: -1900
      },
      {
        description: 'Jesus offers living water to Samaritan woman',
        verses: ['John 4:1-26'],
        year: 27,
        type: 'teaching'
      }
    ],
    verses: ['Gen 33:18-20', 'John 4:1-42'],
    timePeriod: 'Bronze Age - Roman',
    modernStatus: 'preserved',
    modernName: 'Near Nablus, West Bank'
  },
  
  {
    id: 'poi-mount-carmel',
    name: 'Mount Carmel',
    type: 'MOUNTAIN',
    coordinates: [35.05, 32.73],
    significance: 'Elijah\'s confrontation with prophets of Baal',
    events: [
      {
        description: 'Elijah challenges 450 prophets of Baal',
        verses: ['1 Kgs 18:19-40'],
        year: -850,
        type: 'miracle'
      },
      {
        description: 'Fire from heaven consumes sacrifice',
        verses: ['1 Kgs 18:38'],
        year: -850
      }
    ],
    verses: ['1 Kgs 18:19-46'],
    timePeriod: 'Iron Age',
    modernStatus: 'preserved',
    modernName: 'Mount Carmel, Israel'
  },
  
  {
    id: 'poi-pool-bethesda',
    name: 'Pool of Bethesda',
    type: 'MIRACLE',
    coordinates: [35.2363, 31.7808],
    significance: 'Jesus healed paralytic who waited 38 years',
    events: [
      {
        description: 'Jesus heals man unable to reach pool',
        verses: ['John 5:1-15'],
        year: 28,
        type: 'miracle'
      }
    ],
    verses: ['John 5:1-15'],
    timePeriod: 'Roman',
    modernStatus: 'ruins',
    modernName: 'Old City, Jerusalem'
  },
  
  {
    id: 'poi-upper-room',
    name: 'Upper Room',
    type: 'CHURCH',
    coordinates: [35.2294, 31.7718],
    significance: 'Last Supper and Pentecost',
    events: [
      {
        description: 'Last Supper, Jesus institutes communion',
        verses: ['Luke 22:7-38', 'John 13-17'],
        year: 30
      },
      {
        description: 'Jesus appears to disciples after resurrection',
        verses: ['John 20:19-23'],
        year: 30
      },
      {
        description: 'Holy Spirit descends at Pentecost',
        verses: ['Acts 2:1-41'],
        year: 30,
        type: 'vision'
      }
    ],
    verses: ['Mark 14:12-26', 'Luke 22:7-38', 'Acts 1:12-14', 'Acts 2'],
    timePeriod: 'Roman',
    modernStatus: 'traditional-site',
    modernName: 'Cenacle, Mount Zion, Jerusalem'
  }
];

/**
 * Main build function
 */
async function buildPOIDatabase() {
  console.log('📦 Building Points of Interest database...');
  
  // Add type metadata to each POI
  const enhancedPOIs = POIS.map(poi => ({
    ...poi,
    typeIcon: POI_TYPES[poi.type].icon,
    typeLabel: POI_TYPES[poi.type].label,
    totalEvents: poi.events.length,
    uniqueVerses: [...new Set(poi.verses)].length
  }));
  
  // Calculate statistics
  const totalEvents = POIS.reduce((sum, poi) => sum + poi.events.length, 0);
  const allVerses = new Set();
  POIS.forEach(poi => poi.verses.forEach(v => allVerses.add(v)));
  
  console.log(`✓ ${POIS.length} POIs defined`);
  console.log(`  ${totalEvents} historical events`);
  console.log(`  ${allVerses.size} unique verse references`);
  
  // Group by type
  const byType = {};
  POIS.forEach(poi => {
    if (!byType[poi.type]) byType[poi.type] = 0;
    byType[poi.type]++;
  });
  
  console.log('\n  By type:');
  Object.entries(byType).forEach(([type, count]) => {
    console.log(`    ${POI_TYPES[type].icon} ${POI_TYPES[type].label}: ${count}`);
  });
  
  // Create output structure
  const output = {
    metadata: {
      title: 'Biblical Points of Interest',
      description: 'Significant locations with icons, descriptions, and verse references',
      generated: new Date().toISOString(),
      totalPOIs: POIS.length,
      totalEvents,
      uniqueVerses: allVerses.size,
      types: Object.keys(POI_TYPES).map(key => ({
        type: key,
        icon: POI_TYPES[key].icon,
        label: POI_TYPES[key].label
      }))
    },
    pois: enhancedPOIs
  };
  
  // Ensure output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Write output
  console.log(`\n💾 Writing to ${OUTPUT_FILE}...`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  
  const fileSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(2);
  console.log(`✅ Success! Created poi-database.json (${fileSize} KB)`);
  console.log(`   ${POIS.length} points of interest ready for mapping`);
}

// Run
buildPOIDatabase().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
