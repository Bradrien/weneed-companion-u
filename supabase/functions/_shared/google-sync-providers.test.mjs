import test from 'node:test';
import assert from 'node:assert/strict';
import { createGmailProvider, createChatProvider, createDriveProvider, readBoundedText, textExportUrl } from './google-sync-providers.mjs';
import { normalizeGmailMessage } from '../gmail-sync/core.mjs';
import { initializeCursor, runWindow } from './google-sync-core.mjs';

function fakeDb() {
  const raw = new Map(), docs = new Map();
  const db = { raw, docs, failDocument: false };
  db.from = table => {
    if (table === 'raw_events') return { upsert: row => ({ select: async () => {
      const key = row.source + ':' + row.external_id;
      const exists = raw.has(key);
      if (!exists) raw.set(key,row);
      return { data: exists ? [] : [{ id: key }], error: null };
    } }) };
    if (table === 'documents') return { upsert: async row => {
      if (db.failDocument) { db.failDocument = false; return { error: { message: 'synthetic failure' } }; }
      docs.set(row.external_id,row); return { error: null };
    } };
    if (table === 'events') {
      const filters = {};
      const q = { select: () => q, eq: (key,value) => {filters[key]=value;return q;},
        maybeSingle: async () => ({ data: raw.has(filters.source + ':' + filters.external_id) ? { id: 'synthetic-event' } : null, error: null }) };
      return q;
    }
    throw Error('unexpected table ' + table);
  };
  return db;
}
const json = (value,status=200) => new Response(JSON.stringify(value),{status});
const window = { since:'2026-10-11T07:00:00Z',until:'2026-10-11T08:00:00Z',page_token:'page-two' };
const gmailMessage = (id='message1') => ({
  id,internalDate:String(Date.parse('2026-10-11T07:10:00Z')),labelIds:['SENT'],threadId:'thread1',
  payload:{mimeType:'text/plain',headers:[{name:'From',value:'Owner <owner@example.test>'},
    {name:'To',value:'Owner <owner@example.test>, Customer <customer@example.test>'}],
    body:{data:Buffer.from('Bonjour, voici le suivi.').toString('base64url')}},
});
const driveFile = (mime='application/pdf') => ({
  id:'file1',name:'Synthetic fixture',mimeType:mime,modifiedTime:'2026-10-11T07:10:00Z',
});
function mockDriveFetch(t, implementation) {
  t.mock.method(globalThis,'fetch',async input => new URL(input).pathname.endsWith('/about')
    ? json({ user: { permissionId: 'synthetic-account' } }) : implementation(input));
}
test('Gmail profile determines sender identity without a hardcoded private address', async t => {
  const db=fakeDb(), urls=[];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input);urls.push(url);
    if(url.pathname.endsWith('/profile'))return json({emailAddress:'owner@example.test'});
    if(url.pathname.endsWith('/messages'))return json({messages:[{id:'message1'}],nextPageToken:'page-three'});
    return json(gmailMessage());
  });
  const provider=await createGmailProvider({sb:db,accessToken:'synthetic-token'});
  assert.equal(provider.scope,'gmail:owner@example.test');
  assert.deepEqual(await provider.fetchPage(window),{items:['message1'],nextPageToken:'page-three'});
  const list=urls.find(url=>url.pathname.endsWith('/messages'));
  assert.equal(list.searchParams.get('pageToken'),'page-two');
  assert.equal(list.searchParams.get('maxResults'),'25');
  assert.match(list.searchParams.get('q'),/ before:/);
  assert.equal(await provider.processItem('message1'),'inserted');
  assert.equal(await provider.processItem('message1'),'duplicate');
  assert.equal(db.raw.get('gmail:message1').recipient_identity,'customer@example.test');
});
test('Gmail decodes MIME attachments/Unicode and preserves outbound recipient mapping', () => {
  const message=gmailMessage();
  message.payload={...message.payload,mimeType:'multipart/mixed',body:{},parts:[
    {mimeType:'text/plain',body:{data:Buffer.from('Déjà reçu ✓').toString('base64url')}},
    {mimeType:'application/pdf',filename:'example.pdf',body:{size:12,attachmentId:'fixture-attachment'}}]};
  const event=normalizeGmailMessage(message,'owner@example.test');
  assert.equal(event.body,'Déjà reçu ✓');
  assert.equal(event.media_count,1);
  assert.equal(event.event_type,'email.sent');
});
test('Gmail acknowledges a resource deleted between listing and get, without writing an empty event', async t => {
  const db=fakeDb();
  t.mock.method(globalThis,'fetch',async input=>String(input).endsWith('/profile')
    ?json({emailAddress:'owner@example.test'}):json({},404));
  const provider=await createGmailProvider({sb:db,accessToken:'synthetic-token'});
  assert.equal(await provider.processItem('message1'),'skipped');
  assert.equal(db.raw.size,0);
});
test('Chat uses existing private space configuration and fetches a durable ID after restart', async t => {
  const db=fakeDb(),urls=[];
  t.mock.method(globalThis,'fetch',async input=>{
    const url=new URL(input);urls.push(url);
    if(url.pathname.endsWith('/messages'))return json({messages:[{
      name:'spaces/EXAMPLE/messages/one',sender:{name:'users/synthetic'},createTime:'2026-10-11T07:10:00Z',text:'Synthetic message'}],
      nextPageToken:'page-three'});
    return json({name:'spaces/EXAMPLE/messages/two',sender:{name:'users/synthetic'},createTime:'2026-10-11T07:11:00Z',text:'Synthetic resumed message'});
  });
  const provider=await createChatProvider({sb:db,accessToken:'synthetic-token',state:{cursor:{space:'spaces/EXAMPLE'}},env:()=>undefined});
  assert.deepEqual(await provider.fetchPage(window),{items:['spaces/EXAMPLE/messages/one'],nextPageToken:'page-three'});
  assert.equal(urls[0].searchParams.get('filter'),'createTime > "2026-10-11T07:00:00.000Z" AND createTime < "2026-10-11T08:00:00.000Z"');
  assert.equal(urls[0].searchParams.get('pageToken'),'page-two');
  assert.equal(await provider.processItem('spaces/EXAMPLE/messages/two'),'inserted');
  assert.equal(db.raw.size,1);
});
test('Chat refuses a changed/absent space and an ID pointing outside its configured space', async () => {
  await assert.rejects(createChatProvider({sb:fakeDb(),accessToken:'synthetic-token',state:{},env:()=>undefined}),/space_not_configured/);
  const provider=await createChatProvider({sb:fakeDb(),accessToken:'synthetic-token',state:{cursor:{space:'spaces/EXAMPLE'}},env:()=>undefined});
  await assert.rejects(provider.processItem('spaces/OTHER/messages/one'),/invalid_google_item_id/);
});
test('Drive follows nextPageToken without treating a fourth page as complete', async t => {
  mockDriveFetch(t,async input=>{
    const url=new URL(input);
    assert.equal(url.searchParams.get('pageToken'),'page-two');
    assert.equal(url.searchParams.get('pageSize'),'25');
    assert.match(url.searchParams.get('q'),/modifiedTime < /);
    return json({files:[driveFile()],nextPageToken:'page-three'});
  });
  const provider=await createDriveProvider({sb:fakeDb(),accessToken:'synthetic-token'});
  assert.deepEqual(await provider.fetchPage(window),{items:['file1'],nextPageToken:'page-three'});
});
test('Drive incompleteSearch is an error that prevents advancing freshness', async t => {
  mockDriveFetch(t,async()=>json({files:[],incompleteSearch:true}));
  const provider=await createDriveProvider({sb:fakeDb(),accessToken:'synthetic-token'});
  await assert.rejects(provider.fetchPage(window),/drive_search_incomplete/);
});
test('Drive export failure does not overwrite existing text with null', async t => {
  const db=fakeDb();db.docs.set('file1',{text_content:'Previously captured synthetic text'});
  mockDriveFetch(t,async input=>new URL(input).pathname.endsWith('/files')
    ?json({files:[driveFile('application/vnd.google-apps.document')]}):json({},403));
  const provider=await createDriveProvider({sb:db,accessToken:'synthetic-token'});
  await provider.fetchPage({...window,page_token:null});
  await assert.rejects(provider.processItem('file1'),/google_http_403/);
  assert.equal(db.docs.get('file1').text_content,'Previously captured synthetic text');
  assert.equal(db.raw.size,0);
});
test('Drive retries document persistence after event insertion without duplicating the event', async t => {
  const db=fakeDb();db.failDocument=true;
  mockDriveFetch(t,async input=>new URL(input).pathname.endsWith('/files')
    ?json({files:[driveFile()]}):json(driveFile()));
  const provider=await createDriveProvider({sb:db,accessToken:'synthetic-token'});
  await provider.fetchPage({...window,page_token:null});
  await assert.rejects(provider.processItem('file1'),/document_write_failed/);
  assert.equal(db.raw.size,1);
  assert.equal(await provider.processItem('file1'),'duplicate');
  assert.equal(db.raw.size,1);assert.equal(db.docs.size,1);
  assert.equal(db.docs.get('file1').raw_payload.text_status,'unsupported');
  assert.equal(db.docs.get('file1').text_content,null);
});
test('Drive refuses a text export whose source modifiedTime changed during the read', async t => {
  const db=fakeDb();
  mockDriveFetch(t,async input=>{
    const url=new URL(input);
    if(url.pathname.endsWith('/files'))return json({files:[driveFile('text/plain')]});
    if(url.searchParams.get('alt')==='media')return new Response('Synthetic text');
    return json({...driveFile('text/plain'),modifiedTime:'2026-10-11T07:12:00Z'});
  });
  const provider=await createDriveProvider({sb:db,accessToken:'synthetic-token'});
  await provider.fetchPage({...window,page_token:null});
  await assert.rejects(provider.processItem('file1'),/drive_file_changed_during_read/);
  assert.equal(db.raw.size,0);assert.equal(db.docs.size,0);
});
test('unsupported PDF is indexed as metadata and bounded exports reject oversized data', async () => {
  assert.equal(textExportUrl(driveFile()),null);
  await assert.rejects(readBoundedText(new Response('Too much text'),4),/drive_text_too_large/);
  assert.equal(await readBoundedText(new Response(' ✓ '),20),'✓');
});

