import { describe, it } from 'vitest';
import { cases } from './railway-r08.cases';
describe('Railway R08 compatibility and turn policy', () => {
  for (const [name, run] of cases) it(name, run);
});
