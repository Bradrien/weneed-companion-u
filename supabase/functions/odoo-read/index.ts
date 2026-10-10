/** Supabase Edge Function: owner-only, read-only Odoo gateway. */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createHandler } from './core.mjs';

const keysRaw = Deno.env.get('SUPABASE_SECRET_KEYS') || '{}';
let keys: Record<string, string> = {};
try { keys = JSON.parse(keysRaw); } catch { /* missing credentials => fail closed */ }
const url = Deno.env.get('SUPABASE_URL');
const key = keys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const client = url && key ? createClient(url, key,
  { auth: { autoRefreshToken: false, persistSession: false } }) : null;

const env = {
  ODOO_URL: Deno.env.get('ODOO_URL') || '',
  ODOO_DB: Deno.env.get('ODOO_DB') || '',
  ODOO_USERNAME: Deno.env.get('ODOO_USERNAME') || '',
  ODOO_API_KEY: Deno.env.get('ODOO_API_KEY') || '',
  ODOO_UID_PIN: Deno.env.get('ODOO_UID_PIN') || '',
  ODOO_ALLOWED_ORIGIN: Deno.env.get('ODOO_ALLOWED_ORIGIN') || '',
};

const handle = createHandler({ env, authenticateCaller: async (jwt: string) => {
  if (!client) return false;
  const { data: auth, error: authError } = await client.auth.getUser(jwt);
  if (authError || !auth?.user?.email || !auth.user.email_confirmed_at) return false;
  const { data: access, error } = await client.from('app_access_users')
    .select('role,is_active').eq('email', auth.user.email.toLowerCase()).maybeSingle();
  return !error && access?.is_active === true && access?.role === 'owner';
} });

Deno.serve(handle);
