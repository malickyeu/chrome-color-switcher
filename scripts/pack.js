/* Builds dist/color-switcher-<version>.zip with only the files the extension needs. */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['LICENSE', 'manifest.json', 'icons', 'src', 'ui', 'popup', 'preview'];
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const out = path.join(ROOT, 'dist', `color-switcher-${version}.zip`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
// -X drops extra file attributes (uid/gid, timestamps beyond mtime) from the archive.
execFileSync('zip', ['-rqX', out, ...FILES], { cwd: ROOT, stdio: 'inherit' });
console.log(path.relative(ROOT, out));
