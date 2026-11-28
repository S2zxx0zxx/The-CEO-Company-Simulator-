import {describe,it,expect} from 'vitest';
import {OPTIONAL_SERVICES,optionalServiceEnabled} from '../src/rail/optional';
describe('R48 disabled-only optional services',()=>{
 it('all nine switches are frozen false; no caller can opt in',()=>{
  expect(Object.keys(OPTIONAL_SERVICES)).toHaveLength(9);
  expect(Object.isFrozen(OPTIONAL_SERVICES)).toBe(true);
  for(const k of Object.keys(OPTIONAL_SERVICES))expect(optionalServiceEnabled(k)).toBe(false);
  expect(()=>Object.assign(OPTIONAL_SERVICES,{billing:true})).toThrow();
 });
 it('rejects unknown and prototype properties',()=>{
  for(const k of ['__proto__','constructor','toString','unknown',null,{},true])expect(()=>optionalServiceEnabled(k)).toThrow('Unknown optional service');
 });
});
