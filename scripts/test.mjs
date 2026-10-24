import { spawnSync } from 'node:child_process';
import { globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const suite = process.argv[2] ?? 'all';
const extraArgs = process.argv.slice(3);
if (!['all', 'unit', 'functional'].includes(suite)) {
  throw new Error('Usage: node scripts/test.mjs [all|unit|functional]');
}

mkdirSync(new URL('../.local/test-results/', import.meta.url), { recursive: true });

const suites = {
  unit: () => {
    const files = globSync('tests/unit/**/*.test.mts', { cwd: root }).sort();
    if (files.length === 0) throw new Error('No unit tests found.');
    return [
      '--import=tsx',
      '--test',
      '--test-timeout=15000',
      '--test-reporter=spec',
      '--test-reporter=junit',
      '--test-reporter-destination=stdout',
      '--test-reporter-destination=.local/test-results/unit.xml',
      ...extraArgs,
      ...files,
    ];
  },
  functional: () => [
    '--import=tsx',
    'node_modules/@cucumber/cucumber/bin/cucumber.js',
    '--config=cucumber.mjs',
    ...extraArgs,
  ],
};

for (const name of suite === 'all' ? ['unit', 'functional'] : [suite]) {
  console.log(`Running ${name} tests...`);
  const report = new URL(`../.local/test-results/${name}.xml`, import.meta.url);
  writeFileSync(report, '');
  const result = spawnSync(process.execPath, suites[name](), {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TSX_TSCONFIG_PATH: fileURLToPath(new URL('../tests/tsconfig.json', import.meta.url)),
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  const xml = readFileSync(report, 'utf8');
  if (!/<testcase\b/.test(xml) || /<(?:skipped|failure|error)\b/.test(xml)) {
    console.error(`${name} tests must produce a nonempty JUnit report without failures or skips.`);
    process.exitCode = 1;
  }
}
