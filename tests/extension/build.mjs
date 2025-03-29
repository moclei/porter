import esbuild from 'esbuild';
import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
const srcDir = './src';
const scriptsDistDir = './dist/scripts';
const distDir = './dist';
const manifestPath = './manifest.json';

const entryPoints = ['./src/content.ts', './src/background.ts'];
const assets = ['./src/assets'];
const contentSrcDirs = ['popup', 'sidepanel'];

const build = () => {
  ensureDirExists(distDir);
  // Increment the minor version in manifest.json
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  let [major, minor, patch] = manifest.version.split('.').map(Number);
  patch += 1;
  manifest.version = `${major}.${minor}.${patch}`;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  esbuild
    .build({
      entryPoints: entryPoints,
      outdir: scriptsDistDir,
      bundle: true,
      minify: true,
      sourcemap: true,
      format: 'esm',
    })
    .catch(() => process.exit(1));

  // for each .ts file in src/<contentSrcDirs>, I want to build it to dist/<contentSrcDirs>/<file>.js
  contentSrcDirs.forEach((contentDir) => {
    fs.readdirSync(path.join(srcDir, contentDir)).forEach((file) => {
      ensureDirExists(path.join(distDir, contentDir));
      if (file.endsWith('.ts')) {
        esbuild
          .build({
            entryPoints: [path.join(srcDir, contentDir, file)],
            outfile: path.join(distDir, contentDir, file.replace('.ts', '.js')),
            bundle: true,
            minify: true,
            sourcemap: true,
            target: ['chrome58', 'firefox57'],
            loader: { '.ts': 'ts', '.tsx': 'tsx' },
            define: {
              'process.env.NODE_ENV': '"production"',
            },
          })
          .catch(() => process.exit(1));
      } else if (file.endsWith('.html') || file.endsWith('.css')) {
        const srcPath = path.join(srcDir, contentDir, file);
        const destPath = path.join(distDir, contentDir, file);
        copyRecursiveSync(srcPath, destPath);
      }
    });
  });

  // Copy assets
  assets.forEach((assetDir) => {
    fs.readdirSync(assetDir).forEach((file) => {
      const srcPath = path.join(assetDir, file);
      const destPath = path.join(distDir, file);
      copyRecursiveSync(srcPath, destPath);
    });
  });

  // Copy HTML and CSS from root src to dist
  fs.readdirSync(srcDir).forEach((file) => {
    if (file.endsWith('.html') || file.endsWith('.css')) {
      fs.copyFileSync(`${srcDir}/${file}`, `${distDir}/${file}`);
    }
  });

  copyManifest();
};

// Initial build
build();

// Watch for file changes in src directory
chokidar.watch(srcDir).on('change', (event, path) => {
  console.log(`Rebuilding => File ${event} has been changed`);
  build();
});

// Function to ensure directory exists
function ensureDirExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName)
      );
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

function copyManifest() {
  const destManifestPath = path.join(distDir, 'manifest.json');
  fs.copyFileSync(manifestPath, destManifestPath);
}
