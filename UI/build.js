import esbuild from 'esbuild';

esbuild.build({
  entryPoints: ['ui.tsx'],
  bundle: true,
  platform: 'node',
  outfile: 'dist/main.js',
  format: 'esm',
  external: ['react', 'ink', 'ink-gradient'],
}).catch(() => process.exit(1));
