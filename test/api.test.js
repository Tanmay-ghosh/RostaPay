// End-to-end API tests against a real Postgres (QA defects D1, D4, D6, D8, D9, D11).
// Run with: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/rostapay_test npm test
// Skipped when TEST_DATABASE_URL is not set. The database is wiped at the start.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import pg from 'pg';

const DB = process.env.TEST_DATABASE_URL;
const PORT = 3917;
const BASE = `http://127.0.0.1:${PORT}`;

class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, body) {
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', cookie: this.cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, body: json };
  }
}
async function mcp(key, name, args) {
  const r = await fetch(`${BASE}/mcp/${key}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const j = await r.json();
  return { isError: !!j.result?.isError, text: j.result?.content?.[0]?.text || JSON.stringify(j) };
}

describe.skipIf(!DB)('API — QA fixes', () => {
  let server, db, key;
  const chai = new Client();

  beforeAll(async () => {
    db = new pg.Client({ connectionString: DB });
    await db.connect();
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    server = spawn('node', ['server/index.js'], { env: { ...process.env, DATABASE_URL: DB, PORT: String(PORT), NODE_ENV: 'test' }, stdio: 'pipe' });
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 200)); }
    expect((await chai.req('POST', '/api/auth/owner/signup', { business_name: 'Chai Point', email: 'qa@chai.test', password: 'password123' })).status).toBe(200);
    key = (await chai.req('GET', '/api/owner/settings')).body.mcp_url.split('/mcp/')[1];
  }, 30000);
  afterAll(async () => { server?.kill(); await db?.end(); });

  describe('D1 — staff identity across businesses', () => {
    it('demo café staff now use reserved 1000000001–05 numbers', async () => {
      const { rows } = await db.query("SELECT phone FROM staff ORDER BY phone");
      expect(rows.map((r) => r.phone)).toEqual(['1000000001', '1000000002', '1000000003', '1000000004', '1000000005']);
    });
    it('a real business cannot add a reserved demo number', async () => {
      const r = await mcp(key, 'upsert_staff', { staff: [{ name: 'X', phone: '1000000001', role: 'helper' }] });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/not a valid Indian mobile/);
    });
    it('Chai Point Ravi (9000000001) cannot land in the demo café with the public PIN 1234', async () => {
      const add = await mcp(key, 'upsert_staff', { staff: [{ name: 'Ravi Kumar', phone: '9000000001', role: 'chai maker', pin: '8733' }] });
      expect(add.isError).toBe(false);
      expect((await new Client().req('POST', '/api/auth/worker/login', { phone: '9000000001', pin: '1234' })).status).toBe(401);
      const w = new Client();
      expect((await w.req('POST', '/api/auth/worker/login', { phone: '9000000001', pin: '8733' })).status).toBe(200);
      expect((await w.req('GET', '/api/worker/me')).body.business_name).toBe('Chai Point');
    });
    it('a second business cannot give the same phone the same PIN; auto PINs avoid clashes', async () => {
      const other = new Client();
      await other.req('POST', '/api/auth/owner/signup', { business_name: 'Dosa Corner', email: 'qa@dosa.test', password: 'password123' });
      const k2 = (await other.req('GET', '/api/owner/settings')).body.mcp_url.split('/mcp/')[1];
      const clash = await mcp(k2, 'upsert_staff', { staff: [{ name: 'Ravi K', phone: '9000000001', pin: '8733' }] });
      expect(clash.isError).toBe(true);
      expect(clash.text).toMatch(/already uses PIN 8733 at another RostaPay business/);
      const auto = JSON.parse((await mcp(k2, 'upsert_staff', { staff: [{ name: 'Ravi K', phone: '9000000001' }] })).text);
      expect(auto.results[0].pin).not.toBe('8733');
    });
    it('legacy accounts with the same phone + PIN at two businesses get a workplace picker', async () => {
      const { rows: [b] } = await db.query("SELECT id FROM businesses WHERE name='Dosa Corner'");
      const { rows: [chaiRavi] } = await db.query("SELECT pin_hash FROM staff WHERE phone='9000000001' AND business_id<>$1", [b.id]);
      await db.query("UPDATE staff SET pin_hash=$1 WHERE phone='9000000001' AND business_id=$2", [chaiRavi.pin_hash, b.id]);
      const w = new Client();
      const r = await w.req('POST', '/api/auth/worker/login', { phone: '9000000001', pin: '8733' });
      expect(r.body.choose_business.map((c) => c.name).sort()).toEqual(['Chai Point', 'Dosa Corner']);
      expect(w.cookie).toBe('');
      const pick = await w.req('POST', '/api/auth/worker/login', { phone: '9000000001', pin: '8733', business_id: b.id });
      expect(pick.status).toBe(200);
      expect((await w.req('GET', '/api/worker/me')).body.business_name).toBe('Dosa Corner');
    });
  });

  describe('D4 / D6 / D8 / D9 — MCP input validation', () => {
    it('test_pay rejects an unknown staff name', async () => {
      const r = await mcp(key, 'test_pay', { date: '2026-11-18', start_time: '08:00', end_time: '16:00', staff: 'Nobody Here' });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/Unknown staff "Nobody Here"/);
    });
    it('test_pay still works for a known staff member', async () => {
      const r = await mcp(key, 'test_pay', { date: '2026-11-18', start_time: '08:00', end_time: '16:00', staff: 'Ravi Kumar' });
      expect(r.isError).toBe(false);
    });
    it('test_pay rejects start = end, 30 Feb and an oversized break', async () => {
      expect((await mcp(key, 'test_pay', { date: '2026-11-18', start_time: '10:00', end_time: '10:00' })).text).toMatch(/needs a length/);
      expect((await mcp(key, 'test_pay', { date: '2026-02-30', start_time: '09:00', end_time: '17:00' })).text).toMatch(/Invalid date/);
      expect((await mcp(key, 'test_pay', { date: '2026-11-18', start_time: '09:00', end_time: '10:00', break_minutes: 120 })).text).toMatch(/Break of 120 min/);
    });
    it('create_roster rejects a zero-length shift and saves nothing', async () => {
      const r = await mcp(key, 'create_roster', { week_start: '2027-03-01', shifts: [{ staff: 'Ravi Kumar', date: '2027-03-02', start_time: '10:00', end_time: '10:00' }] });
      expect(r.isError).toBe(true);
      expect((await db.query("SELECT count(*)::int AS n FROM shifts WHERE date='2027-03-02'")).rows[0].n).toBe(0);
    });
  });

  describe('D11 — worker week before publishing', () => {
    it('a draft-only week is reported as not published; publishing flips it', async () => {
      await mcp(key, 'create_roster', { week_start: '2027-03-01', shifts: [{ staff: 'Ravi Kumar', date: '2027-03-02', start_time: '08:00', end_time: '16:00' }] });
      const w = new Client();
      await w.req('POST', '/api/auth/worker/login', { phone: '9000000001', pin: '8733', business_id: (await db.query("SELECT id FROM businesses WHERE name='Chai Point'")).rows[0].id });
      expect((await w.req('GET', '/api/worker/week?week=2027-03-01')).body.week_published).toBe(false);
      await chai.req('POST', '/api/owner/roster/publish', { week: '2027-03-01' });
      const after = (await w.req('GET', '/api/worker/week?week=2027-03-01')).body;
      expect(after.week_published).toBe(true);
      expect(after.my_shifts).toHaveLength(1);
    });
  });
});
