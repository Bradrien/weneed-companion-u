/** Authenticated monthly source export. Missing/blocked values remain blank. */
import {filterOdooPipeline,statusLabels} from './odoo-commission-model-d30.mjs?v=rules-1';
export function selectedCommissionOrders(data,{month,company='all',query=''}={}){
 if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('invalid_month');
 return filterOdooPipeline(data,{company,query}).filter(o=>o.date.slice(0,7)===month);
}
export function catalogueProvenance(data,orders){
 const capturedAt=data.catalogSnapshotAt||null,readAt=data.readAt,
  captured=capturedAt?Date.parse(capturedAt):NaN,read=Date.parse(readAt);
 const usable=Number.isFinite(captured)&&Number.isFinite(read)&&captured<=read&&data.catalogAvailable!==false;
 const date=capturedAt?.slice(0,10);
 return {capturedAt,readAt,available:data.catalogAvailable,productsTotal:data.catalogProductsTotal,
  ageHours:usable?(read-captured)/3600000:null,
  chronologyValid:Number.isFinite(captured)&&Number.isFinite(read)&&captured<=read,
  beforeCapture:date?orders.filter(o=>o.date.slice(0,10)<date).length:null,
  afterCapture:date?orders.filter(o=>o.date.slice(0,10)>date).length:null,
  sameDay:date?orders.filter(o=>o.date.slice(0,10)===date).length:null,
  historicalCostsVerified:false,payable:false};
}
export const COMMISSION_CSV_COLUMNS=Object.freeze([
 'mois','societe','commande_odoo','id_commande','client','date_odoo','categorie_odoo',
 'etat_odoo','facturation_odoo','devise','ht_commande','estimation_commande_provisoire',
 'commande_partielle','blocages_commande','id_ligne','produit','sku_odoo','quantite_odoo',
 'unite_odoo','prix_unitaire_odoo','remise_pct','ht_ligne','estimation_ligne_provisoire',
 'raison_ligne','base_unite_kino','taille_sachet_g','palier_kino','cout_par_unite_odoo','prix_net_par_unite_odoo',
 'coefficient_cout_kino','cout_ajuste_par_unite_odoo','marge_calcul_ligne','taux_commission_pct',
 'code_candidat','statut_catalogue','cout_brut_catalogue','tarif_brut_catalogue',
 'capture_catalogue','lecture_odoo','source_reverifiee','couts_historiques_valides','spiff','payable','methode_rapprochement','sku_catalogue_rapproche'
]);
export function csvCell(value){
 if(value===null||value===undefined)return '""';
 let s=typeof value==='number'?String(value).replace('.',','):String(value);
 // Source text must never be interpreted as a spreadsheet formula.
 if(typeof value!=='number'&&(/^[\s\uFEFF]*[=+\-@]/u.test(s)||/^[\t\r\n]/u.test(s)))s="'"+s;
 return '"'+s.replaceAll('"','""')+'"';
}
export function createCommissionCsv(data,options){
 if(!data?.sourceInputsRechecked)throw Error('export_requires_rechecked_source');
 const orders=selectedCommissionOrders(data,options),rows=[COMMISSION_CSV_COLUMNS];
 for(const o of orders)for(const l of o.lines){
  const c=l.calculation,e=l.catalogEvidence,blocked=o.issues.length>0;
  rows.push([options.month,o.company,o.reference,o.id,o.client,o.date,statusLabels[o.stage],
   o.state,o.invoiceStatus,o.currency,o.amountHT,o.forecast,o.partial?'oui':'non',o.issues.join(' | '),
   l.id,l.product,l.sku,l.quantity,l.unit,l.unitPrice,l.discountPct,l.subtotalHT,
   blocked?null:l.commissionEstimate,l.reason,l.unitBasis,l.packSizeG,l.kinoTier,l.effectiveUnitCostEur,
   c?.netUnitPrice,c?.costMultiplier,c?.adjustedUnitCost,c?.margin,c?c.rate*100:null,
   e?.source==='product_label_prefix'?e.sku:l.listingMatch?.catalog_sku,e?.status||(l.listingMatch?'found':null),
   l.catalogCostEur??e?.costEur,l.catalogPriceEur??e?.listPriceEur,
   data.catalogSnapshotAt,data.readAt,'oui','non','desactive','non',l.listingMatch?.method||'sku_exact',l.listingMatch?.catalog_sku||l.sku]);
 }
 return {filename:'commissions-provisoires-'+options.month+'-'+(options.company||'all')+'.csv',
  content:'\uFEFF'+rows.map(r=>r.map(csvCell).join(';')).join('\r\n')+'\r\n',
  orders:orders.length,lines:rows.length-1};
}
