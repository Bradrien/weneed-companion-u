
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function intParam(value: string | null, fallback: number, min: number, max: number) {
  // A missing value means the documented default, not the minimum.
  if (value === null || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function dateParam(value: string | null) {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const keyBag = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const serviceKey = keyBag.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!url || !serviceKey) return json({ ok: false, error: "missing_server_credentials" }, 500);

    const authHeader = req.headers.get("Authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return json({ ok: false, error: "missing_bearer_token" }, 401);

    const jwt = match[1];
    const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: userData, error: userError } = await sb.auth.getUser(jwt);
    const user = userData?.user;
    if (userError || !user?.email || !user.email_confirmed_at) return json({ ok: false, error: "invalid_session" }, 401);

    const email = user.email.toLowerCase();
    const { data: access, error: accessError } = await sb
      .from("app_access_users")
      .select("role,is_active")
      .eq("email", email)
      .maybeSingle();

    if (accessError) throw accessError;
    if (!access?.is_active || access.role !== "owner") return json({ ok: false, error: "not_authorized" }, 403);

    const u = new URL(req.url);
    const parts = u.pathname.split("/").filter(Boolean);
    const slugIndex = parts.lastIndexOf("companion-api");
    const route = slugIndex >= 0 ? parts.slice(slugIndex + 1) : parts;

    if (route.length === 0 || route[0] === "me") {
      return json({
        ok: true,
        user: { email, role: access.role },
        api_version: "companion_read_v3",
      });
    }

    if (route[0] === "dashboard" && route.length === 1) {
      const attentionLimit = intParam(u.searchParams.get("attention_limit"), 20, 1, 100);
      const activityLimit = intParam(u.searchParams.get("activity_limit"), 20, 1, 100);

      const { data, error } = await sb.rpc("api_get_dashboard_snapshot", {
        p_attention_limit: attentionLimit,
        p_activity_limit: activityLimit,
      });
      if (error) throw error;
      return json({ ok: true, data });
    }

    if (route[0] === "commissions" && route.length === 1) {
      const pFrom = dateParam(u.searchParams.get("from"));
      const pTo = dateParam(u.searchParams.get("to"));

      const args: Record<string, string> = {};
      if (pFrom) args.p_from = pFrom;
      if (pTo) args.p_to = pTo;

      const { data, error } = await sb.rpc("api_get_commission_summary", args);
      if (error) throw error;
      return json({ ok: true, data });
    }

    if (route[0] === "identity-reviews" && route.length === 1) {
      const limit = intParam(u.searchParams.get("limit"), 30, 1, 100);
      const status = u.searchParams.get("status") || "pending";

      const { data, error } = await sb
        .from("identity_resolution_reviews")
        .select("id,status,reason,candidates,created_at,updated_at,identity:identities(id,identity_type,normalized_value,display_name,source,client_id,contact_id,is_verified,confidence)")
        .eq("status", status)
        .order("updated_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return json({ ok: true, data: data ?? [] });
    }

    if (route[0] === "clients" && route.length === 1) {
      const q = (u.searchParams.get("q") ?? "").trim().slice(0, 120);
      const limit = intParam(u.searchParams.get("limit"), 20, 1, 100);

      const { data, error } = await sb.rpc("api_search_client_360", {
        p_query: q,
        p_limit: limit,
      });
      if (error) throw error;
      return json({ ok: true, data: data ?? [] });
    }

    if (route[0] === "clients" && route.length === 3 && route[2] === "card") {
      const clientId = route[1];
      if (!UUID_RE.test(clientId)) return json({ ok: false, error: "invalid_client_id" }, 400);

      const { data, error } = await sb.rpc("api_get_client_card", {
        p_client_id: clientId,
      });
      if (error) throw error;
      if (!data) return json({ ok: false, error: "client_not_found" }, 404);

      return json({ ok: true, data });
    }

    if (route[0] === "clients" && route.length === 2) {
      const clientId = route[1];
      if (!UUID_RE.test(clientId)) return json({ ok: false, error: "invalid_client_id" }, 400);

      const eventLimit = intParam(u.searchParams.get("event_limit"), 25, 1, 100);
      const conversationLimit = intParam(u.searchParams.get("conversation_limit"), 10, 1, 50);

      const { data, error } = await sb.rpc("api_get_client_360", {
        p_client_id: clientId,
        p_event_limit: eventLimit,
        p_conversation_limit: conversationLimit,
      });
      if (error) throw error;
      if (!data) return json({ ok: false, error: "client_not_found" }, 404);

      return json({ ok: true, data });
    }

    return json({ ok: false, error: "not_found" }, 404);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(message);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
