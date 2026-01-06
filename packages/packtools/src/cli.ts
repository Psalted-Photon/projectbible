#!/usr/bin/env node

import { Command } from 'commander';
import { buildPack } from './commands/build.js';
import { validateManifest } from './commands/validate.js';

const program = new Command();

program
  .name('packtools')
  .description('ProjectBible pack builder and validator')
  .version('0.0.0');

program
  .command('build')
  .description('Build a pack from a source manifest')
  .argument('<manifest>', 'Path to source manifest JSON file')
  .option('-o, --output <path>', 'Output path for the pack file')
  .action(buildPack);

program
  .command('validate')
  .description('Validate a source manifest against the schema')
  .argument('<manifest>', 'Path to source manifest JSON file')
  .action(validateManifest);

program.parse();
