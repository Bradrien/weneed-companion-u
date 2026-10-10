-- Verified WhatsApp client brief RPCs. Invoker-security and EXECUTE restricted to service_role.
-- Only approved message texts attached to verified archive conversations; no private messages in repository.

CREATE OR REPLACE FUNCTION public.api_whatsapp_brief_overview(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH approved_threads AS (
 SELECT ac.client_id,ac.chat_pk,ac.batch_id
 FROM public.whatsapp_archive_conversations ac
 JOIN public.whatsapp_import_batches b ON b.id=ac.batch_id
 JOIN public.whatsapp_import_sources src ON src.source_key=b.source_key AND src.import_approved=TRUE
 WHERE ac.link_state='verified' AND ac.client_id IS NOT NULL
), approved_texts AS (
 SELECT t.client_id,s.chat_pk,s.local_message_pk,s.occurred_at,s.is_outbound,s.text_body
 FROM approved_threads t JOIN public.whatsapp_import_staging s ON s.batch_id=t.batch_id AND s.chat_pk=t.chat_pk
 WHERE s.review_status='approved' AND NULLIF(BTRIM(s.text_body),'') IS NOT NULL
), grouped AS (
 SELECT client_id,COUNT(*)::int text_count,COUNT(DISTINCT chat_pk)::int conversation_count,
 COUNT(*) FILTER(WHERE is_outbound)::int outgoing_count,
 MAX(occurred_at) last_at,MIN(occurred_at) first_at
 FROM approved_texts GROUP BY client_id
), latest AS (
 SELECT DISTINCT ON(client_id) client_id,chat_pk,local_message_pk,occurred_at,is_outbound,
 LEFT(REGEXP_REPLACE(BTRIM(text_body),'[[:space:]]+',' ','g'),220) AS excerpt
 FROM approved_texts
 ORDER BY client_id,occurred_at DESC,local_message_pk DESC
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
 'client_id',g.client_id,'client_name',cl.canonical_name,'text_count',g.text_count,
 'conversation_count',g.conversation_count,'incoming_count',g.text_count-g.outgoing_count,
 'outgoing_count',g.outgoing_count,'first_at',g.first_at,'last_at',g.last_at,
 'last_message',jsonb_build_object('chat_pk',l.chat_pk,'message_pk',l.local_message_pk,
  'at',l.occurred_at,'direction',CASE WHEN l.is_outbound THEN 'outgoing' ELSE 'incoming' END,
  'excerpt',l.excerpt)
 ) ORDER BY g.last_at DESC),'[]'::jsonb)
FROM (SELECT * FROM grouped ORDER BY last_at DESC LIMIT GREATEST(1,LEAST(COALESCE(p_limit,100),150))) g
JOIN latest l ON l.client_id=g.client_id JOIN public.clients cl ON cl.id=g.client_id;
$function$;

