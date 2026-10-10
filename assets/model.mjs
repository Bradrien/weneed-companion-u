/** Pure presentation logic. No credentials, Odoo requests or rate calculations. */
export const SOURCE_COMPANIES = Object.freeze(['GTA','TR']);
export function formatMoney(v,currency='EUR') {
 if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
 return new Intl.NumberFormat('fr-FR',{style:'currency',currency:currency||'EUR',minimumFractionDigits:2,maximumFractionDigits:2}).format(v);
}
export function statusText(v) {return ({sale:'Confirmée',done:'Terminée',cancel:'Annulée',draft:'Brouillon',sent:'Envoyée'}[v]||'À vérifier');}
export function lineText(v) {return ({candidate:'Produit à rapprocher',sample:'Échantillon',shipping:'Livraison',free:'Offert / gratuit',review:'Référence à vérifier',anomaly:'Anomalie',display:'Note'}[v]||'À vérifier');}
export function shortDate(value){if(typeof value!=='string')return '—';const s=value.slice(0,10); if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return '—';const [y,m,d]=s.split('-');return `${d}/${m}/${y}`;}
export function monthOf(date){const y=date.getFullYear(),m=date.getMonth();return {from:`${y}-${String(m+1).padStart(2,'0')}-01`,to:`${y}-${String(m+1).padStart(2,'0')}-${String(new Date(y,m+1,0).getDate()).padStart(2,'0')}`,label:new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric'}).format(new Date(y,m,1))};}
export function prevCompleteMonth(now=new Date()){return monthOf(new Date(now.getFullYear(),now.getMonth()-1,1));}
export const MATCH_STATUSES=Object.freeze(['matched','missing_sku','not_found','ambiguous_sku','catalog_invalid_price','not_applicable']);
export function assertMatching(report){
 if(report.catalog_matching===undefined && report.catalog_snapshot===undefined)return;
 const m=report.catalog_matching,s=report.catalog_snapshot;
 if(!m||!s||!Number.isSafeInteger(s.products_total)||s.products_total<1||s.products_total>1500)throw new Error('invalid_report');
 const names=['eligible','matched','not_found','missing_sku','ambiguous_sku','catalog_invalid_price','zero_cost','zero_list_price'];
 if(names.some(n=>!Number.isSafeInteger(m[n])||m[n]<0))throw new Error('invalid_report');
 const actual=Object.fromEntries(names.map(k=>[k,0]));
 for(const order of report.orders)for(const line of order.lines){
  const match=line.catalog_match;
  if(!match||!MATCH_STATUSES.includes(match.status))throw new Error('invalid_report');
  // Only confirmed, eligible product lines may be matched to the Kino catalog.
  const eligible=['sale','done'].includes(order.state)&&['candidate','review'].includes(line.kind);
  if(eligible===(match.status==='not_applicable'))throw new Error('invalid_report');
  if(!eligible)continue;
  actual.eligible++;
  actual[match.status]++;
  if(match.status==='matched'){
   if(typeof match.cost_eur!=='number'||!Number.isFinite(match.cost_eur)||match.cost_eur<0||
      typeof match.list_price_eur!=='number'||!Number.isFinite(match.list_price_eur)||match.list_price_eur<0||
      match.cost_zero!==(match.cost_eur===0)||match.price_zero!==(match.list_price_eur===0))
     throw new Error('invalid_report');
   if(match.cost_zero)actual.zero_cost++;
   if(match.price_zero)actual.zero_list_price++;
  }
 }
 if(names.some(k=>m[k]!==actual[k]))throw new Error('invalid_report');
}
export function assertReport(report,expectedPeriod=null){
 if(!report||typeof report!=='object'||report.source!=='odoo_live_read_only'||!Array.isArray(report.orders))throw new Error('invalid_report');
 if(expectedPeriod&&(report.period_from!==expectedPeriod.from||report.period_to!==expectedPeriod.to))throw new Error('report_period_mismatch');
 if(report.persisted!==false||report.verified_commissions_eur!==null||report.commissions_are_calculated!==false)throw new Error('unverified_commissions_guard');
 if(!Number.isInteger(report.orders_count)||report.orders_count!==report.orders.length)throw new Error('incomplete_report');
 if(report.orders.some(o=>!o||!SOURCE_COMPANIES.includes(o.company)||!Array.isArray(o.lines)||o.commission_eur!==null||
  o.lines.some(l=>!l||l.commission_eur!==null)))throw new Error('invalid_orders');
 assertMatching(report);
 return report;
}
export function filteredOrders(report,{company='ALL',state='all',query='',onlyReview=false}={}) {
 if(!report)return[];
 const term=query.toLocaleLowerCase('fr').trim();
 return report.orders.filter(o=>{
  if(company!=='ALL'&&o.company!==company)return false;
  if(state==='confirmed'&&!['sale','done'].includes(o.state))return false;
  if(state==='excluded'&&['sale','done'].includes(o.state))return false;
  if(onlyReview&&!(o.issues||[]).length)return false;
  if(!term)return true;
  return [o.reference,o.client,o.company,o.salesperson,...o.lines.map(l=>l.sku+' '+l.product_name)]
   .join(' ').toLocaleLowerCase('fr').includes(term);
 });
}
export function deriveStats(orders){
 const confirmed=orders.filter(o=>['sale','done'].includes(o.state));
 const currencies=new Set(confirmed.map(o=>typeof o.currency==='string'&&o.currency.trim()?o.currency:'unknown'));
 const hasUnknownCurrency=currencies.has('unknown');
 const missingAmount=confirmed.some(o=>typeof o.amount_ht!=='number'||!Number.isFinite(o.amount_ht));
 const reported=confirmed.reduce((acc,o)=>acc+(typeof o.amount_ht==='number'&&Number.isFinite(o.amount_ht)?o.amount_ht:0),0);
 return {visible:orders.length,confirmed:confirmed.length,excluded:orders.length-confirmed.length,
  alerts:orders.filter(o=>(o.issues||[]).length>0).length,
  sourceAmount:(currencies.size>1||hasUnknownCurrency||missingAmount)?null:reported,sourceCurrency:currencies.size===1&&!hasUnknownCurrency?[...currencies][0]:null,
  hasMixedCurrencies:currencies.size>1};
}
export function isDateRangeValid(from,to){if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||''))return false;
 const start=new Date(from+'T00:00:00Z'),end=new Date(to+'T00:00:00Z');return Number.isFinite(+start)&&Number.isFinite(+end)&&start.toISOString().slice(0,10)===from&&end.toISOString().slice(0,10)===to&&start<=end&&(+end-+start)<=93*86400000;}
