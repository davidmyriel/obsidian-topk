// Guards on the shipped main.js (docs/PLAN.md "CI/CD" and "Security and privacy"):
// - size under 1.5 MB;
// - the only network hosts are TopK's regional endpoints (and placeholder text in help messages);
// - no eval or new Function.
// Run after `npm run build`: npx tsx scripts/check-bundle.ts [main.js]
import { readFileSync, statSync } from 'node:fs';

const file = process.argv[2] ?? 'main.js';
const MAX_BYTES = 1.5 * 1024 * 1024;
const ALLOWED = [
	/^https:\/\/\$\{[^}]+\}\.api\.\$\{[^}]+\}$/, // regionOrigin(): https://${region}.api.${host}
	/^https:\/\/[a-z0-9-]+\.api\.topk\.io\.?$/, // TopK regional endpoints and help text
	/^https:\/\/host$/, // settings placeholder text "https://host:443"
];

const problems: string[] = [];
const size = statSync(file).size;
if (size > MAX_BYTES) problems.push(`${file} is ${size} bytes, over ${MAX_BYTES}`);

const code = readFileSync(file, 'utf8');
const urls = new Set(code.match(/https?:\/\/[A-Za-z0-9.${}_-]+/g) ?? []);
for (const url of urls) {
	if (!ALLOWED.some((re) => re.test(url))) problems.push(`unexpected host in bundle: ${url}`);
}
if (/\beval\s*\(/.test(code)) problems.push('bundle calls eval()');
if (/new\s+Function\s*\(/.test(code)) problems.push('bundle uses new Function()');

if (problems.length > 0) {
	for (const p of problems) console.error(`bundle check: ${p}`);
	process.exit(1);
}
console.log(
	`bundle check: ${file} ${(size / 1024).toFixed(0)} KB, hosts ok (${[...urls].join(', ')})`,
);
