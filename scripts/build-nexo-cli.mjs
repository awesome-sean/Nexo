import { build } from 'esbuild';
await build({entryPoints:['scripts/nexo-cli.ts'],bundle:true,platform:'node',format:'cjs',target:'node20',outfile:'assets/nexo-cli.cjs'});