test('Drive binds cursors to the OAuth account and refuses silently switching accounts', async t => {
  mockDriveFetch(t,()=>json({}));
  const provider=await createDriveProvider({sb:fakeDb(),accessToken:'synthetic-token'});
  assert.equal(provider.scope,'google_drive:synthetic-account');
  const state={cursor:{sync_version:2,scope:'google_drive:another-account',window:null}};
  assert.throws(()=>initializeCursor(state,'2026-10-11T08:00:00Z',provider.scope),/connector_scope_changed/);
});
test('Drive oversized text persists an explicit limitation and lets the next item finish', async t => {
  const db=fakeDb();
  mockDriveFetch(t,async input => {
    const url=new URL(input);
    if(url.pathname.endsWith('/files'))return json({files:[driveFile('text/plain'),{...driveFile(),id:'file2'}]});
    if(url.searchParams.get('alt')==='media')return new Response('x'.repeat(1_000_001));
    return json(driveFile('text/plain'));
  });
  const provider=await createDriveProvider({sb:db,accessToken:'synthetic-token'});
  const cursor=initializeCursor({},'2026-10-11T08:00:00Z',provider.scope);
  const result=await runWindow({cursor,fetchPage:provider.fetchPage,processItem:provider.processItem,checkpoint:async()=>{}});
  assert.equal(result.complete,true);assert.equal(result.metrics.limited,1);
  assert.equal(result.metrics.inserted,2);assert.equal(result.metrics.failed,0);
  const doc=db.docs.get('file1');
  assert.equal(doc.text_content,null);
  assert.equal(doc.content_hash,null);
  assert.equal(doc.raw_payload.text_status,'too_large');
  assert.equal(doc.raw_payload.text_error,'drive_text_too_large');
  assert.equal(db.docs.get('file2').raw_payload.text_status,'unsupported');
});
