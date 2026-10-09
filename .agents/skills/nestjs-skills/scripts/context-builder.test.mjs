import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('./context-builder.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: '/tmp' });

test('loads raw core and JWT references without unrelated advanced topics', () => {
  const result = run('--task', 'implement JWT login authentication');
  assert.equal(result.status, 0, result.stderr);
  const core = readFileSync(new URL('../best-practices.md', import.meta.url), 'utf8');
  const jwt = readFileSync(new URL('../references/security-auth-jwt.md', import.meta.url), 'utf8');
  assert.ok(result.stdout.includes(core));
  assert.ok(result.stdout.includes(jwt));
  assert.ok(!result.stdout.includes('## Source: advanced/'));
});

test('routes queue work to queue details and distributed guidance', () => {
  const result = run('--task', 'build a BullMQ worker with retry and idempotency');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /## Source: references\/micro-use-queues.md/);
  assert.match(result.stdout, /## Source: advanced\/microservices.md/);
  assert.doesNotMatch(result.stdout, /## Source: references\/security-auth-jwt.md/);
});

test('recognizes N+1 queries and avoids substring matches for unrelated tasks', () => {
  const database = run('--task', 'fix N+1 queries in orders');
  assert.equal(database.status, 0, database.stderr);
  assert.match(database.stdout, /## Source: references\/db-avoid-n-plus-one.md/);
  const unknown = run('--task', 'repair a chair');
  assert.equal(unknown.status, 0, unknown.stderr);
  assert.match(unknown.stdout, /No task-specific match/);
  assert.doesNotMatch(unknown.stdout, /## Source: (references|advanced)\//);
});

test('expands exact references once without repeating core context', () => {
  const result = run('--expand-ref', 'advanced/di-advanced.md', '--expand-ref', 'advanced/di-advanced.md');
  assert.equal(result.status, 0, result.stderr);
  const raw = readFileSync(new URL('../advanced/di-advanced.md', import.meta.url), 'utf8');
  assert.ok(result.stdout.includes(raw));
  assert.equal(result.stdout.split('## Source: advanced/di-advanced.md').length, 2);
  assert.doesNotMatch(result.stdout, /## Source: best-practices.md/);
});

test('rejects unknown flags, missing arguments, and non-catalog paths', () => {
  for (const args of [[], ['--task'], ['--task', ' '], ['--bogus'], ['--expand-ref', '../../etc/passwd'], ['--expand-ref', 'references/_template.md']]) {
    const result = run(...args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.equal(result.stdout, '');
  }
});

test('lists every supported reference without loading document bodies', () => {
  const result = run('--list');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /advanced\/api-versioning.md/);
  assert.match(result.stdout, /references\/di-liskov-substitution.md/);
  assert.doesNotMatch(result.stdout, /## Source:/);
});

test('bounds automatic context and reports deferred files without cutting code', () => {
  const result = run('--task', 'CRUD JWT auth guards DTO validation queues BullMQ microservices events caching performance versioning transactions migrations unit tests e2e');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.length < 28000, `Context length: ${result.stdout.length}`);
  assert.match(result.stdout, /Deferred/);
  const sources = [...result.stdout.matchAll(/^## Source: (.+)$/gm)].map((match) => match[1]);
  for (const source of sources) {
    assert.ok(result.stdout.includes(readFileSync(new URL(`../${source}`, import.meta.url), 'utf8')));
  }
});
