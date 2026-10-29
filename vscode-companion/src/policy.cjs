'use strict';
const fs = require('node:fs');
const path = require('node:path');
// The installed VSIX contains exact build-time policy bytes. Development uses the repository source.
const bundled = path.resolve(__dirname, '../shared');
const root = fs.existsSync(path.join(bundled, 'source-hashes.json')) ? bundled : path.resolve(__dirname, '../..');
module.exports = { engine: require(path.join(root, 'lib/engine.cjs')), store: require(path.join(root, 'lib/storage.cjs')) };
