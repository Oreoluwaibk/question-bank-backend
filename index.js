const fs = require('fs');
const path = require('path');

// Works whether the host runs ./index.js or ./src/index.js
const candidates = [
  path.join(__dirname, 'dist', 'server.js'),
  path.join(__dirname, '..', 'dist', 'server.js'),
];

const entry = candidates.find((file) => fs.existsSync(file));

if (!entry) {
  throw new Error(
    'Build output not found. Run "npm run build" before starting the server.'
  );
}

require(entry);
