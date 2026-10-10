import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeQuotes,quoteStats,prepareQuote} from '../assets/manual-quotes-d20.mjs';
const id='d4522538-54d8-497f-a80d-15a1cf214189';
const one={id,reference:'Q-101',client_name:'Test',company:'TR',quote_date:'2026-10-11',
 status:'en_cours',amount_ht:1400,commission_amount:210,updated_at:'2026-10-11T10:00:00Z',calculation_source:'manual_quote_d20'};
test('pending total is separate from accepted and invoiced',()=>{
 const rows=normalizeQuotes([one,{...one,status:'valide',id:'ae2e6fc3-9ce1-47ff-99b9-46898410ca2a'}]);
 const s=quoteStats(rows);
 assert.equal(s.pendingHt,1400);assert.equal(s.forecastCommission,210);assert.equal(s.validatedCount,1);
});
test('no estimate is represented as zero',()=>{
 const s=quoteStats(normalizeQuotes([{...one,commission_amount:null}]));
 assert.equal(s.forecastKnown,0);
});
test('manually entered prices may contain French decimals, but negatives rejected',()=>{
 const q=prepareQuote({reference:'qq-123',client_name:'Shop Test',company:'TR',status:'en_cours',
  quote_date:'2026-10-11',amount_ht:'1500,50',commission_amount:''});
 assert.equal(q.amount_ht,1500.5);assert.equal(q.commission_amount,null);
 assert.throws(()=>prepareQuote({...q,amount_ht:'-500'}));
});
