import esbuild from 'esbuild';

esbuild.build({
  entryPoints: ['ui.tsx'],
  bundle: true,
  platform: 'node',
  outfile: 'dist/main.js',
  format: 'esm',
  banner: {
    js: `import { createRequire } from 'module'; import { fileURLToPath } from 'url'; import { dirname } from 'path'; const require = createRequire(import.meta.url); const __filename = fileURLToPath(import.meta.url); const __dirname = dirname(__filename);`,
  },
  external: ['react', 'ink', 'ink-gradient'],
}).catch(() => process.exit(1));
