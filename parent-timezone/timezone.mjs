#!/usr/bin/env node

// International Parent Timezone Management Tool
// Auth via API (password/OTP), token auto-cached, credentials persisted.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(__dirname, '.tokens.json');
const CRED_FILE = join(__dirname, '.credentials.json');
const TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000;

const SITES = {
  sa: { domain: 'sa-manager.lionabc.com', crCode: 'sa', defaultCountryCode: '966', label: '沙特 SA' },
  k2: { domain: 'k2-manager.lionabc.com', crCode: 'k2', defaultCountryCode: '', label: 'K2' },
  us: { domain: 'us-manager.lionabc.com', crCode: 'us', defaultCountryCode: '1', label: '美国 US' },
  jp: { domain: 'jp-manager.lionabc.com', crCode: 'jp', defaultCountryCode: '81', label: '日本 JP' },
  tw: { domain: 'tw-manager.lionabc.com', crCode: 'tw', defaultCountryCode: '886', label: '台湾 TW' },
  vn: { domain: 'vn-manager.lionabc.com', crCode: 'vn', defaultCountryCode: '84', label: '越南 VN' },
};

// ─── File Helpers ───

function loadJSON(file) {
  try { if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf-8')); } catch {}
  return {};
}
function saveJSON(file, data) { writeFileSync(file, JSON.stringify(data, null, 2)); }

// ─── Token Cache ───

function getCachedToken(siteKey) {
  const tokens = loadJSON(TOKEN_FILE);
  const entry = tokens[siteKey];
  if (!entry) return null;
  const age = Date.now() - entry.savedAt;
  if (age > TOKEN_MAX_AGE_MS) {
    console.error(`[token] ${siteKey} expired (${(age / 3600000).toFixed(1)}h ago).`);
    return null;
  }
  console.error(`[token] Using cached ${siteKey} token (~${((TOKEN_MAX_AGE_MS - age) / 3600000).toFixed(1)}h left).`);
  return entry.token;
}

function cacheToken(siteKey, token) {
  const tokens = loadJSON(TOKEN_FILE);
  tokens[siteKey] = { token, savedAt: Date.now() };
  saveJSON(TOKEN_FILE, tokens);
  console.log(`[token] Saved ${siteKey} token.`);
}

function invalidateToken(siteKey) {
  const tokens = loadJSON(TOKEN_FILE);
  delete tokens[siteKey];
  saveJSON(TOKEN_FILE, tokens);
}

// ─── Credentials ───

function getCredentials() { return loadJSON(CRED_FILE); }
function saveCredentials(userName, password) {
  saveJSON(CRED_FILE, { userName, password });
  console.log(`[cred] Saved credentials for ${userName}.`);
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

// ─── Multipart Builder ───

function buildMultipart(fields) {
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
  const parts = Object.entries(fields).map(([k, v]) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}`
  );
  const body = parts.join('\r\n') + `\r\n--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

// ─── HTTP Helpers ───

function buildHeaders(site, token) {
  return {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'App-Code': 'international-mgt',
    'Authorization': token,
    'Biz-Line': site.crCode,
    'Cookie': `intlAuthToken=${token}`,
    'vk-cr-code': site.crCode,
    'vk-device': 'PC',
    'vk-language': 'zh-cn',
  };
}

function isSuccess(code) { return code === 0 || code === 200; }

function isAuthError(data, status) {
  if (status === 401 || status === 403) return true;
  if (data?.code === 401 || data?.code === 403) return true;
  if (data?.msg?.includes?.('token') || data?.msg?.includes?.('login')) return true;
  return false;
}

// ─── Auth APIs ───

async function getLoginStrategy(site, userName) {
  const url = `https://${site.domain}/rest/auth/api/auth/login/strategy?userName=${encodeURIComponent(userName)}&_t=${Date.now()}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'app-Code': 'international-mgt', 'vk-language-code': 'zh-cn' },
  });
  const data = await res.json();
  return isSuccess(data.code) ? data.data : 'PASSWORD';
}

async function apiLogin(site, userName, password, loginType) {
  const { body, contentType } = buildMultipart({ userName, password, loginType });
  const url = `https://${site.domain}/rest/auth/api/auth/login`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': contentType,
      'app-Code': 'international-mgt',
      'Origin': `https://${site.domain}`,
      'vk-language-code': 'zh-cn',
    },
    body,
  });
  return await res.json();
}

