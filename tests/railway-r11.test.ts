import { describe, it } from 'vitest';
import { cases } from './railway-r11.cases';
describe('Railway R11 independent synthetic fixtures', () => {
  for (const [name, run] of cases) it(name, run);
});
