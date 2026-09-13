'use strict';
/*
╔══════════════════════════════════════════════════════════════╗
║  Lucca Secret Scanner — tools/secret-scan.cjs               ║
║  FhS: node tools/secret-scan.cjs                            ║
║  HIGH exit 1; MED = warn only. Files > 500KB skipped.       ║
╚══════════════════════════════════════════════════════════════╝
*/
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const CODE_EXT = /\.(?:js|cjs|mjs|ts|tsx|jsx|html|css|json|yml|yaml|env|env\.\w+|sh|ps1|rb|go|py|java|php|vue|svelte|c|cpp|h|hpp|rs)$/i;
const BIN_EXT  = /\.(?:png|jpg|jpeg|gif|webp|ico|pdf|woff|woff2|ttf|otf|eot|mp3|mp4|zip|gz|tar|exe|dll|so|dylib|bin|db|sqlite|sqlite3|map)$/i;
const MAX_FILE = 512_000;
const MAX_LINE = 50_000;
const MAX_PER_FILE = 10;
const PLACEHOLDER = /(?:xxx|your-|change|replace|example|sample|lorem|sk-your-key|\.\.\.)/i;

const RULES = [
  { name: 'OpenAI API key',         sev: 'HIGH', re: /\bsk-[A-Za-z0-9]{16,}\b/ },
  { name: 'GitHub token',           sev: 'HIGH', re: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9]{20,}\b/ },
  { name: 'AWS access key',         sev: 'HIGH', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Private key',            sev: 'HIGH', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { name: 'Slack token',            sev: 'HIGH', re: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { name: 'DB conn string w/ pass', sev: 'HIGH', re: /\b(?:postgres(?:ql)?|mysql|mariadb|redis|mongodb(?:\+srv)?):\/\/[^"'\s]+:[^"'\s@]+@/ },
  { name: 'Known default API key',  sev: 'HIGH', re: new RegExp(['lucca', 'secret', 'key'].join('-')) },
  { name: 'Weak default admin pw',  sev: 'HIGH', re: /(?:password|passwd)\s*[:=]\s*["']123456["']/ },
  { name: 'API_KEY/secret literal', sev: 'MED',  re: /\b(?:API_KEY|api_key|ApiKey|DEVICE_API_KEY|SECRET_KEY|SECRET|JWT_SECRET|OPENAI_API_KEY)\s*[:=]\s*["'][^"'\s]{6,}["']/, ignorePlaceholder: true },
];

function mask(v) { return v.length <= 8 ? v[0] + '****' : v.slice(0, 4) + '****' + v.slice(-2); }

let files = [];
try { files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean); }
catch { console.error('must run inside the git repo'); process.exit(2); }

const findings = [];
let scanned = 0, skipped = 0;

for (const f of files) {
  let stat;
  try { stat = fs.statSync(f); } catch { continue; }
  if (!CODE_EXT.test(f) || stat.size > MAX_FILE || stat.size === 0) { skipped++; continue; }
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (!text || text.includes('\0')) continue;
  scanned++;
  const lines = text.split(/\r?\n/);
  let fileCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > MAX_LINE) continue;
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        if (rule.ignorePlaceholder && PLACEHOLDER.test(m[0])) { rule.re.lastIndex = m.index + 1; continue; }
        findings.push({ file: f, line: i + 1, rule: rule.name, sev: rule.sev, excerpt: mask(m[0]) });
        fileCount++;
        if (fileCount >= MAX_PER_FILE) break;
        rule.re.lastIndex = m.index + 1;
      }
      if (fileCount >= MAX_PER_FILE) break;
    }
    if (fileCount >= MAX_PER_FILE) break;
  }
}

const high = findings.filter((x) => x.sev === 'HIGH');
const med  = findings.filter((x) => x.sev === 'MED');

for (const x of findings) console.log(`${x.sev}  ${x.file}:${x.line}  ${x.rule}  (${x.excerpt})`);
console.log(`\nfiles scanned: ${scanned}  skipped: ${skipped}`);
console.log(`HIGH: ${high.length}  MED(warn): ${med.length}`);
if (high.length) { console.error('HIGH secrets found in tracked files'); process.exit(1); }
console.log('CLEAN');