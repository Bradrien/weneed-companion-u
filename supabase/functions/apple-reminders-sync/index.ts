import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { BridgeInputError, parseBridgeRequest, readBridgeBody } from "./core.mjs";

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  const token = req.headers.get("x-device-token");
  if (!token || token.length < 32 || token.length > 512) {
    return Response.json({ ok: false, error: "invalid_device_token" }, { status: 401 });
  }
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const key = keys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const url = Deno.env.get("SUPABASE_URL");
    if (!key || !url) return Response.json({ ok: false, error: "server_configuration_error" }, { status: 500 });
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data: device, error: deviceError } = await sb.from("sync_trigger_tokens")
      .select("id").eq("token_hash", await sha256Hex(token)).eq("purpose", "apple_reminders_bridge")
      .is("used_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (deviceError) throw new Error("device_validation_failed");
    if (!device) return Response.json({ ok: false, error: "invalid_device_token" }, { status: 401 });

    const body = parseBridgeRequest(await readBridgeBody(req));
    const { data, error } = await sb.rpc("apple_reminder_bridge_exchange", {
      p_acknowledgements: body.acknowledgements, p_local_states: body.local_states,
    });
    if (error || !data?.ok) throw new Error("bridge_exchange_failed");
    return Response.json(data);
  } catch (error) {
    if (error instanceof BridgeInputError) {
      return Response.json({ ok: false, error: error.code }, { status: error.code === "bridge_request_too_large" ? 413 : 400 });
    }
    // Never echo raw database or device errors (which may contain commercial data).
    console.error("apple_reminder_bridge_exchange_failed");
    return Response.json({ ok: false, error: "bridge_exchange_failed" }, { status: 500 });
  }
});
