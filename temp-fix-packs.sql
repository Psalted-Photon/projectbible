-- Fix byz-full.sqlite
UPDATE metadata SET value='byz-full' WHERE key='pack_id' OR (key='pack_id' AND value IS NULL);
INSERT OR IGNORE INTO metadata (key, value) VALUES ('pack_id', 'byz-full');
INSERT OR IGNORE INTO metadata (key, value) VALUES ('translation_id', 'BYZ');
INSERT OR IGNORE INTO metadata (key, value) VALUES ('translation_name', 'Byzantine Majority Text');

-- Fix web.sqlite
UPDATE metadata SET value='1.0.0' WHERE key='version' OR (key='version' AND value IS NULL);
INSERT OR IGNORE INTO metadata (key, value) VALUES ('version', '1.0.0');

-- Fix tr-full.sqlite
INSERT OR IGNORE INTO metadata (key, value) VALUES ('pack_id', 'tr-full');
INSERT OR IGNORE INTO metadata (key, value) VALUES ('translation_id', 'TR');
INSERT OR IGNORE INTO metadata (key, value) VALUES ('translation_name', 'Textus Receptus');
