import test from 'node:test';
import assert from 'node:assert/strict';
import {auditReconciliation} from '../assets/reconciliation.mjs';

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
