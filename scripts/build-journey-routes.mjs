#!/usr/bin/env node

/**
 * Build annotated journey routes from biblical narratives
 * 
 * Creates detailed journey data with waypoints, events, verse references,
 * and travel information for major biblical journeys.
 * 
 * Output: data-sources/maps/extracted/journey-routes.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const OUTPUT_DIR = path.join(projectRoot, 'data-sources/maps/extracted');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'journey-routes.json');

/**
 * Journey route definitions with waypoints, events, and verses
 */
const JOURNEY_ROUTES = [
  {
    id: 'pauls-first-journey',
    name: "Paul's First Missionary Journey",
    person: 'Paul (Saul)',
    yearRange: { start: 46, end: 48 },
    period: 'roman',
    biblicalBook: 'Acts 13-14',
    description: 'First missionary journey spreading the Gospel to Gentiles',
    totalDistance: 2250, // km approximate
    waypoints: [
      {
        order: 1,
        name: 'Antioch',
        modernName: 'Antakya, Turkey',
        coordinates: [36.2, 36.15],
        arrivalDate: null,
        departureDate: 'Spring 46 AD',
        events: [{
          description: 'Set apart by Holy Spirit for missionary work',
          verses: ['Acts 13:1-3'],
          type: 'other',
          significance: 'Beginning of gentile mission'
        }],
        travelMethod: 'foot',
        icon: '🏙️'
      },
      {
        order: 2,
        name: 'Seleucia',
        modernName: 'Samandağ, Turkey',
        coordinates: [35.95, 36.08],
        distanceFromPrevious: 25,
        events: [],
        travelMethod: 'foot',
        icon: '🚢'
      },
      {
        order: 3,
        name: 'Salamis',
        modernName: 'Near Famagusta, Cyprus',
        coordinates: [33.9, 35.18],
        distanceFromPrevious: 200,
        events: [{
          description: 'Proclaimed word in Jewish synagogues',
          verses: ['Acts 13:5'],
          type: 'teaching'
        }],
        travelMethod: 'ship',
        icon: '📖'
      },
      {
        order: 4,
        name: 'Paphos',
        modernName: 'Paphos, Cyprus',
        coordinates: [32.42, 34.77],
        distanceFromPrevious: 150,
        events: [{
          description: 'Confronted sorcerer Elymas, proconsul Sergius Paulus believed',
          verses: ['Acts 13:6-12'],
          type: 'miracle',
          significance: 'First recorded gentile conversion through Paul'
        }],
        travelMethod: 'foot',
        icon: '✨'
      },
      {
        order: 5,
        name: 'Perga',
        modernName: 'Near Antalya, Turkey',
        coordinates: [30.85, 36.96],
        distanceFromPrevious: 280,
        events: [{
          description: 'John Mark left them and returned to Jerusalem',
          verses: ['Acts 13:13'],
          type: 'other'
        }],
        travelMethod: 'ship',
        icon: '🚶'
      },
      {
        order: 6,
        name: 'Pisidian Antioch',
        modernName: 'Near Yalvaç, Turkey',
        coordinates: [31.18, 38.28],
        distanceFromPrevious: 170,
        durationDays: 7,
        events: [
          {
            description: 'Preached in synagogue on Sabbath',
            verses: ['Acts 13:14-43'],
            type: 'teaching'
          },
          {
            description: 'Rejected by Jews, turned to Gentiles',
            verses: ['Acts 13:44-52'],
            type: 'persecution',
            significance: 'Pivotal moment: official turn to gentile mission'
          }
        ],
        travelMethod: 'foot',
        icon: '📖'
      },
      {
        order: 7,
        name: 'Iconium',
        modernName: 'Konya, Turkey',
        coordinates: [32.48, 37.87],
        distanceFromPrevious: 145,
        durationDays: 14,
        events: [{
          description: 'Preached boldly, many believed, but city divided',
          verses: ['Acts 14:1-7'],
          type: 'teaching'
        }],
        travelMethod: 'foot',
        icon: '📖'
      },
      {
        order: 8,
        name: 'Lystra',
        modernName: 'Near Konya, Turkey',
        coordinates: [32.55, 37.65],
        distanceFromPrevious: 30,
        events: [
          {
            description: 'Healed a crippled man',
            verses: ['Acts 14:8-10'],
            type: 'miracle'
          },
          {
            description: 'Mistaken for Zeus and Hermes, barely stopped sacrifice',
            verses: ['Acts 14:11-18'],
            type: 'other'
          },
          {
            description: 'Stoned and left for dead',
            verses: ['Acts 14:19'],
            type: 'persecution',
            significance: 'Nearly martyred'
          }
        ],
        travelMethod: 'foot',
        icon: '✨'
      },
      {
        order: 9,
        name: 'Derbe',
        modernName: 'Near Karaman, Turkey',
        coordinates: [33.22, 37.52],
        distanceFromPrevious: 95,
        events: [{
          description: 'Made many disciples',
          verses: ['Acts 14:20-21'],
          type: 'teaching'
        }],
        travelMethod: 'foot',
        icon: '📖'
      },
      {
        order: 10,
        name: 'Return through Lystra, Iconium, Antioch',
        coordinates: [32.55, 37.65],
        distanceFromPrevious: 95,
        events: [{
          description: 'Strengthened disciples, appointed elders',
          verses: ['Acts 14:21-23'],
          type: 'other'
        }],
        travelMethod: 'foot',
        icon: '🔄'
      },
      {
        order: 11,
        name: 'Return to Antioch (Syria)',
        coordinates: [36.2, 36.15],
        distanceFromPrevious: 650,
        arrivalDate: 'Fall 48 AD',
        events: [{
          description: 'Reported all that God had done, how He opened door to Gentiles',
          verses: ['Acts 14:24-28'],
          type: 'other'
        }],
        travelMethod: 'ship',
        icon: '🏙️'
      }
    ],
    style: {
      routeColor: '#4169E1',
      routeWidth: 3,
      routePattern: 'solid',
      arrowSize: 'medium'
    }
  },
  
  {
    id: 'exodus-route',
    name: 'The Exodus from Egypt',
    person: 'Moses and the Israelites',
    yearRange: { start: -1446, end: -1406 },
    period: 'bronze-age',
    biblicalBook: 'Exodus, Numbers, Deuteronomy',
    description: 'Journey from slavery in Egypt to the Promised Land',
    totalDistance: 800, // km approximate
    waypoints: [
      {
        order: 1,
        name: 'Rameses',
        modernName: 'Nile Delta, Egypt',
        coordinates: [30.8, 30.9],
        events: [{
          description: 'Departure from Egypt with 600,000 men plus families',
          verses: ['Exod 12:37'],
          type: 'other',
          significance: 'Beginning of Exodus'
        }],
        icon: '🏙️'
      },
      {
        order: 2,
        name: 'Succoth',
        coordinates: [32.1, 30.6],
        distanceFromPrevious: 50,
        events: [],
        icon: '⛺'
      },
      {
        order: 3,
        name: 'Red Sea Crossing',
        modernName: 'Gulf of Suez or Gulf of Aqaba',
        coordinates: [33.0, 29.5],
        distanceFromPrevious: 80,
        events: [{
          description: 'Waters parted, Israel crossed on dry ground, Egyptian army drowned',
          verses: ['Exod 14:21-31'],
          type: 'miracle',
          significance: 'Greatest deliverance miracle in Old Testament'
        }],
        icon: '🌊'
      },
      {
        order: 4,
        name: 'Wilderness of Shur/Marah',
        coordinates: [33.5, 29.0],
        distanceFromPrevious: 70,
        events: [{
          description: 'Bitter water made sweet',
          verses: ['Exod 15:22-27'],
          type: 'miracle'
        }],
        icon: '🪣'
      },
      {
        order: 5,
        name: 'Mount Sinai',
        modernName: 'Jebel Musa, Egypt',
        coordinates: [33.97, 28.54],
        distanceFromPrevious: 190,
        durationDays: 365,
        events: [
          {
            description: 'God gave the Ten Commandments and the Law',
            verses: ['Exod 19-24'],
            type: 'other',
            significance: 'Covenant established'
          },
          {
            description: 'Golden calf incident',
            verses: ['Exod 32'],
            type: 'other'
          },
          {
            description: 'Tabernacle constructed',
            verses: ['Exod 35-40'],
            type: 'other'
          }
        ],
        icon: '🏔️'
      },
      {
        order: 6,
        name: 'Kadesh Barnea',
        modernName: 'Negev Desert',
        coordinates: [34.4, 30.7],
        distanceFromPrevious: 250,
        durationDays: 13505, // 37 years
        events: [{
          description: 'Spies sent, Israel refused to enter land, wandered 40 years',
          verses: ['Num 13-14'],
          type: 'other',
          significance: 'Failed to enter Promised Land, 40 years wandering began'
        }],
        icon: '🏜️'
      },
      {
        order: 7,
        name: 'Plains of Moab',
        modernName: 'East of Jordan River',
        coordinates: [35.7, 31.8],
        distanceFromPrevious: 200,
        events: [
          {
            description: 'Moses viewed Promised Land from Mount Nebo',
            verses: ['Deut 34:1-4'],
            type: 'other'
          },
          {
            description: 'Moses died, Joshua appointed leader',
            verses: ['Deut 34:5-9'],
            type: 'other',
            significance: 'End of Moses era, beginning of conquest'
          }
        ],
        icon: '🏔️'
      }
    ],
    style: {
      routeColor: '#DAA520',
      routeWidth: 4,
      routePattern: 'dashed',
      arrowSize: 'large'
    }
  },
  
  {
    id: 'jesus-galilee-ministry',
    name: "Jesus' Ministry in Galilee",
    person: 'Jesus Christ',
    yearRange: { start: 27, end: 30 },
    period: 'roman',
    biblicalBook: 'Matthew, Mark, Luke, John',
    description: 'Ministry centered around the Sea of Galilee',
    totalDistance: 200,
    waypoints: [
      {
        order: 1,
        name: 'Nazareth',
        modernName: 'Nazareth, Israel',
        coordinates: [35.3, 32.7],
        events: [{
          description: 'Rejected in hometown synagogue',
          verses: ['Luke 4:16-30'],
          type: 'teaching'
        }],
        icon: '🏘️'
      },
      {
        order: 2,
        name: 'Capernaum',
        modernName: 'Tel Hum, Israel',
        coordinates: [35.57, 32.88],
        distanceFromPrevious: 35,
        events: [
          {
            description: 'Established ministry base',
            verses: ['Matt 4:13'],
            type: 'other'
          },
          {
            description: 'Healed many, cast out demons',
            verses: ['Mark 1:21-34'],
            type: 'miracle'
          },
          {
            description: 'Healed paralytic lowered through roof',
            verses: ['Mark 2:1-12'],
            type: 'miracle'
          }
        ],
        icon: '🏙️'
      },
      {
        order: 3,
        name: 'Bethsaida',
        modernName: 'Et-Tell, Israel',
        coordinates: [35.63, 32.91],
        distanceFromPrevious: 8,
        events: [{
          description: 'Fed 5,000 with five loaves and two fish',
          verses: ['Luke 9:10-17'],
          type: 'miracle',
          significance: 'Only miracle recorded in all four Gospels'
        }],
        icon: '✨'
      },
      {
        order: 4,
        name: 'Gennesaret',
        modernName: 'Northwest shore of Sea of Galilee',
        coordinates: [35.5, 32.85],
        distanceFromPrevious: 10,
        events: [{
          description: 'Healed all who touched His garment',
          verses: ['Mark 6:53-56'],
          type: 'miracle'
        }],
        icon: '✨'
      },
      {
        order: 5,
        name: 'Caesarea Philippi',
        modernName: 'Banias, Israel',
        coordinates: [35.69, 33.25],
        distanceFromPrevious: 45,
        events: [{
          description: 'Peter\'s confession: "You are the Christ"',
          verses: ['Matt 16:13-20'],
          type: 'teaching',
          significance: 'Foundation of the Church declared'
        }],
        icon: '🏛️'
      },
      {
        order: 6,
        name: 'Mount of Transfiguration',
        modernName: 'Possibly Mount Tabor or Mount Hermon',
        coordinates: [35.39, 32.69],
        distanceFromPrevious: 60,
        events: [{
          description: 'Transfigured before Peter, James, and John',
          verses: ['Matt 17:1-13', 'Mark 9:2-13', 'Luke 9:28-36'],
          type: 'miracle',
          significance: 'Divine glory revealed'
        }],
        icon: '⛰️'
      }
    ],
    style: {
      routeColor: '#32CD32',
      routeWidth: 3,
      routePattern: 'solid',
      arrowSize: 'medium'
    }
  }
];

