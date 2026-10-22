// Build-time: reduce GeoNames cities (via all-the-cities) to a compact [lon, lat, population]
// table used to paint the Earth-at-night texture. Vector data only, no images.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cities = require('all-the-cities');
const MIN_POP = 8000;
const rows = cities
  .filter((c) => c.population >= MIN_POP)
  .map((c) => [+c.loc.coordinates[0].toFixed(2), +c.loc.coordinates[1].toFixed(2), c.population]);
const out = path.resolve(import.meta.dirname, '../src/data/cities.json');
fs.writeFileSync(out, JSON.stringify(rows));
console.log(`${rows.length} cities ≥ ${MIN_POP} → ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
