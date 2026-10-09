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
export function assertReport(report){
 if(!report||typeof report!=='object'||report.source!=='odoo_live_read_only'||!Array.isArray(report.orders))throw new Error('invalid_report');
 if(report.persisted!==false||report.verified_commissions_eur!==null||report.commissions_are_calculated!==false)throw new Error('unverified_commissions_guard');
 if(!Number.isInteger(report.orders_count)||report.orders_count!==report.orders.length)throw new Error('incomplete_report');
 if(report.orders.some(o=>!o||!SOURCE_COMPANIES.includes(o.company)||!Array.isArray(o.lines)||o.commission_eur!==null))throw new Error('invalid_orders');
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
 const reported=confirmed.reduce((acc,o)=>acc+(typeof o.amount_ht==='number'?o.amount_ht:0),0);
 return {visible:orders.length,confirmed:confirmed.length,excluded:orders.length-confirmed.length,
  alerts:orders.filter(o=>(o.issues||[]).length>0).length,
  sourceAmount:(currencies.size>1||hasUnknownCurrency)?null:reported,sourceCurrency:currencies.size===1&&!hasUnknownCurrency?[...currencies][0]:null,
  hasMixedCurrencies:currencies.size>1};
}
export function isDateRangeValid(from,to){if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||''))return false;
 const start=new Date(from+'T00:00:00Z'),end=new Date(to+'T00:00:00Z');return Number.isFinite(+start)&&Number.isFinite(+end)&&start.toISOString().slice(0,10)===from&&end.toISOString().slice(0,10)===to&&start<=end&&(+end-+start)<=93*86400000;}
