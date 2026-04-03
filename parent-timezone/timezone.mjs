#!/usr/bin/env node

// International Parent Timezone Management Tool
// Token auto-cached per site, verify after update, foolproof operation.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(__dirname, '.tokens.json');
const TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

const SITES = {
  sa: { domain: 'sa-manager.lionabc.com', crCode: 'sa', defaultCountryCode: '966', label: '沙特 SA' },
  k2: { domain: 'k2-manager.lionabc.com', crCode: 'k2', defaultCountryCode: '', label: 'K2' },
  us: { domain: 'us-manager.lionabc.com', crCode: 'us', defaultCountryCode: '1', label: '美国 US' },
  jp: { domain: 'jp-manager.lionabc.com', crCode: 'jp', defaultCountryCode: '81', label: '日本 JP' },
  tw: { domain: 'tw-manager.lionabc.com', crCode: 'tw', defaultCountryCode: '886', label: '台湾 TW' },
  vn: { domain: 'vn-manager.lionabc.com', crCode: 'vn', defaultCountryCode: '84', label: '越南 VN' },
};

// ─── Token Cache ───

function loadTokens() {
  try {
    if (existsSync(TOKEN_FILE)) return JSON.parse(readFileSync(TOKEN_FILE, 'utf-8'));
  } catch {}
  return {};
}

function saveTokens(tokens) {
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

function getCachedToken(siteKey) {
  const tokens = loadTokens();
  const entry = tokens[siteKey];
  if (!entry) return null;

  const age = Date.now() - entry.savedAt;
  if (age > TOKEN_MAX_AGE_MS) {
    console.error(`[token] ${siteKey} token expired (${(age / 3600000).toFixed(1)}h ago), need re-auth.`);
    return null;
  }

  const hoursLeft = ((TOKEN_MAX_AGE_MS - age) / 3600000).toFixed(1);
  console.error(`[token] Using cached ${siteKey} token (valid for ~${hoursLeft}h).`);
  return entry.token;
}

function cacheToken(siteKey, token) {
  const tokens = loadTokens();
  tokens[siteKey] = { token, savedAt: Date.now() };
  saveTokens(tokens);
  console.log(`[token] Saved ${siteKey} token to cache.`);
}

function invalidateToken(siteKey) {
  const tokens = loadTokens();
  delete tokens[siteKey];
  saveTokens(tokens);
}

// ─── Resolve Token: explicit > cache > fail ───

function resolveToken(args, siteKey) {
  if (args.token) {
    cacheToken(siteKey, args.token);
    return args.token;
  }

  const cached = getCachedToken(siteKey);
  if (cached) return cached;

  console.error('Error: No valid token. Need browser auth to get intlAuthToken.');
  console.error('  1. Agent: open browser to manager site, user logs in');
  console.error('  2. Run: node timezone.mjs save-token --site <site> --token <token>');
  process.exit(2);
}

// ─── Args ───

function parseArgs(args) {
  const result = { command: args[0] };
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      result[key] = val;
    }
  }
  return result;
}

// ─── HTTP Helpers ───

function buildHeaders(site, token) {
  return {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'App-Code': 'international-mgt',
    'Authorization': token,
    'Biz-Line': site.crCode,
    'Connection': 'keep-alive',
    'Cookie': `intlAuthToken=${token}`,
    'vk-cr-code': site.crCode,
    'vk-device': 'PC',
    'vk-language': 'zh-cn',
  };
}

function isSuccess(code) {
  return code === 0 || code === 200;
}

function isAuthError(data, status) {
  if (status === 401 || status === 403) return true;
  if (data?.code === 401 || data?.code === 403) return true;
  if (data?.msg?.includes?.('token') || data?.msg?.includes?.('login')) return true;
  return false;
}

// ─── API: Search ───

async function searchParent(site, token, { phone, countryCode, email, parentId }) {
  const params = new URLSearchParams({
    kpFlag: '',
    countryCodes: countryCode || site.defaultCountryCode,
    phone: phone || '',
    email: email || '',
    automaticRenewal: '',
    parentId: parentId || '',
    studentId: '',
    registerTimeBegin: '',
    registerTimeEnd: '',
    tagIds: '',
    channelCodes: '',
    orgCodes: '',
    staffId: '',
    gccStaffId: '',
    startId: '0',
    limit: '100',
    _t: Date.now().toString(),
  });

  const url = `https://${site.domain}/rest/international/api/parent/list?${params}`;
  const headers = { ...buildHeaders(site, token) };
  delete headers['Biz-Line'];

  const res = await fetch(url, { headers });
  const data = await res.json();

  if (isAuthError(data, res.status)) return { authError: true };
  if (!isSuccess(data.code)) {
    console.error(`API Error [code=${data.code}]: ${data.msg || JSON.stringify(data)}`);
    process.exit(1);
  }

  return data.data?.data ? { list: data.data.data, total: data.data.total } : data.data;
}

