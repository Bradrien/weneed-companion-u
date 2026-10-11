/** D30: conservative Kino catalogue-unit reconciliation.
 * Kino may price GTA flowers per gram and TR SKU suffix /50 or /250 per bag.
 * Price scale is evidence, NOT proof of historical costs or payment.
 * Never treat a mismatch as a zero commission.
 */
const positive = n => typeof n==='number'&&Number.isFinite(n)&&n>0;
const ratioFits = x => Number.isFinite(x)&&x>=0.35-1e-9&&x<=1.75+1e-9;
export const UNIT_REASON = 'unverified_unit_scale';
export function reconcileKinoUnit({sku,productName,cost,listedPrice,odooUnitPrice}){
 if(!positive(cost)||!positive(listedPrice)||!positive(odooUnitPrice))
  return {ok:false,reason:UNIT_REASON};
 const code=typeof sku==='string'?sku.trim().toUpperCase():'';
 const title=typeof productName==='string'?productName:'';
 // Confirm a pack size with TWO independent catalogue fields: SKU suffix + human title.
 const found=code.match(/\/(25|50|100|250|500|1000)$/);
 const pack=found?Number(found[1]):null;
 const packConfirmed=pack!==null&&
  new RegExp('(?:^|[^0-9])'+pack+'(?:g|gr|grams?)?(?=$|[^0-9])','i').test(title);
 const same=ratioFits(odooUnitPrice/listedPrice);
 const perGram=packConfirmed&&ratioFits(odooUnitPrice/(listedPrice/pack));
 if(same===perGram)return {ok:false,reason:UNIT_REASON};
 const effectiveCost=perGram?cost/pack:cost;
 if(!positive(effectiveCost))return {ok:false,reason:UNIT_REASON};
 return {
  ok:true,basis:perGram?'pack_cost_divided_by_grams':'catalog_price_matches_odoo_unit',
  costPerOdooUnit:effectiveCost,packSizeG:packConfirmed?pack:null,
  catalogUnitPrice:perGram?listedPrice/pack:listedPrice
 };
}
