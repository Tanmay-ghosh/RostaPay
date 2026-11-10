// MCP endpoint: the owner's own Claude connects here and does the thinking.
// RostaPay itself has no AI — it stores, checks, calculates and serves.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { one } from './db.js';
import * as svc from './services.js';
import { computePay } from './lib/payEngine.js';
import { ruleSchema, time, date, weekday } from './schemas.js';
import { DAY_NAMES, fmtINR, fmtHours, assertDate, assertShiftTimes } from './lib/time.js';

const INSTRUCTIONS = `RostaPay runs staff rosters and pay for a small business (café, salon, clinic) in India.
You (Claude) do the thinking: read the owner's pay policy, staff list and availability, and draft rosters.
RostaPay does the rest with plain code: stores everything, checks rosters against the rules, calculates pay from approved hours, and gives the owner and each worker their own login.
Typical setup: get_business_overview → update_business_settings (limits + coverage) → upsert_staff → set_pay_rules → test_pay to verify each rule → create_roster for the week → tell the owner to review and publish it in the RostaPay app.
Dates are YYYY-MM-DD, times are 24h HH:MM, weeks start on Monday, money is INR.`;

const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: `Error: ${e?.issues ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : e.message}` }] });
const safe = (fn) => async (args) => { try { return await fn(args); } catch (e) { return fail(e); } };

function rosterSummary(w, appUrl) {
  return {
    week_start: w.week_start,
    shifts: w.shifts.map((s) => ({ staff: s.staff_name, date: s.date, day: DAY_NAMES[new Date(s.date + 'T00:00:00Z').getUTCDay()], start_time: s.start_time, end_time: s.end_time, role: s.role, status: s.status })),
    violations: w.violations.map((v) => ({
      problem: v.message,
      ...(v.why ? { why: v.why } : {}),
      can_fix_in_roster: !v.infeasible,
      suggested_fixes: (v.fixes || []).map((f) => f.label),
    })),
    draft_shifts: w.draft_count,
    next_step: w.draft_count ? `Draft saved. Ask the owner to review it and press "Publish week" at ${appUrl}/owner/roster?week=${w.week_start} (they can drag shifts to fix anything).` : 'All shifts are published.',
  };
}

