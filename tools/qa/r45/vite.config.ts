import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
export default defineConfig({plugins:[react()],root:resolve('tools/qa/r45'),base:'./',build:{outDir:resolve('r45-qa-dist'),emptyOutDir:true,target:'esnext'}});
