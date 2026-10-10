import test from 'node:test';
import assert from 'node:assert/strict';
import {auditReconciliation,candidateSkuFromName,groupMissingSkuCandidates} from '../assets/reconciliation.mjs';

const m=status=>({status});
const make=(state,company,amount,lines,reference)=>({
 id:reference,reference,state,company,amount_ht:amount,currency:'EUR',date:'2026-09-17',
 client:'Client de test',lines
});
const line=(id,kind,status,amount,name)=>({
 id,kind,catalog_match:m(status),line_ht:amount,product_name:name
});
const report={orders:[
 make('sale','GTA',0,[
  line(1,'review','missing_sku',20,'Produit sans SKU'),
  line(2,'sample','not_applicable',10,'Sample facturé'),
  line(3,'sample','not_applicable',0,'Sample offert'),
  line(4,'shipping','not_applicable',12,'Livraison')
 ],'SO-TEST-1'),
 make('done','TR',100,[
  line(5,'candidate','matched',80,'Fleur TR'),
  line(6,'review','missing_sku',20,'Deuxième SKU absent')
 ],'SO-TEST-2'),
 make('cancel','GTA',250,[
  line(7,'sample','not_applicable',200,'Échantillon de commande annulée'),
  line(8,'shipping','not_applicable',50,'Port annulé')
 ],'SO-TEST-3')
]};

test('SKU audit keeps confirmed eligible missing lines by order, not unique products',()=>{
 const a=auditReconciliation(report);
 assert.equal(a.missing.length,2);
 assert.deepEqual(a.missing.map(x=>x.order.reference),['SO-TEST-1','SO-TEST-2']);
 assert.equal(a.zeroAmountOrders.length,1);
 assert.equal(a.zeroAmountOrders[0].reference,'SO-TEST-1');
});

test('sample audit separates all statuses, confirmed orders and positive HT lines',()=>{
 const a=auditReconciliation(report);
 assert.equal(a.samples.length,3);
 assert.equal(a.confirmedSamples.length,2);
 assert.equal(a.paidSamples.length,1);
 assert.equal(a.paidSamples[0].line.product_name,'Sample facturé');
 assert.equal(a.shipping.length,2);
 assert.equal(a.confirmedShipping.length,1);
 assert.equal(a.paidShipping.length,1);
});

test('null input yields no audit and empty report preserves zeros',()=>{
 assert.equal(auditReconciliation(null),null);
 const a=auditReconciliation({orders:[]});
 assert.equal(a.missing.length,0);
 assert.equal(a.samples.length,0);
 assert.equal(a.zeroAmountOrders.length,0);
});

test('non-confirmed missing SKU entries cannot masquerade as eligible matches',()=>{
 const r={orders:[
  make('cancel','TR',0,[line(10,'sample','not_applicable',0,'Annulé')],'SO-CANCEL')
 ]};
 assert.equal(auditReconciliation(r).missing.length,0);
});

test('extract proposed SKU only from a bracketed prefix, without guessing Kino identity',()=>{
 assert.equal(candidateSkuFromName('[PEB/G/TR/250] Peanut Butter 250'), 'PEB/G/TR/250');
 assert.equal(candidateSkuFromName(' [TT/+/G/TR/50] Tangie Tonic'), 'TT/+/G/TR/50');
 assert.equal(candidateSkuFromName('[TT/G] Tangie Tonic'), 'TT/G');
 assert.equal(candidateSkuFromName('Branded sealed bag [TT/G]'),null);
 assert.equal(candidateSkuFromName('No SKU'),null);
 assert.equal(candidateSkuFromName('[<script>] unsafe'),null);
});
test('six missing order lines collapse to four company-scoped SKU candidates',()=>{
 const missing=(i,code,amount)=>({
  id:i,kind:'review',line_ht:amount,commission_eur:null,
  catalog_match:{status:'missing_sku'},product_name:'['+code+'] Fictional test compliance text'
 });
 const orders=[
  make('sale','TR',400,[missing(1,'PEB/G/TR/250',300),missing(2,'TT/+/G/TR/50',100)],'T01836'),
  make('sale','TR',600,[missing(3,'TT/+/G/TR/250',600)],'T01852'),
  make('sale','TR',550,[missing(4,'PEB/G/TR/250',550)],'T01910'),
  make('sale','GTA',150,[missing(5,'TT/G',150)],'S03502'),
  make('sale','GTA',1300,[missing(6,'TT/G',1300)],'S03515')
 ];
 const groups=groupMissingSkuCandidates({orders});
 assert.equal(groups.length,4);
 assert.equal(groups.reduce((a,g)=>a+g.count,0),6);
 assert.equal(groups.reduce((a,g)=>a+g.total,0),3000);
 assert.equal(groups.find(g=>g.candidate==='TT/G').total,1450);
 assert.equal(groups.find(g=>g.candidate==='PEB/G/TR/250').count,2);
 assert.equal(groups.some(g=>g.currency!=='EUR'),false);
});

test('catalogue suggestions count only validated exact candidate metadata, not missing-SKU matches',()=>{
 const o=make('sale','GTA',80,[{id:42,kind:'review',line_ht:80,
   product_name:'[TT/G] Fictitious product',catalog_match:{
     status:'missing_sku',candidate:{sku:'TT/G',status:'found',catalog_name:'Fictitious Kino match',tier:'A',category:'GR'}
   }}],'SO-FAKE');
 const [g]=groupMissingSkuCandidates({orders:[o]});
 assert.equal(g.count,1);
 assert.equal(g.catalogFound,1);
 assert.deepEqual(g.catalogNames,['Fictitious Kino match']);
 const mismatched=structuredClone(o);
 mismatched.lines[0].catalog_match.candidate.sku='NOT-TT/G';
 assert.equal(groupMissingSkuCandidates({orders:[mismatched]})[0].catalogFound,0);
});
