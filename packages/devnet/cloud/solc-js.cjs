#!/usr/bin/env node
// A native-solc stand-in for forge, backed by solc-js (a cloud container cannot download native solc). setup.sh installs
// one copy per compiler version, each beside its own node_modules/solc.
// solc-js runs out of wasm memory on forge's one 500-file job, so the job is split into chunks, each compiled
// in its own process, and the outputs merged. Source ids are renumbered, so source maps are approximate.
const path = require('path'), fs = require('fs'), cp = require('child_process');
const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('solc, the solidity compiler commandline interface\nVersion: ' + require(path.join(__dirname, 'node_modules/solc')).version().replace('Emscripten.clang', 'Linux.g++'));
  process.exit(0);
}
if (args[0] === '--chunk') {   // child: compile one chunk
  const solc = require(path.join(__dirname, 'node_modules/solc'));
  const { input, roots } = JSON.parse(fs.readFileSync(0, 'utf8'));
  const find = p => { for (const r of [...roots, '']) { const f = path.isAbsolute(p) ? p : path.join(r, p); if (fs.existsSync(f)) return { contents: fs.readFileSync(f, 'utf8') }; } return { error: 'not found: ' + p }; };
  fs.writeSync(1, solc.compile(JSON.stringify(input), { import: find }));
  process.exit(0);
}
let base = process.cwd(); const inc = [];
for (let i = 0; i < args.length; i++) { if (args[i] === '--base-path') base = args[++i]; else if (args[i] === '--include-path') inc.push(args[++i]); }
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const names = Object.keys(input.sources); const sel = input.settings.outputSelection || {};
const size = Number(process.env.SOLCJS_CHUNK || 25);
const out = { contracts: {}, sources: {}, errors: [] }; const seenErr = new Set();
for (let i = 0; i < names.length; i += size) {
  const chunk = names.slice(i, i + size); const sources = {}; const os = {};
  for (const n of chunk) { sources[n] = input.sources[n]; os[n] = sel[n] || sel['*']; }
  const job = { ...input, sources, settings: { ...input.settings, outputSelection: os } };
  const r = cp.spawnSync(process.execPath, ['--max-old-space-size=4096', __filename, '--chunk'], { input: JSON.stringify({ input: job, roots: [base, ...inc] }), maxBuffer: 1 << 30 });
  if (r.status !== 0) { process.stderr.write(r.stderr); process.exit(1); }
  const o = JSON.parse(r.stdout.toString());
  for (const e of o.errors || []) { const k = e.formattedMessage; if (!seenErr.has(k)) { seenErr.add(k); out.errors.push(e); } }
  for (const [f, c] of Object.entries(o.contracts || {})) if (chunk.includes(f)) out.contracts[f] = c;
  for (const [f, s] of Object.entries(o.sources || {})) if (!out.sources[f] || (s.ast && !out.sources[f].ast && chunk.includes(f))) out.sources[f] = s;
}
let id = 0; for (const f of Object.keys(out.sources).sort()) out.sources[f].id = id++;
fs.writeSync(1, JSON.stringify(out));
