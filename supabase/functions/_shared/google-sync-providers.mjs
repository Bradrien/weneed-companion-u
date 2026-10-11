import { googleJson, googleFetch, pageItems, queryFor, SyncError } from './google-sync-core.mjs';
import { insertRawEvent } from './google-sync-runtime.mjs';
import { normalizeGmailMessage } from '../gmail-sync/core.mjs';

const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id);
const fileFields = 'id,name,mimeType,modifiedTime,createdTime,webViewLink,owners(emailAddress,displayName),size,md5Checksum,shortcutDetails,trashed';

export async function createGmailProvider({ sb, accessToken }) {
  const profile = await googleJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', accessToken);
  if (typeof profile?.emailAddress !== 'string') throw new SyncError('gmail_profile_missing');
  const selfEmail = profile.emailAddress.toLowerCase();
  return {
    scope: 'gmail:' + selfEmail,
    fetchPage: async window => {
      const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
      url.searchParams.set('maxResults', '25');
      url.searchParams.set('q', queryFor('gmail', window));
      if (window.page_token) url.searchParams.set('pageToken', window.page_token);
      return pageItems(await googleJson(url, accessToken, { pageToken: window.page_token }), 'messages', 'id');
    },
    processItem: async id => {
      if (!validId(id)) throw new SyncError('invalid_google_item_id');
      const msg = await googleJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(id) + '?format=full',
        accessToken, { allowMissing: true });
      if (!msg || msg.labelIds?.includes('TRASH') || msg.labelIds?.includes('SPAM')) return 'skipped';
      if (msg.id !== id) throw new SyncError('invalid_gmail_message');
      let row;
      try { row = normalizeGmailMessage(msg, selfEmail); }
      catch { throw new SyncError('invalid_gmail_message'); }
      return insertRawEvent(sb, row);
    },
  };
}
export async function createChatProvider({ sb, accessToken, state, env }) {
  const space = env('GOOGLE_CHAT_SPACE_NAME') || state?.cursor?.space;
  if (typeof space !== 'string' || !/^spaces\/[A-Za-z0-9_-]+$/.test(space))
    throw new SyncError('google_chat_space_not_configured', 503);
  const cache = new Map();
  return {
    scope: 'google_chat:' + space,
    fetchPage: async window => {
      const url = new URL('https://chat.googleapis.com/v1/' + space + '/messages');
      url.searchParams.set('pageSize', '100');
      url.searchParams.set('orderBy', 'createTime ASC');
      url.searchParams.set('filter', queryFor('google_chat', window));
      if (window.page_token) url.searchParams.set('pageToken', window.page_token);
      const data = await googleJson(url, accessToken, { pageToken: window.page_token });
      const page = pageItems(data, 'messages', 'name');
      for (const m of data.messages || []) cache.set(m.name, m);
      return page;
    },
    processItem: async id => {
      if (!id.startsWith(space + '/messages/') || !/^[A-Za-z0-9_/.=-]+$/.test(id))
        throw new SyncError('invalid_google_item_id');
      const m = cache.get(id) || await googleJson('https://chat.googleapis.com/v1/' + id, accessToken, { allowMissing: true });
      cache.delete(id);
      if (!m || m.deleteTime) return 'skipped';
      if (m.name !== id || !m.sender?.name || !m.createTime) throw new SyncError('invalid_chat_message');
      return insertRawEvent(sb, {
        source: 'google_chat', external_id: m.name, event_type: 'message.created',
        occurred_at: m.createTime, sender_identity: m.sender.name, recipient_identity: null, profile_name: null,
        body: typeof m.text === 'string' ? m.text : null,
        content_type: typeof m.text === 'string' && m.text.length ? 'text' : 'unknown',
        media_count: Array.isArray(m.attachment) ? m.attachment.length : 0,
        raw_payload: m, processing_status: 'received',
      });
    },
  };
}
export function textExportUrl(file) {
  const id = encodeURIComponent(file.id), mime = String(file.mimeType || '');
  if (['application/vnd.google-apps.document', 'application/vnd.google-apps.presentation'].includes(mime))
    return 'https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text%2Fplain';
  if (mime === 'application/vnd.google-apps.spreadsheet')
    return 'https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text%2Fcsv';
  return mime.startsWith('text/') ? 'https://www.googleapis.com/drive/v3/files/' + id + '?alt=media' : null;
}
export async function readBoundedText(response, maxBytes = 1_000_000) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new SyncError('drive_text_too_large', 413);
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  return new TextDecoder().decode(bytes).trim();
}
const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
  .map(x => x.toString(16).padStart(2, '0')).join('');
