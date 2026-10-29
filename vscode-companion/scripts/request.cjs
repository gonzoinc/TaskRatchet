#!/usr/bin/env node
'use strict';
const path = require('node:path');
const bridge = require('../src/bridge.cjs');
const { store } = require('../src/policy.cjs');
function main(argv) {
  const [workspace, json] = argv;
  if (!workspace || !json || !path.isAbsolute(workspace)) throw new Error('Usage: node scripts/request.cjs ABSOLUTE_WORKSPACE JSON_REQUEST');
  const args = JSON.parse(json);
  console.log(JSON.stringify(bridge.enqueue(store.area(workspace), args)));
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { main };