// ─── API: Update Timezone ───

async function updateTimezone(site, token, parentId, timezone) {
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const body = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="parentId"`,
    '', parentId,
    `--${boundary}`,
    `Content-Disposition: form-data; name="timeZone"`,
    '', timezone,
    `--${boundary}--`, '',
  ].join('\r\n');

  const headers = {
    ...buildHeaders(site, token),
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Origin': `https://${site.domain}`,
    'Referer': `https://${site.domain}/`,
  };

  const url = `https://${site.domain}/rest/international/api/parent/updateTimeZone`;
  const res = await fetch(url, { method: 'POST', headers, body });
  const data = await res.json();

  if (isAuthError(data, res.status)) return { authError: true };
  return data;
}

// ─── API: Verify (get parent detail) ───

async function getParentDetail(site, token, parentId) {
  const params = new URLSearchParams({
    id: parentId,
    _t: Date.now().toString(),
  });

  const url = `https://${site.domain}/rest/international/api/parent/v2/getParentDetailWithChildById?${params}`;
  const headers = buildHeaders(site, token);

  const res = await fetch(url, { headers });
  const data = await res.json();

  if (isAuthError(data, res.status)) return { authError: true };
  if (!isSuccess(data.code)) {
    console.error(`API Error [code=${data.code}]: ${data.msg || JSON.stringify(data)}`);
    process.exit(1);
  }

  const d = data.data;
  return d?.parent ? { ...d.parent, childList: d.childList } : (d?.data ?? d);
}

// ─── Display Helpers ───

function printParentList(results) {
  if (!results?.list?.length) {
    console.log('No parents found.');
    return;
  }

  console.log(`Found ${results.list.length} parent(s):\n`);
  for (const p of results.list) {
    console.log(`  parentId:     ${p.parentId ?? p.id ?? '-'}`);
    console.log(`  name:         ${p.parentName || p.name || '-'}`);
    console.log(`  phone:        ${p.countryCode ? p.countryCode + '-' : ''}${p.phone || '-'}`);
    console.log(`  email:        ${p.email || '-'}`);
    console.log(`  timezone:     ${p.timeZone || '-'}`);
    console.log(`  registerTime: ${p.registerTime ? new Date(p.registerTime).toISOString() : '-'}`);
    console.log(`  status:       ${p.status ?? '-'}`);
    console.log('  ---');
  }
}

function printParentDetail(d) {
  if (!d) { console.log('No data returned.'); return; }

  console.log('=== Parent Detail ===');
  console.log(`  parentId:     ${d.parentId ?? d.id ?? '-'}`);
  console.log(`  name:         ${d.parentName || d.name || '-'}`);
  console.log(`  phone:        ${d.countryCode ? d.countryCode + '-' : ''}${d.phone || '-'}`);
  console.log(`  email:        ${d.email || '-'}`);
  console.log(`  timeZone:     ${d.timeZone || '-'}`);
  console.log(`  registerTime: ${d.registerTime ? new Date(d.registerTime).toISOString() : '-'}`);
  console.log(`  status:       ${d.status ?? '-'}`);

  const children = d.childList || d.studentList || [];
  if (children.length) {
    console.log(`  children (${children.length}):`);
    for (const c of children) {
      console.log(`    - ${c.childId ?? c.id}: ${c.enName || c.name || '-'}`);
    }
  }
}

// ─── Auth Error Handler ───

function handleAuthError(siteKey) {
  invalidateToken(siteKey);
  console.error('\nAUTH_EXPIRED: Token is invalid or expired. Cached token removed.');
  console.error('Need to re-authenticate via browser.');
  process.exit(2);
}

