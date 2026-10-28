/**
 * Dots on Voice Control: the mic button and the search bar's mic, with
 * things to say, and recording and transcribing in Notes.
 */

import type { Tip } from '../types';

const area = 'Voice';

export const VOICE_TIPS: Tip[] = [
  {
    id: 'voice-mic-button',
    area,
    target: '.fmic .mic',
    title: 'Voice Control',
    body:
      'Hold, say what you want, let go. Try “go to Romans 6”, “open Matthew Henry in a new window”, ' +
      '“highlight verse 16 in yellow”, “word study grace”, “who was James”, “where was Jesus born”, ' +
      '“how many sons did Jacob have” or “start reading from verse 5”. Several at once work too: ' +
      '“go to John 3, then open Spurgeon”. Slide off before letting go to cancel. It all runs on this device.',
  },
  {
    id: 'voice-mic-grip',
    area,
    target: '.fmic .grip',
    corner: 'top-left',
    title: 'Move the mic',
    body:
      'Drag it by these dots to wherever your thumb likes it. It stays there on this device. Hold them still ' +
      'for 2 seconds to hide the button.',
  },
  {
    id: 'voice-search-mic',
    area,
    target: '.search-mic',
    title: 'Speak to search',
    body:
      'Hold and speak. A command works here too, like “go to Psalm 23”; anything else, like “grace and peace”, ' +
      'is searched for.',
  },
  {
    id: 'voice-settings',
    area,
    target: '.sec-head .sec-title',
    text: 'Voice Control',
    exact: true,
    title: 'Voice Control',
    body:
      'Turn on the floating mic button and choose its size and which side its drag dots are on, download ' +
      'Voice Control, try a command, and choose how recordings in Notes sound: Speech, or Music for singing.',
  },
  {
    id: 'voice-record',
    area,
    target: '.recs .rec-btn',
    title: 'Record',
    body:
      'A voice note, a journal entry said out loud, a talk or a song. It’s saved every couple of seconds as it ' +
      'goes, and the screen stays awake so nothing is missed. Recordings stay on this device.',
  },
  {
    id: 'voice-record-page',
    area,
    target: '.notes-pane .icon-btn[title="Record into this page"]',
    title: 'Record into this page',
    body: 'Record here, then Transcribe, and the words land on this page.',
  },
  {
    id: 'voice-recording-pill',
    area,
    target: '.recpill',
    corner: 'top-left',
    title: 'Recording',
    body:
      'Pause, stop, or the moon for the pocket screen: black, so the screen costs little and taps in a pocket do ' +
      'nothing. On the pocket screen, hold Stop to finish.',
  },
  {
    id: 'voice-transcribe',
    area,
    target: '.recs .tx-go',
    title: 'Transcribe',
    body:
      'Turns the recording into words on a page, with periods, commas and capitals, while you carry on with the ' +
      'app. While recording you can say “new paragraph”, “heading, …” or “the first point is …” to shape the note, ' +
      'and verses you name, like “Romans six verse four”, become links.',
  },
];