async function sendOtp(site, email) {
  const url = `https://${site.domain}/rest/auth/api/auth/otp/send`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'app-Code': 'international-mgt' },
    body: JSON.stringify({ email }),
  });
  return await res.json();
}

// ─── Business APIs ───

async function searchParent(site, token, { phone, countryCode, email, parentId }) {
  const params = new URLSearchParams({
    kpFlag: '', countryCodes: countryCode || '',
    phone: phone || '', email: email || '', automaticRenewal: '',
    parentId: parentId || '', studentId: '', registerTimeBegin: '', registerTimeEnd: '',
    tagIds: '', channelCodes: '', orgCodes: '', staffId: '', gccStaffId: '',
    startId: '0', limit: '100', _t: Date.now().toString(),
  });
  const url = `https://${site.domain}/rest/international/api/parent/list?${params}`;
  const headers = { ...buildHeaders(site, token) };
  delete headers['Biz-Line'];
  const res = await fetch(url, { headers });
  const data = await res.json();
  if (isAuthError(data, res.status)) return { authError: true };
  if (!isSuccess(data.code)) { console.error(`API Error: ${data.msg || JSON.stringify(data)}`); process.exit(1); }
  return data.data?.data ? { list: data.data.data, total: data.data.total } : data.data;
}

async function updateTimezone(site, token, parentId, timezone) {
  const { body, contentType } = buildMultipart({ parentId, timeZone: timezone });
  const headers = { ...buildHeaders(site, token), 'Content-Type': contentType,
    'Origin': `https://${site.domain}`, 'Referer': `https://${site.domain}/` };
  const url = `https://${site.domain}/rest/international/api/parent/updateTimeZone`;
  const res = await fetch(url, { method: 'POST', headers, body });
  const data = await res.json();
  if (isAuthError(data, res.status)) return { authError: true };
  return data;
}

async function getParentDetail(site, token, parentId) {
  const url = `https://${site.domain}/rest/international/api/parent/v2/getParentDetailWithChildById?id=${parentId}&_t=${Date.now()}`;
  const res = await fetch(url, { headers: buildHeaders(site, token) });
  const data = await res.json();
  if (isAuthError(data, res.status)) return { authError: true };
  if (!isSuccess(data.code)) { console.error(`API Error: ${data.msg || JSON.stringify(data)}`); process.exit(1); }
  const d = data.data;
  return d?.parent ? { ...d.parent, childList: d.childList || d.childs } : (d?.data ?? d);
}

// ─── Display ───

function printParentList(results) {
  if (!results?.list?.length) { console.log('No parents found.'); return; }
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
    for (const c of children) console.log(`    - ${c.childId ?? c.id}: ${c.enName || c.name || '-'}`);
  }
}

// ─── Token Resolution with Auto Re-auth ───

async function resolveToken(args, siteKey, site) {
  if (args.token) { cacheToken(siteKey, args.token); return args.token; }

  const cached = getCachedToken(siteKey);
  if (cached) return cached;

  // Try auto re-auth with saved credentials (PASSWORD type only)
  const cred = getCredentials();
  if (cred.userName && cred.password) {
    console.log('[auth] Token expired, auto re-auth with saved credentials...');
    const strategy = await getLoginStrategy(site, cred.userName);
    if (strategy === 'PASSWORD') {
      const result = await apiLogin(site, cred.userName, cred.password, 'PASSWORD');
      if (isSuccess(result.code) && result.data?.token) {
        cacheToken(siteKey, result.data.token);
        console.log('[auth] Auto re-auth success!');
        return result.data.token;
      }
      console.error(`[auth] Auto re-auth failed: ${result.msg || JSON.stringify(result)}`);
    }
  }

  console.error('NO_TOKEN: No valid token and cannot auto-auth.');
  console.error('Run: node timezone.mjs auth --site <site> --user <email> --password <pwd>');
  process.exit(2);
}

