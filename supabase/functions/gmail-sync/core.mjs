function decodeBase64Url(data) {
  if (!data) return "";
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function htmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function walkParts(part, acc) {
  if (!part) return;
  const mime = String(part.mimeType || "").toLowerCase();
  const filename = String(part.filename || "");
  const body = part.body || {};

  if (filename) {
    acc.attachments.push({
      filename,
      mime_type: part.mimeType || null,
      size_bytes: body.size ?? null,
      attachment_id: body.attachmentId ?? null,
    });
  } else if (mime === "text/plain" && body.data) {
    acc.plain.push(decodeBase64Url(body.data));
  } else if (mime === "text/html" && body.data) {
    acc.html.push(decodeBase64Url(body.data));
  }

  for (const child of (part.parts || [])) walkParts(child, acc);
}

function extractMessageBody(payload) {
  const acc = { plain: [], html: [], attachments: [] };
  walkParts(payload, acc);

  if (!acc.plain.length && payload?.body?.data && payload?.mimeType === "text/plain") {
    acc.plain.push(decodeBase64Url(payload.body.data));
  }
  if (!acc.html.length && payload?.body?.data && payload?.mimeType === "text/html") {
    acc.html.push(decodeBase64Url(payload.body.data));
  }

  const text = acc.plain.join("\n\n").trim() || htmlToText(acc.html.join("\n\n"));
  return { text, attachments: acc.attachments };
}

function headersMap(payload) {
  const out = {};
  for (const h of (payload?.headers || [])) {
    if (h?.name) out[String(h.name).toLowerCase()] = String(h.value || "");
  }
  return out;
}

function extractEmails(value) {
  const s = String(value || "");
  const matches = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(matches.map((x) => x.toLowerCase()))];
}

function extractEmail(value) {
  return extractEmails(value)[0] || null;
}

function extractDisplayName(value) {
  const s = String(value || "").trim();
  const m = s.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>/);
  return m ? m[1].trim() : null;
}

export function normalizeGmailMessage(msg, selfEmail) {
  if (!msg?.id || !msg?.payload) throw new Error('invalid_gmail_message');
  const h = headersMap(msg.payload), fromRaw = h.from || '', toRaw = h.to || '';
  const senderEmail = extractEmail(fromRaw), senderName = extractDisplayName(fromRaw);
  const { text, attachments } = extractMessageBody(msg.payload);
  const labels = Array.isArray(msg.labelIds) ? msg.labelIds : [];
  const outbound = labels.includes('SENT') || senderEmail === selfEmail.toLowerCase();
  const toEmails = extractEmails(toRaw);
  const recipientEmail = outbound ? (toEmails.find(email => email !== selfEmail.toLowerCase()) || toEmails[0] || null) : (toEmails[0] || null);
  const occurredAt = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null;
  return {
    source: 'gmail', external_id: msg.id, event_type: outbound ? 'email.sent' : 'email.received',
    occurred_at: occurredAt, sender_identity: senderEmail, recipient_identity: recipientEmail,
    profile_name: senderName, body: text || msg.snippet || null, content_type: 'email',
    media_count: attachments.length, processing_status: 'received',
    raw_payload: {
      id: msg.id, threadId: msg.threadId, labelIds: labels, snippet: msg.snippet || null,
      internalDate: msg.internalDate || null, sizeEstimate: msg.sizeEstimate || null,
      historyId: msg.historyId || null, headers: msg.payload.headers || [],
      mimeType: msg.payload.mimeType || null, attachments, recipientEmails: toEmails,
    },
  };
}
