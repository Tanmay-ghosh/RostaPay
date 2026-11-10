import pg from 'pg';

const url = process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/rostapay';
const useSSL = process.env.DB_SSL === 'true' || /render\.com|neon\.tech|supabase\.co/.test(url);

export const pool = new pg.Pool({ connectionString: url, ssl: useSSL ? { rejectUnauthorized: false } : false, max: 5 });

export const q = async (text, params) => (await pool.query(text, params)).rows;
export const one = async (text, params) => (await pool.query(text, params)).rows[0];

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn({ q: async (t, p) => (await client.query(t, p)).rows, one: async (t, p) => (await client.query(t, p)).rows[0] });
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function migrate() {
  await pool.query(`
  CREATE TABLE IF NOT EXISTS businesses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    timezone text NOT NULL DEFAULT 'Asia/Kolkata',
    mcp_key text UNIQUE NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
    max_days_per_week int, max_hours_per_day numeric, min_rest_hours numeric,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE businesses ADD COLUMN IF NOT EXISTS mcp_last_used_at timestamptz;
  CREATE TABLE IF NOT EXISTS owners (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name text, email text UNIQUE NOT NULL, password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS coverage_requirements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    weekday int NOT NULL, start_time text NOT NULL, end_time text NOT NULL, min_staff int NOT NULL, role text
  );
  CREATE TABLE IF NOT EXISTS staff (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name text NOT NULL, phone text NOT NULL, role text, pin_hash text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (business_id, phone)
  );
  CREATE TABLE IF NOT EXISTS availability (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    weekday int NOT NULL, start_time text NOT NULL, end_time text NOT NULL
  );
  CREATE TABLE IF NOT EXISTS unavailable_dates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    date text NOT NULL, reason text
  );
  CREATE TABLE IF NOT EXISTS pay_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name text NOT NULL, source_text text, priority int NOT NULL DEFAULT 1,
    kind text NOT NULL CHECK (kind IN ('rate','addon','override','manual')),
    conditions jsonb NOT NULL DEFAULT '{}', effect jsonb NOT NULL DEFAULT '{}',
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS shifts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    date text NOT NULL, start_time text NOT NULL, end_time text NOT NULL, role text,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
    notes text, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS shifts_biz_date ON shifts(business_id, date);
  CREATE TABLE IF NOT EXISTS roster_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    week_start text NOT NULL, label text NOT NULL, shifts jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS roster_versions_week ON roster_versions(business_id, week_start, created_at DESC);
  CREATE TABLE IF NOT EXISTS time_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    shift_id uuid UNIQUE REFERENCES shifts(id) ON DELETE CASCADE,
    staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    date text NOT NULL, actual_start text NOT NULL, actual_end text NOT NULL,
    break_minutes int NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    owner_note text, submitted_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz
  );
  CREATE TABLE IF NOT EXISTS swap_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    from_staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    to_staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'pending_colleague',
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS payouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    week_start text NOT NULL, total_amount numeric NOT NULL, breakdown jsonb,
    status text NOT NULL DEFAULT 'paid', paid_at timestamptz DEFAULT now(),
    UNIQUE (business_id, staff_id, week_start)
  );
  CREATE TABLE IF NOT EXISTS manual_adjustments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    week_start text NOT NULL, description text NOT NULL, amount numeric NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  `);
}
