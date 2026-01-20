import esbuild from 'esbuild';

esbuild.build({
  entryPoints: ['ui.tsx'],
  bundle: true,
  platform: 'node',
  outfile: 'dist/main.js',
  format: 'esm',
  external: ['react', 'ink'],
}).catch(() => process.exit(1));
