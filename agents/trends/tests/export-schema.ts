/**
 * Writes schema.json (repo root) from the runtime BRIEF_SCHEMA constant.
 * Run: npm run schema   — the unit test asserts the two stay identical.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { BRIEF_SCHEMA } from '../_schema.js';

const target = resolve(process.cwd(), 'schema.json');
await writeFile(target, `${JSON.stringify(BRIEF_SCHEMA, null, 2)}\n`, 'utf8');
console.log(`schema.json written → ${target}`);
