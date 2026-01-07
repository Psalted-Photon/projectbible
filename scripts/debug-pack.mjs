#!/usr/bin/env node
import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const db = new Database(resolve(repoRoot, 'packs/kjv.sqlite'), { readonly: true });

console.log('\nAll verses in pack:\n');
const verses = db.prepare('SELECT book, chapter, verse, text FROM verses ORDER BY rowid').all();
verses.forEach(v => {
  console.log(`Book: ${v.book} (type: ${typeof v.book}), ${v.chapter}:${v.verse} - ${v.text.substring(0, 60)}...`);
});

db.close();