function buildServer(biz, appUrl) {
  const server = new McpServer({ name: 'rostapay', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const bid = biz.id;

  server.registerTool('get_business_overview', {
    title: 'Get business overview',
    description: 'Read everything RostaPay knows about this business: settings, coverage needs, staff with roles and availability, pay rules, and a summary of the current week. Call this first.',
    inputSchema: {},
  }, safe(async () => {
    const [b, staff, coverage, rules, week] = await Promise.all([svc.getBusiness(bid), svc.getStaffFull(bid), svc.getCoverage(bid), svc.getRules(bid), svc.getWeek(bid)]);
    return text({
      business: { name: b.name, max_days_per_week: b.max_days_per_week, max_hours_per_day: b.max_hours_per_day, min_rest_hours: b.min_rest_hours },
      coverage: coverage.map(({ id, ...c }) => ({ ...c, day: DAY_NAMES[c.weekday] })),
      staff: staff.map((s) => ({ id: s.id, name: s.name, phone: s.phone, role: s.role, availability: s.availability.map((a) => `${DAY_NAMES[a.weekday]} ${a.start_time}–${a.end_time}`), unavailable_dates: s.unavailable_dates.map((u) => `${u.date}${u.reason ? ` (${u.reason})` : ''}`) })),
      pay_rules: rules.map((r) => ({ name: r.name, kind: r.kind, priority: r.priority, enabled: r.enabled, summary: r.summary, source_text: r.source_text, conditions: r.conditions, effect: r.effect })),
      current_week: { week_start: week.week_start, shifts: week.shifts.length, draft_shifts: week.draft_count, violations: week.violations.map((v) => v.message) },
      app_url: appUrl,
    });
  }));

  server.registerTool('update_business_settings', {
    title: 'Update business settings',
    description: 'Set the business name, roster limits and how many people must be on shift at what times (coverage). Passing coverage replaces all existing coverage requirements.',
    inputSchema: {
      name: z.string().optional(),
      max_days_per_week: z.number().int().min(1).max(7).nullable().optional().describe('Max days any one person may work in a week'),
      max_hours_per_day: z.number().min(1).max(24).nullable().optional(),
      min_rest_hours: z.number().min(0).max(24).nullable().optional().describe('Minimum rest between two shifts of the same person'),
      coverage: z.array(z.object({ weekday: weekday.describe('0=Sun..6=Sat'), start_time: time, end_time: time, min_staff: z.number().int().min(1), role: z.string().optional() })).optional(),
    },
  }, safe(async (args) => {
    await svc.saveSettings(bid, args);
    return text({ ok: true, coverage_rows: args.coverage?.length ?? 'unchanged' });
  }));

  server.registerTool('upsert_staff', {
    title: 'Add or update staff',
    description: 'Add staff or update existing ones (matched by 10-digit phone number). Each person logs into the RostaPay worker app with their phone + 4-digit PIN. If you omit pin for a new person a random PIN is generated and returned — tell the owner. availability = recurring weekly windows when they CAN work (replaces existing if given); unavailable_dates = one-off days off (replaces existing if given).',
    inputSchema: {
      staff: z.array(z.object({
        name: z.string(),
        phone: z.string().describe('10-digit Indian mobile number'),
        role: z.string().optional().describe('e.g. barista, cook, cashier'),
        pin: z.string().regex(/^\d{4}$/).optional(),
        availability: z.array(z.object({ weekday: weekday.describe('0=Sun..6=Sat'), start_time: time, end_time: time })).optional(),
        unavailable_dates: z.array(z.object({ date, reason: z.string().optional() })).optional(),
      })).min(1),
    },
  }, safe(async ({ staff }) => text({ results: await svc.upsertStaff(bid, staff), login_page: `${appUrl}/staff/login` })));

  server.registerTool('set_pay_rules', {
    title: 'Set pay rules',
    description: `Save the business's pay policy as structured rules that RostaPay calculates exactly, every time.
Translate the owner's policy into rules. Each rule = kind + priority + conditions (ALL must match) + effect.
- rate: {rate_per_hour}. Usually one base rate (priority 1, no conditions) plus e.g. overtime as a higher-priority rate with {daily_hours_over: 8}.
- addon: one of {multiplier}, {extra_per_hour}, {flat_amount} (once per matching shift), {deduction} (once per matching shift), {minimum_paid_hours}; optional {weekly_cap}.
- override: {multiplier} or {rate_per_hour} — replaces everything with lower priority for matching hours (holidays).
- manual: anything not computable from hours (sales targets, performance) — stored so nothing is silently dropped.
Conditions: time_window {start,end} (night hours), days_of_week [0=Sun..6], dates [], daily_hours_over, weekly_hours_over, roles [], staff_ids [], min_shift_hours, expression (JSON Logic over {hours, day_of_week, date, role, staff_id, shift_start_hour, weekly_hours_so_far, month_day}).
Always fill source_text with the owner's wording. mode "replace" (default) replaces all rules; "append" adds. After saving, call test_pay on tricky cases and show the owner the breakdowns.`,
    inputSchema: {
      mode: z.enum(['replace', 'append']).default('replace'),
      rules: z.array(ruleSchema).min(1),
    },
  }, safe(async ({ mode, rules }) => {
    const n = await svc.saveRules(bid, rules, mode);
    const saved = await svc.getRules(bid);
    return text({ saved: n, rules_now: saved.map((r) => `[${r.kind}, priority ${r.priority}] ${r.name}: ${r.summary}`), review_in_app: `${appUrl}/owner/rules` });
  }));

  server.registerTool('test_pay', {
    title: 'Test pay for a shift',
    description: 'Calculate pay for a hypothetical shift with the saved rules, returning the line-by-line breakdown. Use it to check your rule translation (e.g. a 10h shift, a night shift, a holiday).',
    inputSchema: {
      date,
      start_time: time,
      end_time: time.describe('End time; at or before start means next day'),
      break_minutes: z.number().int().min(0).default(0),
      staff: z.string().optional().describe('Staff name or phone (optional)'),
      role: z.string().optional().describe('Role to test with if no staff given'),
    },
  }, safe(async (a) => {
    assertDate(a.date);
    assertShiftTimes(a.start_time, a.end_time, a.break_minutes);
    const st = a.staff ? await svc.findStaff(bid, a.staff) : null;
    if (a.staff && !st) throw new Error(`Unknown staff "${a.staff}" — use a name or phone from get_business_overview, or leave staff out and pass role`);
    const rules = await svc.getRules(bid);
    const r = computePay({ rules, staff: st || { id: 'test', role: a.role || '' }, logs: [{ id: 't', date: a.date, start: a.start_time, end: a.end_time, break_minutes: a.break_minutes }] });
    return text({ worked: fmtHours(r.worked_minutes), breakdown: r.lines.map((l) => `${l.rule_name}: ${l.label} = ${fmtINR(l.amount)}`), total: fmtINR(r.total), warnings: r.warnings, manual_rules_not_included: r.manual_rules.map((m) => m.name) });
  }));

  server.registerTool('create_roster', {
    title: 'Create a weekly roster',
    description: 'Save a roster you drafted for one Mon–Sun week as DRAFT shifts. RostaPay checks it (coverage, availability, days off, max days/hours, overlaps, rest) and returns any violations, each with suggested fixes computed by RostaPay. Fix what can be fixed in the roster (apply the suggestions or redraft) and call again until no fixable violations remain. Violations with can_fix_in_roster=false cannot be solved by any roster (e.g. nobody is available then): do NOT keep retrying — explain them to the owner in plain words with the suggested options (change opening hours/coverage via update_business_settings, ask staff to widen availability, or hire), and let the owner decide. replace_existing (default true) replaces the week\'s existing shifts (shifts with logged hours are kept). The owner then reviews and publishes it in the app.',
    inputSchema: {
      week_start: date.describe('Any date in the week; normalised to Monday'),
      replace_existing: z.boolean().default(true),
      shifts: z.array(z.object({ staff: z.string().describe('Staff name or phone'), date, start_time: time, end_time: time, role: z.string().optional().describe("Defaults to the person's own role. A different role is flagged and does not count toward that role's coverage."), notes: z.string().optional() })).min(1),
    },
  }, safe(async (a) => {
    assertDate(a.week_start);
    for (const s of a.shifts) assertDate(s.date);
    return text(rosterSummary(await svc.saveRoster(bid, a.week_start, a.shifts, a.replace_existing), appUrl));
  }));

  server.registerTool('get_roster', {
    title: 'Get roster',
    description: 'Read the roster for a week (defaults to the current week) with status and any rule violations.',
    inputSchema: { week_start: date.optional() },
  }, safe(async (a) => text(rosterSummary(await svc.getWeek(bid, a.week_start), appUrl))));

  server.registerTool('get_payouts', {
    title: 'Get payouts',
    description: 'Read the pay summary for a week (defaults to current week): per person hours, line-by-line pay from APPROVED hours, manual adjustments, pending hours awaiting approval, and paid status. Useful for answering questions or analysing labour cost.',
    inputSchema: { week_start: date.optional() },
  }, safe(async (a) => {
    const p = await svc.getPayouts(bid, a.week_start);
    return text({
      week_start: p.week_start,
      total: fmtINR(p.total),
      people: p.rows.map((r) => ({ name: r.staff.name, role: r.staff.role, approved_hours: fmtHours(r.worked_minutes), breakdown: r.lines.map((l) => `${l.rule_name}: ${l.label} = ${fmtINR(l.amount)}`), adjustments: r.adjustments.map((x) => `${x.description}: ${fmtINR(x.amount)}`), total: fmtINR(r.total), pending_hours: r.pending ? `${r.pending.count} log(s) awaiting approval, ~${fmtINR(r.pending.estimated_extra)}` : null, paid: !!r.paid })),
      manual_rules_to_handle: p.manual_rules.map((m) => `${m.name}: ${m.source_text}`),
      open_in_app: `${appUrl}/owner/payouts?week=${p.week_start}`,
    });
  }));

  return server;
}

export async function handleMcp(req, res) {
  const biz = await one('SELECT id, name FROM businesses WHERE mcp_key=$1', [req.params.key]);
  if (!biz) return res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unknown RostaPay connection link. Copy it again from Settings → Connect Claude.' }, id: null });
  if (req.body?.method === 'tools/call') await one('UPDATE businesses SET mcp_last_used_at=now() WHERE id=$1 RETURNING id', [biz.id]);
  const appUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `${req.protocol}://${req.get('host')}`;
  const server = buildServer(biz, appUrl);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
