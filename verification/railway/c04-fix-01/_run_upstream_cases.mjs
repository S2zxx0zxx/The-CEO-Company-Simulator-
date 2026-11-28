
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !specifier.endsWith('.ts') && !specifier.endsWith('.js')) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const tsFile = path.resolve(parentDir, specifier + '.ts');
      if (existsSync(tsFile)) return { url: pathToFileURL(tsFile).href, shortCircuit: true };
      const tsIndex = path.resolve(parentDir, specifier, 'index.ts');
      if (existsSync(tsIndex)) return { url: pathToFileURL(tsIndex).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const suites = [
  ['R07_graph', './tests/railway-r07.cases.ts'],
  ['R08_compatibility', './tests/railway-r08.cases.ts'],
  ['R09_routing', './tests/railway-r09.cases.ts'],
  ['R10_quotes', './tests/railway-r10.cases.ts'],
  ['R11_synthetic', './tests/railway-r11.cases.ts'],
];

const summary = [];
let totalPass = 0, totalFail = 0;
for (const [label, rel] of suites) {
  const mod = await import(pathToFileURL(path.resolve(rel)).href);
  let pass = 0, fail = 0;
  const failures = [];
  for (const [name, fn] of mod.cases) {
    try { await fn(); pass++; }
    catch (e) { fail++; failures.push({ name, error: String(e) }); }
  }
  totalPass += pass; totalFail += fail;
  summary.push({ suite: label, total: pass + fail, passed: pass, failed: fail, failures });
}
console.log(JSON.stringify({ totalPass, totalFail, summary }, null, 2));
if (totalFail > 0) process.exit(1);
