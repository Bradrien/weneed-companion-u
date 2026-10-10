-- Source migration recorded by Supabase as 20261010225142.
-- Manual provisional quotes, never used for payable Odoo/Kino commission balances.
ALTER TABLE public.commission_quotes
  ALTER COLUMN commission_amount DROP NOT NULL,
  ALTER COLUMN commission_amount DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS expected_decision_at date;
ALTER TABLE public.commission_quotes DROP CONSTRAINT IF EXISTS commission_quotes_status_check;
ALTER TABLE public.commission_quotes
  ADD CONSTRAINT commission_quotes_status_check CHECK (status IN ('en_cours','valide','facture','annule'));
ALTER TABLE public.commission_quotes
  ADD CONSTRAINT commission_quotes_manual_amount_check CHECK (amount_ht IS NULL OR amount_ht >= 0);
ALTER TABLE public.commission_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commission_quotes FROM anon,authenticated;
CREATE INDEX IF NOT EXISTS commission_quotes_stage_date_idx ON public.commission_quotes(status,quote_date DESC);
COMMENT ON TABLE public.commission_quotes IS 'Manually tracked sales quotes and provisional commissions. No automatic proof of invoicing, payment or payable commissions.';
