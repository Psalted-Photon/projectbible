// helpers/output.js

import fs from "fs";

export class OutputWriter {
  constructor(filename, flushEvery = 5000) {
    this.filename = filename;
    this.stream = fs.createWriteStream(filename, { flags: "w" });
    this.buffer = [];
    this.flushEvery = flushEvery;
    this.count = 0;
  }

  write(obj) {
    this.buffer.push(JSON.stringify(obj));
    this.count++;

    if (this.buffer.length >= this.flushEvery) {
      this.flush();
    }

    if (this.count % 50000 === 0) {
      console.log(`Wrote ${this.count} rows → ${this.filename}`);
    }
  }

  flush() {
    if (this.buffer.length === 0) return;
    this.stream.write(this.buffer.join("\n") + "\n");
    this.buffer = [];
  }

  close() {
    this.flush();
    this.stream.end();
  }
}
