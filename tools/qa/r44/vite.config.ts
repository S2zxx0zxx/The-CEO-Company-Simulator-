import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
export default defineConfig({plugins:[react()],root:resolve('tools/qa/r44'),base:'./',build:{outDir:resolve('r44-qa-dist'),emptyOutDir:true,target:'esnext'}});
