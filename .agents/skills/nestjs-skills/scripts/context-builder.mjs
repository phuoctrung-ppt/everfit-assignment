#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';

// Match task vocabulary against this small index; never scan all document bodies.
const references = [
  ['security-auth-jwt', 'jwt|auth|authentication|login|sign in|refresh tokens?|passport'],
  ['security-use-guards', 'guards?|auth|authentication|authorization|rbac|permissions?|roles?'],
  ['security-rate-limiting', 'rate limit(?:ing)?|throttl(?:e|er|ing)|brute force'],
  ['security-validate-all-input', 'validat(?:e|ion|ing)|dtos?|crud'],
  ['security-sanitize-output', 'saniti[sz](?:e|ation|ing)|xss|html'],
  ['arch-feature-modules', 'crud|feature modules?|module structure|scaffold'],
  ['arch-avoid-circular-deps', 'circular|forwardref'],
  ['arch-module-sharing', 'shared modules?|module sharing|exports?'],
  ['arch-single-responsibility', 'single responsibility|god services?|refactor services?'],
  ['arch-use-repository-pattern', 'repositor(?:y|ies)|data access|crud'],
  ['arch-use-events', 'events?|eventemitter|decoupl(?:e|ing)'],
  ['di-prefer-constructor-injection', 'constructor injection|dependency injection'],
  ['di-use-interfaces-tokens', 'injection tokens?|custom providers?|dependency injection'],
  ['di-scope-awareness', 'scopes?|request context|transient|singleton|multi tenancy'],
  ['di-interface-segregation', 'interface segregation|isp|solid'],
  ['di-liskov-substitution', 'liskov|lsp|inheritance|solid'],
  ['di-avoid-service-locator', 'service locator|moduleref'],
  ['error-use-exception-filters', 'exception filters?|error handling|error responses?'],
  ['error-throw-http-exceptions', 'http exceptions?|badrequestexception|notfoundexception'],
  ['error-handle-async-errors', 'async errors?|unhandled|rejections?|promises?'],
  ['db-avoid-n-plus-one', 'n\\+1|n plus one|eager load(?:ing)?|batch queries'],
  ['db-use-transactions', 'transactions?|atomic|rollback|multi step writes?'],
  ['db-use-migrations', 'migrations?|schema changes?'],
  ['perf-optimize-database', 'slow quer(?:y|ies)|queries|indexes?|explain|database performance'],
  ['perf-use-caching', 'cach(?:e|es|ing)|redis|ttl'],
  ['perf-lazy-loading', 'lazy load(?:ing)?|lazy modules?|startup'],
  ['perf-async-hooks', 'lifecycle|async hooks?|onmoduleinit|bootstrap'],
  ['test-use-testing-module', 'unit tests?|testingmodule|jest|vitest|testing'],
  ['test-e2e-supertest', 'e2e|end to end|supertest|integration tests?'],
  ['test-mock-external-services', 'mocks?|mocking|external (?:apis?|services?)'],
  ['api-use-pipes', 'pipes?|transform(?:ation)?|parseuuidpipe'],
  ['api-use-interceptors', 'interceptors?|response mapping|timeouts?'],
  ['api-use-dto-serialization', 'serializ(?:e|ation)|response dtos?|class transformer'],
  ['api-versioning', 'version(?:s|ing)?|breaking changes?'],
  ['micro-use-queues', 'queues?|bullmq|workers?|background jobs?|retries|retry|idempotenc(?:e|y)'],
  ['micro-use-patterns', 'microservices?|rpc|grpc|message patterns?|kafka|rabbitmq|nats'],
  ['micro-use-health-checks', 'health checks?|readiness|liveness|terminus'],
  ['devops-use-config-module', 'config(?:uration|module|service)?|environment|env'],
  ['devops-use-logging', 'logs?|logging|pino|winston|correlation'],
  ['devops-graceful-shutdown', 'shutdown|sigterm|kubernetes|drain'],
].map(([name, keywords]) => [`references/${name}.md`, keywords]);

