import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGIN = "https://bradrien.github.io";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function headers(request: Request) {
  const origin = request.headers.get("Origin");
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    ...(origin === ORIGIN ? {"Access-Control-Allow-Origin": ORIGIN} : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}
function answer(request: Request, value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {status, headers: headers(request)});
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (origin && origin !== ORIGIN) return answer(request, {ok:false,error:"origin_not_allowed"},403);
  if (request.method === "OPTIONS") return new Response(null, {status:204,headers:headers(request)});
  if (request.method !== "GET") return answer(request, {ok:false,error:"method_not_allowed"},405);
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return answer(request,{ok:false,error:"missing_bearer_token"},401);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const service = keys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !service) return answer(request,{ok:false,error:"not_configured"},503);
    const sb = createClient(url, service, {auth:{persistSession:false}});
    const {data:userData,error:userError} = await sb.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user?.email || !user.email_confirmed_at) {
      return answer(request,{ok:false,error:"invalid_session"},401);
    }
    const {data:access,error:accessError} = await sb.from("app_access_users")
      .select("role,is_active").eq("email",user.email.toLowerCase()).maybeSingle();
    if (accessError) throw accessError;
    if (!access?.is_active || access.role !== "owner") {
      return answer(request,{ok:false,error:"not_authorized"},403);
    }

    const query = new URL(request.url).searchParams;
    const mode = query.get("mode") ?? "client";
    if (mode === "overview") {
      const {data,error} = await sb.rpc("api_whatsapp_brief_overview",{p_limit:100});
      if (error) throw error;
      return answer(request,{ok:true,data,method:"deterministic_keywords_v1_not_ai_summary"});
    }
    if (mode !== "client") return answer(request,{ok:false,error:"invalid_mode"},400);
    const clientId = query.get("client_id") || "";
    if (!UUID.test(clientId)) return answer(request,{ok:false,error:"invalid_client_id"},400);
    const {data,error} = await sb.rpc("api_whatsapp_client_brief",
      {p_client_id:clientId,p_recent_limit:12,p_highlight_limit:12});
    if (error) throw error;
    return answer(request,{ok:true,data});
  } catch (_error) {
    return answer(request,{ok:false,error:"whatsapp_brief_unavailable"},503);
  }
});
