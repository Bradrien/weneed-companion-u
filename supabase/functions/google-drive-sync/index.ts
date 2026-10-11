import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { createSyncHandler } from '../_shared/google-sync-runtime.mjs';
import { createDriveProvider } from '../_shared/google-sync-providers.mjs';
Deno.serve(createSyncHandler({ source: 'google_drive', createClient, createProvider: createDriveProvider }));