const advanced = [
  ['microservices', 'microservices?|distributed|queues?|bullmq|workers?|background jobs?|rpc|grpc|kafka|rabbitmq|nats'],
  ['event-driven', 'events?|eventemitter|decoupl(?:e|ing)'],
  ['api-versioning', 'version(?:s|ing)?|breaking changes?'],
  ['performance-deep', 'cach(?:e|es|ing)|redis|lazy load(?:ing)?|profil(?:e|ing)|performance|async hooks?'],
  ['di-advanced', 'scopes?|request context|transient|multi tenancy|interface segregation|liskov|solid|custom providers?'],
].map(([name, keywords]) => [`advanced/${name}.md`, keywords]);

const catalog = [...references, ...advanced];
const allowed = new Set(catalog.map(([file]) => file));
const root = new URL('../', import.meta.url);
const help = `Usage:
  node context-builder.mjs --task 'task description'
  node context-builder.mjs --expand-ref references/security-auth-jwt.md
  node context-builder.mjs --list

--task         Emit raw best practices plus matching references and advanced topics.
--expand-ref   Emit a catalog file verbatim; repeat to load several. May accompany --task.
--list         List available files without loading their contents.
--help         Show this help.

Automatic selection: up to 4 references and 2 advanced files, within 24,000 characters
of source content. Deferred matches are listed for later expansion. Explicit expansions
bypass these limits. Paths resolve relative to this skill, independent of working directory.
`;

function parse(args) {
  const options = { task: '', expand: [], list: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') options.help = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--task' || arg === '--expand-ref') {
      const value = args[++i];
      if (!value?.trim() || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      if (arg === '--task') options.task = value.trim();
      else {
        if (!allowed.has(value)) throw new Error(`Unknown reference: ${value}. Use --list for exact paths.`);
        options.expand.push(value);
      }
    } else throw new Error(`Unknown option: ${arg}. Use --help.`);
  }
  if (!options.task && !options.expand.length && !options.list && !options.help) {
    throw new Error('Provide --task, --expand-ref, or --list. Use --help.');
  }
  return options;
}

function rank(entries, task) {
  return entries.map(([file, keywords]) => {
    const hits = task.match(new RegExp(`\\b(?:${keywords})\\b`, 'gi')) ?? [];
    return { file, score: new Set(hits.map((hit) => hit.toLowerCase())).size };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
}

function build(options) {
  if (options.help) return help;
  if (options.list) return `${catalog.map(([file]) => file).join('\n')}\n`;
  const loaded = new Map();
  const deferred = [];
  let size = 0;
  const load = (file) => {
    if (loaded.has(file)) return;
    const raw = readFileSync(new URL(file, root), 'utf8');
    loaded.set(file, raw);
    size += raw.length;
  };
  if (options.task) load('best-practices.md');
  for (const file of options.expand) load(file);
  // Normalize separators for phrases like request-scoped and background-jobs.
  const task = options.task.toLowerCase().replace(/[-_]/g, ' ');
  let matches = 0;
  if (task) {
    // Short advanced summaries first so detailed examples cannot crowd them out.
    for (const [entries, limit] of [[advanced, 2], [references, 4]]) {
      let count = 0;
      for (const { file } of rank(entries, task)) {
        matches++;
        if (loaded.has(file)) continue;
        // Byte size is a conservative upper bound on JS string length. Skipped bodies stay unread.
        if (count >= limit || size + statSync(new URL(file, root)).size > 24000) {
          deferred.push(file);
          continue;
        }
        load(file);
        count++;
      }
    }
  }
  const summary = ['# NestJS task context', `Loaded: ${[...loaded.keys()].join(', ')}`];
  if (task && matches === 0) summary.push('No task-specific match. Use --list and --expand-ref to select relevant guidance.');
  if (deferred.length) summary.push(`Deferred (automatic context limit; expand only as needed): ${deferred.join(', ')}`);
  return `${summary.join('\n\n')}\n\n${[...loaded].map(([file, raw]) => `## Source: ${file}\n\n${raw}`).join('\n\n')}\n`;
}

try {
  process.stdout.write(build(parse(process.argv.slice(2))));
} catch (error) {
  process.stderr.write(`context-builder: ${error.message}\n`);
  process.exitCode = 1;
}
