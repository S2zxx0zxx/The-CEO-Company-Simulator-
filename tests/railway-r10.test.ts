import { describe, it } from 'vitest';
import { cases } from './railway-r10.cases';
describe('Railway R10 route and quote contracts', () => {
  for (const [name, run] of cases) it(name, run);
});
