const esbuild = require('esbuild');
const { nodeExternalsPlugin } = require('esbuild-node-externals');

const shared = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  minify: true,
  sourcemap: true,
  plugins: [nodeExternalsPlugin()],
};

Promise.all([
  esbuild.build({
    ...shared,
    outfile: 'dist/cjs/index.js',
    platform: 'node',
    drop: ['console'],
    target: ['node14'],
    format: 'cjs',
  }),
  esbuild.build({
    ...shared,
    outfile: 'dist/esm/index.js',
    platform: 'neutral',
    drop: ['console'],
    target: ['es2018'],
    format: 'esm',
  }),
]).catch(() => process.exit(1));