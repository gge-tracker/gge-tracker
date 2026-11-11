import { readFileSync, writeFileSync } from 'node:fs';

const nginxFile = new URL('../nginx/nginx.conf', import.meta.url);
const ruleFile = new URL('../nginx/cloudflare-html-cache-rule.txt', import.meta.url);
const host = 'gge-tracker.com';

function crawlerTokens(nginx) {
  const block = nginx.match(/map \$http_user_agent \$is_link_crawler {[\S\s]*?"~\*\(([^)]+)\)" 1;/);
  if (!block) throw new Error('nginx.conf has no "map $http_user_agent $is_link_crawler" regex');
  const tokens = block[1].split('|');
  const unsafe = tokens.filter((token) => !/^[\da-z-]+$/.test(token));
  if (unsafe.length > 0) throw new Error(`crawler tokens a Cloudflare "contains" cannot express: ${unsafe.join(', ')}`);
  return tokens;
}

// Cloudflare cannot vary its cache on the user agent: crawlers must skip it or a preview head would be served to visitors
function expression(tokens) {
  const crawlers = tokens.map((token) => `lower(http.user_agent) contains "${token}"`).join(' or ');
  return (
    `(http.host eq "${host}" and http.request.method eq "GET" and http.request.uri.path.extension eq "" ` +
    `and not (${crawlers}))\n`
  );
}

const generated = expression(crawlerTokens(readFileSync(nginxFile, 'utf8')));

if (process.argv.includes('--write')) {
  writeFileSync(ruleFile, generated);
  console.log(`wrote ${ruleFile.pathname}: need to be pasted into the Cloudflare cache rule "HTML shell"`);
} else {
  let committed = '';
  try {
    committed = readFileSync(ruleFile, 'utf8');
  } catch {}
  if (committed !== generated) {
    console.error(
      'the $is_link_crawler list changed: need to run "node scripts/cloudflare-cache-rule.mjs --write" and paste the file into the Cloudflare cache rule',
    );
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  }
  console.log('the Cloudflare cache rule expression matches $is_link_crawler');
}
