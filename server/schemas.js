import { z } from 'zod';

export const time = z.string().regex(/^([01]?\d|2[0-4]):[0-5]\d$/, 'Use 24h HH:MM');
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const weekday = z.number().int().min(0).max(6);

export const conditionsSchema = z.object({
  time_window: z.object({ start: time, end: time }).optional()
    .describe('Only the minutes of a shift inside this clock window count, e.g. {"start":"22:00","end":"06:00"} for night hours (may wrap past midnight).'),
  days_of_week: z.array(weekday).optional().describe('0=Sun,1=Mon,...,6=Sat'),
  dates: z.array(date).optional().describe('Specific dates such as public holidays'),
  daily_hours_over: z.number().min(0).optional().describe('Only hours worked beyond N in the same day (daily overtime)'),
  weekly_hours_over: z.number().min(0).optional().describe('Only hours worked beyond N in the Mon–Sun week (weekly overtime)'),
  roles: z.array(z.string()).optional().describe('Only hours worked in these jobs, e.g. ["cook"]. Matches the job done on the shift (shift role), not the person\'s main role'),
  staff_ids: z.array(z.string()).optional().describe('Only these staff ids'),
  min_shift_hours: z.number().min(0).optional().describe('Only shifts at least N hours long'),
  expression: z.any().optional().describe('Escape hatch: a JSON Logic expression evaluated per shift against {hours, day_of_week, date, role, staff_id, shift_start_hour, weekly_hours_so_far, month_day}. Example: {">=":[{"var":"shift_start_hour"},20]}'),
}).strict();

export const effectSchema = z.object({
  rate_per_hour: z.number().min(0).optional(),
  multiplier: z.number().min(0).optional(),
  extra_per_hour: z.number().optional(),
  flat_amount: z.number().optional(),
  deduction: z.number().min(0).optional(),
  minimum_paid_hours: z.number().min(0).optional(),
  weekly_cap: z.number().min(0).optional(),
}).strict();

export const ruleSchema = z.object({
  name: z.string().min(1).describe('Short name shown on payslips, e.g. "Overtime"'),
  source_text: z.string().optional().describe("The owner's original wording of this rule"),
  kind: z.enum(['rate', 'addon', 'override', 'manual']).describe(
    'rate = sets the hourly rate for matching hours (highest priority matching rate wins). ' +
    'addon = adds on top: multiplier (adds base×(m−1) per hour), extra_per_hour, flat_amount (once per shift that matches), deduction (once per shift), minimum_paid_hours (top-up at base rate); optional weekly_cap. ' +
    'override = for matching hours, replaces the rate (rate_per_hour or multiplier×base) and suppresses lower-priority rules — e.g. holiday double pay. ' +
    'manual = cannot be computed automatically (e.g. depends on sales); stored so the owner applies it by hand.'),
  priority: z.number().int().default(1).describe('Higher wins when rules compete'),
  conditions: conditionsSchema.default({}),
  effect: effectSchema.default({}),
  enabled: z.boolean().default(true),
});

export function validateRuleShape(r) {
  const parsed = ruleSchema.parse(r);
  const e = parsed.effect;
  const has = (k) => e[k] != null;
  if (parsed.kind === 'rate' && !has('rate_per_hour')) throw new Error(`Rule "${parsed.name}": a rate rule needs effect.rate_per_hour`);
  if (parsed.kind === 'override' && !has('rate_per_hour') && !has('multiplier')) throw new Error(`Rule "${parsed.name}": an override needs effect.rate_per_hour or effect.multiplier`);
  if (parsed.kind === 'addon' && !['multiplier', 'extra_per_hour', 'flat_amount', 'deduction', 'minimum_paid_hours'].some(has)) {
    throw new Error(`Rule "${parsed.name}": an addon needs one of multiplier, extra_per_hour, flat_amount, deduction, minimum_paid_hours`);
  }
  return parsed;
}
