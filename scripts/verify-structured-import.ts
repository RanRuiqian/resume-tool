/** Read-only local check; prints aggregate counts and missing IDs, never personal fields/grades or raw text. */
import { readFileSync } from 'node:fs';
import { parseStructuredLibrary } from '../src/ai/structuredImport';
const path = process.argv[2];
if (!path) throw new Error('Usage: npm run verify:import -- /local/path/to/library.txt (read-only; no AI or database access)');
const result = parseStructuredLibrary(readFileSync(path, 'utf8'));
if (!result) { console.error('未识别到支持的编号母库结构；未调用 AI，未写入资料'); process.exitCode = 1; }
else {
  console.log(JSON.stringify({ complete: result.integrity.complete, groups: result.integrity.groups.map((g) => ({ label: g.label, source: g.declared ?? g.expected.length, recognized: g.recognized.length, missing: g.missing })), issues: result.integrity.issues }, null, 2));
  if (!result.integrity.complete) process.exitCode = 1;
}