async function handleAuthError(args, siteKey, site) {
  invalidateToken(siteKey);
  console.error('\n[auth] Token invalid, attempting re-auth...');
  return await resolveToken(args, siteKey, site);
}

// ─── Main ───

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const COMMANDS = ['auth', 'login-strategy', 'send-otp', 'search', 'update', 'verify', 'save-token', 'token-status'];

  if (!args.command || !COMMANDS.includes(args.command)) {
    console.log(`International Parent Timezone Tool

Commands:
  auth           Login via API (password or OTP)
  login-strategy Check login strategy for a user
  send-otp       Send OTP verification code
  search         Search parent by phone/email/parentId
  update         Update parent timezone (auto-verify)
  verify         Verify parent current timezone
  save-token     Manually cache a token
  token-status   Show cached token status

Auth:     node timezone.mjs auth --site sa --user EMAIL --password PWD [--login-type PASSWORD|PASSWORD_OTP]
Strategy: node timezone.mjs login-strategy --site sa --user EMAIL
Send OTP: node timezone.mjs send-otp --site sa --email EMAIL
Search:   node timezone.mjs search --site sa --phone PHONE [--country-code CODE]
Update:   node timezone.mjs update --site sa --parent-id PID --timezone "GMT+08:00"
Verify:   node timezone.mjs verify --site sa --parent-id PID

Sites: sa, k2, us, jp, tw, vn
Token auto-cached (8h). PASSWORD credentials saved for auto re-auth.`);
    process.exit(0);
  }

  // ── token-status ──
  if (args.command === 'token-status') {
    const tokens = loadJSON(TOKEN_FILE);
    const cred = getCredentials();
    if (Object.keys(tokens).length === 0) { console.log('No cached tokens.'); }
    else {
      console.log('Cached tokens:\n');
      for (const [s, e] of Object.entries(tokens)) {
        const age = Date.now() - e.savedAt;
        const expired = age > TOKEN_MAX_AGE_MS;
        const label = expired ? 'EXPIRED' : `valid (~${((TOKEN_MAX_AGE_MS - age) / 3600000).toFixed(1)}h left)`;
        console.log(`  ${s}: ${e.token.slice(0, 8)}...  ${label}  (${new Date(e.savedAt).toLocaleString()})`);
      }
    }
    if (cred.userName) console.log(`\nSaved credentials: ${cred.userName} (auto re-auth enabled)`);
    else console.log('\nNo saved credentials.');
    process.exit(0);
  }

  // ── validate site ──
  const siteKey = args.site?.toLowerCase();
  if (!siteKey || !SITES[siteKey]) {
    console.error(`Invalid site: ${args.site}. Valid: ${Object.keys(SITES).join(', ')}`);
    process.exit(1);
  }
  const site = SITES[siteKey];

  // ── save-token ──
  if (args.command === 'save-token') {
    if (!args.token) { console.error('Error: --token required.'); process.exit(1); }
    cacheToken(siteKey, args.token);
    process.exit(0);
  }

  // ── login-strategy ──
  if (args.command === 'login-strategy') {
    if (!args.user) { console.error('Error: --user required.'); process.exit(1); }
    const strategy = await getLoginStrategy(site, args.user);
    console.log(`Login strategy for ${args.user}: ${strategy}`);
    process.exit(0);
  }

  // ── send-otp ──
  if (args.command === 'send-otp') {
    if (!args.email) { console.error('Error: --email required.'); process.exit(1); }
    const result = await sendOtp(site, args.email);
    if (isSuccess(result.code)) { console.log(`OTP sent to ${args.email}. Check DingTalk/email.`); }
    else { console.error(`OTP send failed: ${result.msg || JSON.stringify(result)}`); process.exit(1); }
    process.exit(0);
  }

  // ── auth ──
  if (args.command === 'auth') {
    if (!args.user) { console.error('Error: --user required (email).'); process.exit(1); }
    if (!args.password) { console.error('Error: --password required.'); process.exit(1); }

    let loginType = args['login-type'];
    if (!loginType) {
      loginType = await getLoginStrategy(site, args.user);
      console.log(`[auth] Detected login strategy: ${loginType}`);
    }

    const result = await apiLogin(site, args.user, args.password, loginType);
    if (!isSuccess(result.code)) {
      console.error(`Login failed: ${result.msg || JSON.stringify(result)}`);
      process.exit(1);
    }

    const token = result.data?.token;
    if (!token) {
      console.error(`Login response missing token: ${JSON.stringify(result.data)}`);
      process.exit(1);
    }

    cacheToken(siteKey, token);

    if (loginType === 'PASSWORD') {
      saveCredentials(args.user, args.password);
    }

    console.log(`\nAuth success! Logged in as: ${result.data.name || result.data.email || args.user}`);
    console.log(`Token: ${token.slice(0, 8)}...`);
    if (loginType === 'PASSWORD') console.log('Credentials saved. Future re-auth will be automatic.');
    process.exit(0);
  }

  // ── resolve token for business commands ──
  let token = await resolveToken(args, siteKey, site);

  // ── search ──
  if (args.command === 'search') {
    if (!args.phone && !args.email && !args['parent-id']) {
      console.error('Error: --phone, --email, or --parent-id required.'); process.exit(1);
    }
    let results = await searchParent(site, token, {
      phone: args.phone, countryCode: args['country-code'], email: args.email, parentId: args['parent-id'],
    });
    if (results.authError) {
      token = await handleAuthError(args, siteKey, site);
      results = await searchParent(site, token, {
        phone: args.phone, countryCode: args['country-code'], email: args.email, parentId: args['parent-id'],
      });
    }
    printParentList(results);
  }

  // ── verify ──
  else if (args.command === 'verify') {
    if (!args['parent-id']) { console.error('Error: --parent-id required.'); process.exit(1); }
    let detail = await getParentDetail(site, token, args['parent-id']);
    if (detail.authError) {
      token = await handleAuthError(args, siteKey, site);
      detail = await getParentDetail(site, token, args['parent-id']);
    }
    printParentDetail(detail);
  }

  // ── update ──
  else if (args.command === 'update') {
    const { 'parent-id': parentId, timezone } = args;
    if (!parentId) { console.error('Error: --parent-id required.'); process.exit(1); }
    if (!timezone) { console.error('Error: --timezone required. e.g. GMT+08:00'); process.exit(1); }
    if (!/^GMT[+-]\d{2}:\d{2}$/.test(timezone)) console.error(`Warning: "${timezone}" format may be wrong.`);

    let result = await updateTimezone(site, token, parentId, timezone);
    if (result.authError) {
      token = await handleAuthError(args, siteKey, site);
      result = await updateTimezone(site, token, parentId, timezone);
    }
    if (!isSuccess(result.code)) { console.error(`FAILED: ${JSON.stringify(result)}`); process.exit(1); }

    console.log('SUCCESS: Timezone updated!\n\nVerifying...\n');
    const detail = await getParentDetail(site, token, parentId);
    if (detail.authError) { console.log('(verify skipped: auth error)'); }
    else {
      printParentDetail(detail);
      const actual = detail.timeZone || '-';
      console.log(`\n${actual === timezone ? '✅ VERIFIED: timeZone matches!' : `⚠️  MISMATCH: expected ${timezone}, got ${actual}`}`);
    }
  }
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
