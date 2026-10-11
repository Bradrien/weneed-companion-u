import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { createSyncHandler } from '../_shared/google-sync-runtime.mjs';
import { createGmailProvider } from '../_shared/google-sync-providers.mjs';
Deno.serve(createSyncHandler({ source: 'gmail', createClient, createProvider: createGmailProvider }));
