const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function resolveProjectRoot(startDir) {
  let dir = startDir;

  for (let depth = 0; depth < 4; depth += 1) {
    const hasPackage = fs.existsSync(path.join(dir, 'package.json'));
    const hasTsconfig = fs.existsSync(path.join(dir, 'tsconfig.json'));

    if (hasPackage && hasTsconfig) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(
    'Could not find project root (package.json + tsconfig.json). Check Render Root Directory is not set to "src".'
  );
}

function ensureBuild(root) {
  const distServer = path.join(root, 'dist', 'server.js');
  if (fs.existsSync(distServer)) {
    return distServer;
  }

  console.log('[bootstrap] dist/server.js missing — installing deps and building...');

  execSync('npm install', {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NPM_CONFIG_PRODUCTION: 'false',
    },
  });

  execSync('npm run build', {
    cwd: root,
    stdio: 'inherit',
  });

  if (!fs.existsSync(distServer)) {
    throw new Error('[bootstrap] Build finished but dist/server.js was not created.');
  }

  console.log('[bootstrap] Build complete.');
  return distServer;
}

const root = resolveProjectRoot(__dirname);
const entry = ensureBuild(root);
require(entry);
