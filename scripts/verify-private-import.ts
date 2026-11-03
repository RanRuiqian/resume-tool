/** Local opt-in V7 verification. Never prints source text, names, contacts, grades, credentials or profile diffs. */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { parseStructuredLibrary } from '../src/ai/structuredImport';
import { scanFactLibrary } from '../src/ai/factLibrary';
import { applyImportPlan, buildImportPlan } from '../src/ai/importPlan';
import { emptyProfile, normalizeProfile } from '../src/storage/profileIO';
import { ResumeDB } from '../src/storage/db';
import { persistProfile, profileEpoch } from '../src/storage/clearProfile';
import { DEFAULT_SETTINGS } from '../src/storage/defaults';
import { profileForGeneration } from '../src/privacy/resume';
const path = process.argv[2]; if (!path) throw new Error('Usage: npm run verify:import:private -- /local/path/library.txt');
const bytes = readFileSync(path), input = bytes.toString('utf8'), checksum = createHash('sha256').update(bytes).digest('hex');
let checks = 0;
function check(ok: unknown, label: string) { if (!ok) throw new Error(`Private verification failed: ${label}`); checks++; }
const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('External API disabled in private verification'); };
const dbName = `private-v7-verification-${randomUUID()}`;
let d = new ResumeDB(dbName);
try {
  const result = parseStructuredLibrary(input); check(!!result, 'structured detection'); if (!result) throw new Error('No structured result');
  const { profile, integrity } = result, source = scanFactLibrary(input);
  check(integrity.complete && !integrity.issues.length, 'no missing records or contradictions');
  check(source.length === 299 && profile.sourceFacts?.length === 299, '299 source fact records, legend is not a fact');
  check(profile.sourceFacts!.every((f) => source.find((x) => x.id === f.id)?.raw === f.raw && f.entityIds.length > 0), 'every fact raw and mapping retained');
  check(profile.courses?.filter((c) => c.level === 'bachelor').length === 76, '76 bachelor courses');
  check(profile.courses?.filter((c) => c.level === 'master').length === 6, '6 master courses, summaries excluded');
  for (const course of profile.courses!) {
    const fact = source.find((f) => f.id === course.sourceRecord?.id)!;
    const cols = fact.body.split('\n')[0].split('｜').map((s) => s.trim());
    check(course.grade.raw === cols[3], 'course grade matches exact original cell');
    check(course.level === 'bachelor' ? course.credits === cols[2].replace(/\s*学分[。.]?$/, '') : course.credits === '', 'credits preserved; absent master credits not guessed');
    check(course.level === 'bachelor' ? course.name.zh === cols[0] && course.name.en === cols[1] : course.code === cols[1] && !!course.name.en && !!course.name.zh, 'course names and code preserved');
    check(course.sourceRecord?.raw === fact.raw && !!(course.synopsis.zh || course.synopsis.en), 'complete source and explanation retained');
  }
  check(profile.courses!.filter((c) => c.grade.status === 'unverified').length === 2 && profile.courses!.filter((c) => c.grade.status === 'not-released').length === 3, '2 obscured and3 unreleased original grades');
  check(profile.education.length === 2, 'one master and one bachelor education');
  check(profile.projects.filter((p) => p.kind === 'core').length === 2, 'two distinct core projects');
  check(!profile.courses!.some((c) => /^ENG581[34]$/.test(c.code)), 'graduate project references not extra taught courses or education');
  const project = (part: string) => profile.projects.find((p) => p.id.includes(part));
  check(project('LAB2A')?.id !== project('LAB2B')?.id && !!project('LAB2A') && !!project('LAB2B'), 'physical BIOLOID and simulation separate');
  check(project('LEAN-ASSIGNMENT1')?.id !== project('LEAN-ASSIGNMENT2')?.id && !!project('LEAN-ASSIGNMENT1') && !!project('LEAN-ASSIGNMENT2'), 'Lean assignments separate');
  check(profile.work.filter((w) => w.kind === 'club').length === 3 && profile.work.filter((w) => w.kind === 'volunteer').length === 1, 'union departments and volunteer separated');
  const py = profile.skills.find((s) => s.sourceRecord?.id === 'SKL-007'), commands = profile.skills.find((s) => s.sourceRecord?.id === 'SKL-ROB-02');
  check(!!py && !!commands && py.id !== commands.id && commands.usedIn?.includes(project('LAB3B')!.id) && !py.usedIn?.includes(project('LAB3B')!.id), 'Python and qualified Python commands not conflated');
  check(project('TOOL-001')?.dossier?.tools?.includes('GitHub') && project('TOOL-001')?.dossier?.tools?.includes('GitHub Pages'), 'GitHub and Pages remain distinct tool names');
  check(!profile.evidence.length, 'no manufactured evidence upload tasks');
  const plan = buildImportPlan(emptyProfile(), profile);
  check(plan.items.every((i) => i.action === 'add') && !plan.otherUncertain.length, 'no internal duplicates, conflicts or compulsory uncertainty');
  const imported = normalizeProfile(applyImportPlan(emptyProfile(), profile, plan, { id: 'private-source', at: '', files: [], text: input, integrity }));
  const existing = new Set(['profile', ...['education', 'work', 'projects', 'skills', 'courses', 'certificates', 'awards'].flatMap((s) => (imported[s as keyof typeof imported] as { id: string }[]).map((e) => e.id))]);
  check(imported.sourceFacts!.every((f) => f.entityIds.every((id) => existing.has(id))), 'persisted fact targets remapped');
  const repeated = buildImportPlan(imported, profile); check(repeated.items.every((i) => i.action === 'merge' && i.status === 'duplicate'), 'repeat import adds nothing');
  const again = normalizeProfile(applyImportPlan(imported, profile, repeated, { id: 'repeat', at: '', files: [], text: input, integrity }));
  check(JSON.stringify(again) === JSON.stringify(imported), 'idempotent contents and references, including ledger and original text');
  const settings = { ...DEFAULT_SETTINGS, setupDone: true, apiKey: 'FAKE-PRIVATE-TEST-ONLY', model: 'mock-model' };
  await d.settings.put(settings); await d.table('applications').put({ id: 'mock-application', company: '模拟公司', note: 'preserve' });
  await persistProfile(d, imported, await profileEpoch(d)); d.close(); d = new ResumeDB(dbName);
  check(JSON.stringify((await d.profile.get('me'))!.doc) === JSON.stringify(imported), 'isolated database reopen preserves every field');
  check(JSON.stringify(await d.settings.get('settings')) === JSON.stringify(settings), 'API settings untouched');
  check((await d.table('applications').get('mock-application')).note === 'preserve', 'application record untouched');
  const generation = profileForGeneration(imported); check(!generation.sourceFacts && !generation.sourceTexts && !generation.profile.notes && generation.education.every((e) => !e.notes) && generation.courses!.every((c) => !c.grade.raw && !c.sourceRecord), 'private ledger, grade-page summaries and grades excluded from generation');
  check(createHash('sha256').update(readFileSync(path)).digest('hex') === checksum, 'input file byte-for-byte unchanged');
  console.log(JSON.stringify({ passed: checks, sourceFacts: source.length, mappedFacts: imported.sourceFacts!.length, bachelor:76, master:6, coreProjects:2, initialCandidates:plan.items.length, internalDuplicates:0, undecided:0, compulsoryMissing:0, obscuredGrades:2, unreleasedGrades:3, isolatedPersistence:true, repeatImport:'identical', externalApiCalls:0, inputUnchanged:true }, null, 2));
} catch (error) {
  // Known labels only; no assertion diffs or object dumps can expose personal source data.
  console.error(error instanceof Error && error.message.startsWith('Private verification failed:') ? error.message : 'Private verification failed (source data omitted)');
  process.exitCode = 1;
} finally { globalThis.fetch = originalFetch; await d.delete(); }
