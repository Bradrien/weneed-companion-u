/**
 * Independent reconstruction of the Kino browser SIMULATOR (10 Oct 2026).
 * Not verified against Kino's server-side importOdooSales or recalcBatch.
 * Estimates only; never payment entitlements.
 */
export function kinoCommissionRate(tier, marginRatio) {
 if (tier !== 'A' && tier !== 'B') throw new TypeError('tier must be A or B');
 if (!Number.isFinite(marginRatio)) throw new TypeError('invalid margin ratio');
 if (marginRatio <= 0) return tier === 'A' ? 0.2 : 0.22254;
 if (tier === 'B') return marginRatio >= 1 ? 0.3 : 0.22254 + marginRatio*(0.3-0.22254);
 if (marginRatio >= 0.8) return 0.3;
 if (marginRatio <= 0.15) return 0.2 + marginRatio/0.15*(0.2321-0.2);
 return 0.2321 + (marginRatio-0.15)/0.65*(0.3-0.2321);
}
export function simulateKinoLine(product,sale){
 if(!product||!sale)throw new TypeError('product and sale required');
 const tier=product.tier||'A';
 if(tier!=='A'&&tier!=='B')throw new TypeError('unknown tier');
 const cost=Number(product.cost??0),price=Number(sale.price??0),
  quantity=Number(sale.quantity??0),unitWeightKg=Number(product.unit_weight_kg??0);
 if([cost,price,quantity,unitWeightKg].some(x=>!Number.isFinite(x))||
    cost<0||price<0||quantity<0||unitWeightKg<0)throw new TypeError('invalid numeric input');
 const correctedCost=cost*(tier==='A'?1.25:1.15);
 const unitMargin=price-correctedCost;
 const margin=unitMargin*quantity;
 const marginRatio=cost>0?unitMargin/cost:unitMargin>0?999:0;
 const rate=margin>0?kinoCommissionRate(tier,marginRatio):0;
 const commission=Math.max(0,margin)*rate;
 const weightKg=String(product.unit??'').toLowerCase().includes('gr')
  ?quantity/1000:quantity*unitWeightKg;
 const spiffAmount=sale.spiff?weightKg*(tier==='A'?50:25):0;
 return{sales:price*quantity,correctedCost,unitMargin,margin,marginRatio,rate,
  commission,weightKg,spiffAmount,total:commission+spiffAmount};
}
export function simulateKinoBasket(rows){
 if(!Array.isArray(rows))throw new TypeError('rows must be an array');
 return rows.reduce((out,{product,sale})=>{
  const calc=simulateKinoLine(product,sale);
  out.count++;
  for(const k of ['sales','margin','commission','weightKg','spiffAmount','total'])
   out[k]+=calc[k];
  return out;
 },{count:0,sales:0,margin:0,commission:0,weightKg:0,spiffAmount:0,total:0});
}
