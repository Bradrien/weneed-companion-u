import test from 'node:test';
import assert from 'node:assert/strict';
import {kinoCommissionRate,simulateKinoLine,simulateKinoBasket} from '../assets/kino-simulator.mjs';
const euro=n=>Math.round((n+Number.EPSILON)*100)/100;

test('GTA Slurp: 100 gr, 2.50 EUR/gr, Kino cost 1.40 EUR/gr, tier A -> 20.43 EUR',()=>{
 const r=simulateKinoLine({tier:'A',cost:1.4,unit:'gr'},{price:2.5,quantity:100,spiff:false});
 assert.equal(r.correctedCost,1.75);
 assert.equal(r.margin,75);
 assert.equal(euro(r.commission),20.43);
 assert.equal(r.weightKg,0.1);
});
test('TR Toad Venom 250: 1 unit at 800 EUR, Kino cost 395 EUR, tier A -> 91.09 EUR',()=>{
 const r=simulateKinoLine({tier:'A',cost:395,unit:'Units',unit_weight_kg:0},{price:800,quantity:1,spiff:false});
 assert.equal(r.correctedCost,493.75);
 assert.equal(r.margin,306.25);
 assert.equal(euro(r.commission),91.09);
});
test('screenshotted mixed basket -> 1050 sales / 381.25 margin / 111.51 commission',()=>{
 const r=simulateKinoBasket([
  {product:{tier:'A',cost:1.4,unit:'gr'},sale:{price:2.5,quantity:100}},
  {product:{tier:'A',cost:395,unit:'Units'},sale:{price:800,quantity:1}}
 ]);
 assert.equal(r.sales,1050);
 assert.equal(r.margin,381.25);
 assert.equal(euro(r.commission),111.51);
 assert.equal(r.spiffAmount,0);
 assert.equal(euro(r.total),111.51);
});
test('A rate at piecewise boundaries and cap',()=>{
 assert.equal(kinoCommissionRate('A',0),0.2);
 assert.equal(kinoCommissionRate('A',0.15),0.2321);
 assert.equal(kinoCommissionRate('A',0.8),0.3);
 assert.equal(kinoCommissionRate('A',12),0.3);
 assert.ok(kinoCommissionRate('A',0.149)<kinoCommissionRate('A',0.15));
});
test('B rate grows from 22.254% up to 30% at margin ratio 1',()=>{
 assert.equal(kinoCommissionRate('B',0),0.22254);
 assert.equal(kinoCommissionRate('B',0.5),0.26127);
 assert.equal(kinoCommissionRate('B',1),0.3);
 assert.equal(kinoCommissionRate('B',12),0.3);
});
test('zero or negative margin -> no commission',()=>{
 const r=simulateKinoLine({tier:'B',cost:100,unit:'Units'},{price:70,quantity:5,spiff:false});
 assert.ok(r.margin<0);
 assert.equal(r.rate,0);
 assert.equal(r.commission,0);
});
test('SPIFF requires explicit switch: 50 EUR/kg for A, 25 EUR/kg for B',()=>{
 const a=simulateKinoLine({tier:'A',cost:1,unit:'gr'},{price:2,quantity:100,spiff:true});
 const b=simulateKinoLine({tier:'B',cost:50,unit:'Units',unit_weight_kg:0.25},{price:100,quantity:4,spiff:true});
 assert.equal(a.spiffAmount,5);
 assert.equal(b.spiffAmount,25);
 assert.equal(b.weightKg,1);
});
test('cost-zero behaviour reproduces simulation but flags need for audit elsewhere',()=>{
 const r=simulateKinoLine({tier:'A',cost:0,unit:'gr'},{price:3,quantity:1});
 assert.equal(r.marginRatio,999);
 assert.equal(r.rate,0.3);
});
test('invalid tier and negative quantity rejected',()=>{
 assert.throws(()=>simulateKinoLine({tier:'C',cost:1},{price:2,quantity:1}));
 assert.throws(()=>simulateKinoLine({tier:'A',cost:1},{price:2,quantity:-1}));
});