/**
 * Main build function
 */
async function buildJourneyRoutes() {
  console.log('📦 Building journey routes...');
  
  // Calculate statistics
  let totalWaypoints = 0;
  let totalEvents = 0;
  let totalVerses = new Set();
  
  for (const journey of JOURNEY_ROUTES) {
    totalWaypoints += journey.waypoints.length;
    journey.waypoints.forEach(wp => {
      if (wp.events) {
        totalEvents += wp.events.length;
        wp.events.forEach(evt => {
          evt.verses?.forEach(v => totalVerses.add(v));
        });
      }
    });
  }
  
  console.log(`✓ ${JOURNEY_ROUTES.length} journeys defined`);
  console.log(`  ${totalWaypoints} waypoints`);
  console.log(`  ${totalEvents} events`);
  console.log(`  ${totalVerses.size} unique verse references`);
  
  // Create output structure
  const output = {
    metadata: {
      title: 'Biblical Journey Routes',
      description: 'Annotated journey routes with waypoints, events, and verse references',
      generated: new Date().toISOString(),
      totalJourneys: JOURNEY_ROUTES.length,
      totalWaypoints,
      totalEvents,
      uniqueVerses: totalVerses.size
    },
    journeys: JOURNEY_ROUTES
  };
  
  // Ensure output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Write output
  console.log(`💾 Writing to ${OUTPUT_FILE}...`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  
  const fileSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(2);
  console.log(`✅ Success! Created journey-routes.json (${fileSize} KB)`);
  console.log(`   ${JOURNEY_ROUTES.length} fully annotated journeys ready for mapping`);
}

// Run
buildJourneyRoutes().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
