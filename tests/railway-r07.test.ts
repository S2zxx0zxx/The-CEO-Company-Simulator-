import { describe, it } from 'vitest';
import { cases } from './railway-r07.cases';
describe('Railway R07 deterministic graph primitives', () => {
  for (const [name, run] of cases) it(name, run);
});