export async function createDriveProvider({ sb, accessToken }) {
  const about = await googleJson('https://www.googleapis.com/drive/v3/about?fields=user(permissionId)', accessToken);
  const account = about?.user?.permissionId;
  if (typeof account !== 'string' || !account) throw new SyncError('drive_profile_missing');
  const cache = new Map();
  const getFile = id => googleJson('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
    '?fields=' + encodeURIComponent(fileFields), accessToken, { allowMissing: true });
  return {
    scope: 'google_drive:' + account,
    fetchPage: async window => {
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('pageSize', '25');
      url.searchParams.set('orderBy', 'modifiedTime asc');
      url.searchParams.set('q', queryFor('google_drive', window));
      url.searchParams.set('fields', 'nextPageToken,incompleteSearch,files(' + fileFields + ')');
      if (window.page_token) url.searchParams.set('pageToken', window.page_token);
      const data = await googleJson(url, accessToken, { pageToken: window.page_token });
      if (data?.incompleteSearch === true) throw new SyncError('drive_search_incomplete');
      const page = pageItems(data, 'files', 'id');
      for (const file of data.files || []) cache.set(file.id, file);
      return page;
    },
    processItem: async id => {
      if (!validId(id)) throw new SyncError('invalid_google_item_id');
      const file = cache.get(id) || await getFile(id);
      cache.delete(id);
      if (!file || file.trashed) return 'skipped';
      if (file.id !== id || !file.modifiedTime || !file.name) throw new SyncError('invalid_drive_file');
      const exportUrl = textExportUrl(file);
      let text = null, textStatus = exportUrl ? 'extracted' : 'unsupported';
      if (exportUrl) {
        try { text = await readBoundedText(await googleFetch(exportUrl, accessToken)); }
        catch (error) {
          if (!(error instanceof SyncError) || error.code !== 'drive_text_too_large') throw error;
          // Persist a clear metadata-only limitation; a large document must not block later files.
          textStatus = 'too_large';
        }
      }
      if (exportUrl) {
        const checked = await getFile(id);
        if (!checked || checked.trashed) return 'skipped';
        if (checked.modifiedTime !== file.modifiedTime) throw new SyncError('drive_file_changed_during_read', 409);
      }
      const owner = file.owners?.[0], externalId = file.id + ':' + file.modifiedTime;
      const metadata = {
        id: file.id, name: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime,
        createdTime: file.createdTime || null, webViewLink: file.webViewLink || null, owners: file.owners || [],
        size: file.size || null, md5Checksum: file.md5Checksum || null, shortcutDetails: file.shortcutDetails || null,
        text_status: textStatus,
        ...(textStatus === 'too_large' ? { text_error: 'drive_text_too_large', text_limit_bytes: 1_000_000 } : {}),
      };
      const outcome = await insertRawEvent(sb, {
        source: 'google_drive', external_id: externalId, event_type: 'document.updated',
        occurred_at: file.modifiedTime, sender_identity: owner?.emailAddress?.toLowerCase() || null,
        recipient_identity: null, profile_name: owner?.displayName || null, body: text || file.name,
        content_type: file.mimeType || 'document', media_count: 0, raw_payload: metadata, processing_status: 'received',
      });
      const { data: event, error: eventError } = await sb.from('events').select('id')
        .eq('source', 'google_drive').eq('external_id', externalId).maybeSingle();
      if (eventError || !event?.id) throw new SyncError('normalized_event_unavailable', 503);
      const { error: docError } = await sb.from('documents').upsert({
        source: 'google_drive', external_id: id, name: file.name, mime_type: file.mimeType || null,
        modified_at: file.modifiedTime, web_url: file.webViewLink || null, text_content: text,
        content_hash: text !== null ? await digest(text) : null, latest_event_id: event.id,
        raw_payload: metadata, updated_at: new Date().toISOString(),
      }, { onConflict: 'source,external_id' });
      if (docError) throw new SyncError('document_write_failed', 503);
      return textStatus === 'too_large' ? { outcome, limitation: 'drive_text_too_large' } : outcome;
    },
  };
}
