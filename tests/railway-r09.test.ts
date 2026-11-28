import { describe, it } from 'vitest';
import { cases } from './railway-r09.cases';
import './railway-r09.worker-cases';
describe('Railway R09 deterministic routing and worker lifecycle', () => {
  for (const [name, run] of cases) it(name, run);
});
