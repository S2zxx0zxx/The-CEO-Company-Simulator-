import { describe, it } from 'vitest';
import { cases } from './railway-r12.cases';
describe('Railway R12 versioned rolling stock catalog', () => {
  for (const [name, run] of cases) it(name, run);
});