CREATE OR REPLACE FUNCTION public.api_whatsapp_client_brief(p_client_id uuid, p_recent_limit integer DEFAULT 12, p_highlight_limit integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH authorized_threads AS (
 SELECT ac.batch_id, ac.chat_pk
 FROM public.whatsapp_archive_conversations ac
 JOIN public.whatsapp_import_batches b ON b.id=ac.batch_id
 JOIN public.whatsapp_import_sources src ON src.source_key=b.source_key AND src.import_approved=TRUE
 WHERE ac.client_id=p_client_id AND ac.link_state='verified'
), messages AS (
 SELECT s.chat_pk,s.local_message_pk,s.stanza_id,s.occurred_at,s.is_outbound,
  LEFT(REGEXP_REPLACE(BTRIM(s.text_body),'[[:space:]]+',' ','g'),750) AS excerpt,
  CHAR_LENGTH(BTRIM(s.text_body)) AS chars
 FROM public.whatsapp_import_staging s
 JOIN authorized_threads t ON t.batch_id=s.batch_id AND t.chat_pk=s.chat_pk
 WHERE s.review_status='approved' AND NULLIF(BTRIM(s.text_body),'') IS NOT NULL
), categorized AS (
 SELECT m.*,
  CASE
   WHEN m.excerpt ~* '(rembours|avoir[[:space:]]|litige|plainte|ab[îi]m[ée]|d[ée]fect|r[ée]clam|insatisf|probl[èe]me)' THEN 'retour_ou_probleme'
   WHEN m.excerpt ~* '(virement|paiement|payer|pay[ée]|r[èe]gl|factur|comptable|reste [àa] payer)' THEN 'paiement_ou_facture'
   WHEN m.excerpt ~* '(devis|commande|command[ée]|kg|gramme|prix|tarif|remise|[0-9][.,]?[0-9]*[[:space:]]?€)' THEN 'commande_ou_prix'
   WHEN m.excerpt ~* '(tracking|chronopost|colis|livrai|exp[ée]di|envoi|transporteur|livreur)' THEN 'expedition_ou_livraison'
   WHEN m.excerpt ~* '(stock|disponib|[ée]chantillon|[ée]chant|test|int[ée]ress|vari[ée]t[ée]|produit)' THEN 'produit_ou_opportunite'
   ELSE NULL
  END AS category
 FROM messages m
), recent AS (
 SELECT c.*,ROW_NUMBER() OVER(ORDER BY c.occurred_at DESC,c.local_message_pk DESC) AS rn
 FROM categorized c
), highlights AS (
 SELECT c.*,ROW_NUMBER() OVER(PARTITION BY c.category ORDER BY c.occurred_at DESC,c.local_message_pk DESC) AS per_cat_rank
 FROM categorized c WHERE c.category IS NOT NULL AND c.chars>=18
), highlights_ranked AS (
 SELECT h.*, ROW_NUMBER() OVER (ORDER BY h.occurred_at DESC,h.local_message_pk DESC) AS rn
 FROM highlights h WHERE h.per_cat_rank<=3
), coverage AS (
 SELECT COUNT(*)::int message_count, COUNT(DISTINCT chat_pk)::int conversation_count,
 COUNT(*) FILTER(WHERE is_outbound)::int outgoing_count,
 COUNT(*) FILTER(WHERE NOT is_outbound)::int incoming_count,
 MIN(occurred_at) first_at,MAX(occurred_at) last_at
 FROM messages
)
SELECT jsonb_build_object(
 'client_id',p_client_id,
 'status', CASE WHEN (SELECT COUNT(*) FROM authorized_threads)=0 THEN 'no_verified_archive' WHEN (SELECT message_count FROM coverage)=0 THEN 'no_approved_text' ELSE 'available' END,
 'method','deterministic_keywords_v1_not_ai_summary',
 'scope','verified_clients_and_approved_text_only',
 'coverage',(SELECT to_jsonb(coverage) FROM coverage),
 'recent',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'chat_pk',chat_pk,'message_pk',local_message_pk,'stanza_id',stanza_id,
   'at',occurred_at,'direction',CASE WHEN is_outbound THEN 'outgoing' ELSE 'incoming' END,
   'excerpt',excerpt,'category',category) ORDER BY occurred_at DESC,local_message_pk DESC)
  FROM recent WHERE rn<=GREATEST(1,LEAST(COALESCE(p_recent_limit,12),25))),'[]'::jsonb),
 'highlights',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'chat_pk',chat_pk,'message_pk',local_message_pk,'stanza_id',stanza_id,
   'at',occurred_at,'direction',CASE WHEN is_outbound THEN 'outgoing' ELSE 'incoming' END,
   'excerpt',excerpt,'category',category) ORDER BY occurred_at DESC,local_message_pk DESC)
  FROM highlights_ranked WHERE rn<=GREATEST(1,LEAST(COALESCE(p_highlight_limit,12),18))),'[]'::jsonb)
);
$function$;

REVOKE ALL ON FUNCTION public.api_whatsapp_client_brief(uuid,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_whatsapp_brief_overview(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_whatsapp_client_brief(uuid,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_whatsapp_brief_overview(integer) TO service_role;
