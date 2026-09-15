/**
 * Dots in the panes: Settings, Manage Packs and the Wake Alarm, and the pane
 * frame itself. Settings rows are found by their labels, which is all that
 * tells them apart.
 */

import type { Tip } from '../types';

const area = 'Panes';

function section(title: string, body: string): Tip {
  return {
    id: `settings-${title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '')}`,
    area,
    target: '.pane-settings .sec-title',
    text: title,
    exact: true,
    title,
    body,
  };
}

function setting(id: string, label: string, title: string, body: string, exact = false): Tip {
  return { id, area, target: '.pane-settings .label-text', text: label, exact, title, body };
}

export const PANE_TIPS: Tip[] = [
  {
    id: 'pane-resize',
    area,
    target: '.pane > .resize-handle',
    corner: 'center',
    title: 'Resize',
    body: 'Drag this edge to make the pane bigger or smaller. Drag it nearly shut and let go to close it.',
  },

  // ── Settings ─────────────────────────────────────────────────────────────
  section('Appearance', 'The theme, text size and line spacing. The Custom theme picks the reader’s own typeface and colors.'),
  section('Reader', 'How the text is laid out, red letters, art icons, and whether a tapped word gets the ring or the classic popup.'),
  section('Interlinear (Greek & Hebrew)', 'Which layers show under each Greek or Hebrew word.'),
  section('Read Aloud (AI voice)', 'The voice, its speed, and what gets read and lit up as it reads. The Wake Alarm is here too.'),
  section('General', 'Tutorial Mode, your time zone, the clock in the top bar, and screen rotation.'),
  section('Privacy', 'The journal lock: your fingerprint or face before the Journal opens, with your journal scrambled on this device and in the cloud.'),
  section('Storage & Updates', 'Manage Packs, check for a new version, or clear everything out if the app gets stuck.'),

  setting('settings-theme', 'Theme', 'Theme', 'Auto follows your device. Sepia and Light are easier in daylight; Custom is yours to set.', true),
  setting('settings-layout', 'Verse Layout', 'Verse layout', 'One verse per line, or flowing paragraphs, with or without verse numbers.'),
  setting('settings-pin-bar', 'Keep the navigation bar visible', 'Keep the top bar', 'The top bar slides away while you read and comes back when you scroll up. Tick this to keep it.'),
  setting('settings-word-menu', 'Menu when you tap a word', 'The word menu', 'The ring around the word, or the classic popup bar.'),
  setting('settings-voice', 'Voice', 'Voice', 'Natural voices sound most like a real reader. Standard ones are lighter on the battery.', true),
  setting('settings-tutorial', 'Tutorial Mode', 'Tutorial Mode', 'Untick to turn the tutorial off. Tick it again anytime to replay the tour.', true),
  {
    id: 'settings-wake-alarm',
    area,
    target: '.pane-settings .alarm-button',
    title: 'Wake Alarm',
    body: 'A notification at the time you choose that opens straight into your reading.',
  },
  {
    id: 'settings-manage-packs',
    area,
    target: '.pane-settings .packs-button:not(.alarm-button)',
    title: 'Manage Packs',
    body: 'Install, remove and repair packs and Read Aloud voices.',
  },
  {
    id: 'settings-updates',
    area,
    target: '.pane-settings .check-update-button',
    title: 'Check for updates',
    body: 'Looks for a newer version of Hexapla.',
  },
  {
    id: 'settings-clear-cache',
    area,
    target: '.pane-settings .clear-cache-button',
    title: 'Clear cache',
    body: 'A last resort when packs won’t install or the app seems stuck. It deletes every pack on this device, so they need installing again.',
  },

  // ── Manage Packs ─────────────────────────────────────────────────────────
  {
    id: 'packs-install-all',
    area,
    target: '.pane-packs .install-all-btn',
    title: 'Install all',
    body: 'Installs every pack and voice, one at a time. If it gets interrupted, tap again and it picks up where it stopped.',
  },
  {
    id: 'packs-restart',
    area,
    target: '.pane-packs .restart-btn',
    title: 'Restart',
    body: 'New packs switch on after a restart.',
  },
  {
    id: 'packs-unfinished',
    area,
    target: '.pane-packs .pill-flag',
    title: 'Install unfinished',
    body: 'This pack stopped partway. Install it again to finish it.',
  },
  {
    id: 'packs-about',
    area,
    target: '.pane-packs .icon-btn[aria-label^="About"]',
    title: 'What’s inside',
    body: 'What the pack holds, where it shows up in the app, and its license.',
  },
  {
    id: 'packs-install-one',
    area,
    target: '.pane-packs .icon-btn[aria-label^="Install"], .pane-packs .icon-btn[aria-label^="Re-download"]',
    title: 'Install just this one',
    body: 'Downloads this pack or voice on its own.',
  },
  {
    id: 'packs-remove',
    area,
    target: '.pane-packs .icon-btn.danger',
    title: 'Remove',
    body: 'Deletes it from this device to free up space. You can install it again anytime.',
  },
  {
    id: 'packs-advanced',
    area,
    target: '.pane-packs .small-btn',
    text: ['From URL', 'From File'],
    title: 'Advanced install',
    body: 'Install a pack file you already have, from a link or from this device.',
  },
  {
    id: 'packs-own-voice',
    area,
    target: '.pane-packs .small-btn',
    text: 'voice from file',
    title: 'Your own voice',
    body: 'Install a voice file of your own for Read Aloud.',
  },

  // ── Wake Alarm ───────────────────────────────────────────────────────────
  {
    id: 'alarm-needs',
    area,
    target: '.alarm-pane .requirement-box',
    title: 'What it needs',
    body: 'You need to be signed in, allow notifications, and have internet when it rings.',
  },
  {
    id: 'alarm-on',
    area,
    target: '.alarm-pane .label-text',
    text: 'Alarm on',
    exact: true,
    title: 'Alarm on',
    body: 'Switch the alarm on or off. Save afterwards.',
  },
  {
    id: 'alarm-days',
    area,
    target: '.alarm-pane .day-row',
    title: 'Days',
    body: 'Pick the days it rings. The buttons below set the usual patterns in one tap.',
  },
  {
    id: 'alarm-reading',
    area,
    target: '.alarm-pane .label-text',
    text: 'What to read',
    exact: true,
    title: 'What to read',
    body: 'Carry on where you left off, a chapter you pick, or your reading plan’s next reading.',
  },
  {
    id: 'alarm-save',
    area,
    target: '.alarm-pane .save-button',
    title: 'Save',
    body: 'Nothing changes until you save. Saving an alarm that’s on asks for permission to send notifications.',
  },
  {
    id: 'alarm-test',
    area,
    target: '.alarm-pane .test-button',
    title: 'Test it',
    body: 'Preview the notification, or have the server send a real one. Lock your phone first for the real test.',
  },
];
