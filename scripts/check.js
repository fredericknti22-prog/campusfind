'use strict';
/** Pre-deploy sanity check: every JavaScript file must parse. Run: npm run check */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const roots = ['src', 'scripts', 'tests', path.join('public', 'js')];
let total = 0;
let bad = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) {
      total += 1;
      try {
        execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
      } catch (err) {
        bad += 1;
        console.error(`SYNTAX ERROR in ${full}\n${err.stderr}`);
      }
    }
  }
}

roots.filter((r) => fs.existsSync(r)).forEach(walk);
console.log(`${total} files checked, ${bad} with errors`);
process.exit(bad ? 1 : 0);
