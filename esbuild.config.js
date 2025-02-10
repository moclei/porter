const esbuild = require('esbuild');
const { nodeExternalsPlugin } = require('esbuild-node-externals');

const shared = {
  entryPoints: ['src/index.ts', 'src/react/index.ts'],
  bundle: true,
  minify: true,
  sourcemap: true,
  plugins: [nodeExternalsPlugin()],
  external: ['react'],
  define: {
    'process.env.NODE_ENV': JSON.stringify(
      process.env.NODE_ENV || 'development'
    ),
  },
};

Promise.all([
  esbuild.build({
    ...shared,
    outdir: 'dist/cjs',
    platform: 'node',
    target: ['node14'],
    format: 'cjs',
  }),
  esbuild.build({
    ...shared,
    outdir: 'dist/esm',
    platform: 'neutral',
    target: ['es2018'],
    format: 'esm',
  }),
]).catch(() => process.exit(1));
