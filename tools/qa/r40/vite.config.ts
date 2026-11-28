import {defineConfig} from 'vite';
import {resolve} from 'node:path';
export default defineConfig({root:resolve('tools/qa/r40'),base:'./',build:{outDir:resolve('r40-qa-dist'),emptyOutDir:true}});