// ─── Main ───

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const COMMANDS = ['search', 'update', 'verify', 'save-token', 'token-status'];

  if (!args.command || !COMMANDS.includes(args.command)) {
    console.log('International Parent Timezone Tool\n');
    console.log('Commands:');
    console.log('  search       Search parent by phone/email/parentId');
    console.log('  update       Update parent timezone');
    console.log('  verify       Verify parent current timezone (detail API)');
    console.log('  save-token   Cache auth token for a site');
    console.log('  token-status Show cached token status\n');
    console.log('Search:  node timezone.mjs search --site sa [--token T] --phone PHONE [--country-code CODE]');
    console.log('Update:  node timezone.mjs update --site sa [--token T] --parent-id PID --timezone "GMT+08:00"');
    console.log('Verify:  node timezone.mjs verify --site sa [--token T] --parent-id PID');
    console.log('Save:    node timezone.mjs save-token --site sa --token TOKEN');
    console.log('Status:  node timezone.mjs token-status\n');
    console.log('Sites: sa, k2, us, jp, tw, vn');
    console.log('\nToken is auto-cached after first use. Pass --token to override/refresh.');
    process.exit(0);
  }

  // ── token-status: no site required ──
  if (args.command === 'token-status') {
    const tokens = loadTokens();
    if (Object.keys(tokens).length === 0) {
      console.log('No cached tokens.');
      process.exit(0);
    }
    console.log('Cached tokens:\n');
    for (const [site, entry] of Object.entries(tokens)) {
      const age = Date.now() - entry.savedAt;
      const expired = age > TOKEN_MAX_AGE_MS;
      const label = expired ? 'EXPIRED' : `valid (~${((TOKEN_MAX_AGE_MS - age) / 3600000).toFixed(1)}h left)`;
      console.log(`  ${site}: ${entry.token.slice(0, 8)}...  ${label}  (saved ${new Date(entry.savedAt).toLocaleString()})`);
    }
    process.exit(0);
  }

  // ── validate site ──
  const siteKey = args.site?.toLowerCase();
  if (!siteKey || !SITES[siteKey]) {
    console.error(`Invalid site: ${args.site}. Valid sites: ${Object.keys(SITES).join(', ')}`);
    process.exit(1);
  }
  const site = SITES[siteKey];

  // ── save-token ──
  if (args.command === 'save-token') {
    if (!args.token) {
      console.error('Error: --token is required.');
      process.exit(1);
    }
    cacheToken(siteKey, args.token);
    process.exit(0);
  }

  // ── resolve token (explicit > cache > fail) ──
  const token = resolveToken(args, siteKey);

  // ── search ──
  if (args.command === 'search') {
    if (!args.phone && !args.email && !args['parent-id']) {
      console.error('Error: at least one of --phone, --email, or --parent-id is required.');
      process.exit(1);
    }

    const results = await searchParent(site, token, {
      phone: args.phone,
      countryCode: args['country-code'],
      email: args.email,
      parentId: args['parent-id'],
    });

    if (results.authError) handleAuthError(siteKey);
    printParentList(results);
  }

  // ── verify ──
  else if (args.command === 'verify') {
    const parentId = args['parent-id'];
    if (!parentId) {
      console.error('Error: --parent-id is required.');
      process.exit(1);
    }

    const detail = await getParentDetail(site, token, parentId);
    if (detail.authError) handleAuthError(siteKey);
    printParentDetail(detail);
  }

  // ── update ──
  else if (args.command === 'update') {
    const parentId = args['parent-id'];
    const timezone = args.timezone;

    if (!parentId) { console.error('Error: --parent-id is required.'); process.exit(1); }
    if (!timezone) { console.error('Error: --timezone is required. Format: GMT+08:00'); process.exit(1); }

    if (!/^GMT[+-]\d{2}:\d{2}$/.test(timezone)) {
      console.error(`Warning: timezone "${timezone}" may be incorrect. Expected: GMT+08:00`);
    }

    // Step 1: update
    const result = await updateTimezone(site, token, parentId, timezone);
    if (result.authError) handleAuthError(siteKey);

    if (!isSuccess(result.code)) {
      console.error(`FAILED: ${JSON.stringify(result)}`);
      process.exit(1);
    }

    console.log('SUCCESS: Timezone updated!\n');

    // Step 2: auto-verify
    console.log('Verifying...\n');
    const detail = await getParentDetail(site, token, parentId);
    if (detail.authError) {
      console.log('(verify skipped: auth error)');
    } else {
      printParentDetail(detail);
      const actual = detail.timeZone || '-';
      console.log(`\n${actual === timezone ? '✅ VERIFIED: timeZone matches!' : `⚠️  MISMATCH: expected ${timezone}, got ${actual}`}`);
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
