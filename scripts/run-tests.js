// ============================================================
// scripts/run-tests.js
// Runs all server test files with ts-node and reports results.
// Usage: npm test   (or: node scripts/run-tests.js [test-file-glob])
// ============================================================

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const testsDir = path.join(root, 'apps', 'server', 'tests');
const tsNodeBin = path.join(root, 'node_modules', 'ts-node', 'dist', 'bin.js');

const pattern = process.argv[2] || '*.test.ts';
const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.ts') && matches(f, pattern));

if (files.length === 0) {
  console.error(`[tests] No test files matched pattern: ${pattern}`);
  process.exit(1);
}

function matches(name, pat) {
  return new RegExp('^' + pat.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$').test(name);
}

let failed = 0;
for (const file of files) {
  const label = `[tests] ${file}`;
  try {
    execFileSync(process.execPath, [tsNodeBin, path.join(testsDir, file)], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, TS_NODE_PROJECT: path.join(root, 'tsconfig.json') },
    });
    console.log(`${label} ... PASSED\n`);
  } catch (err) {
    failed++;
    console.error(`${label} ... FAILED (exit ${err.status})\n`);
  }
}

console.log(failed === 0 ? `\n=== All ${files.length} test files passed ===` : `\n=== ${failed}/${files.length} test files FAILED ===`);
process.exit(failed === 0 ? 0 : 1);
