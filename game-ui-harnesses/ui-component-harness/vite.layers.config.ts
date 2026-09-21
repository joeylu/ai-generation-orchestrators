import { defineConfig } from 'vite';
export default defineConfig({build:{outDir:'dist-layers',emptyOutDir:true,lib:{entry:'src/layer-viewer.ts',name:'UILayerViewer',formats:['iife'],fileName:()=> 'viewer.js'},rollupOptions:{output:{inlineDynamicImports:true}}}});
