import { describe, it } from 'vitest';
import { cases } from './railway-r06.cases';
describe('Railway R06 canonical units and domain schemas', () => {
  for (const [name, run] of cases) it(name, run);
});
