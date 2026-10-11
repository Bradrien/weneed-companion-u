/** Financial checks only. These checks do not establish commission entitlement. */
export const COMMISSION_RULE_STATUS=Object.freeze({
 payable:false,unitsVerified:false,historicalCostsVerified:false,
 spiffEnabled:false,creditNotesVerified:false,paymentVerified:false,
 explanation:'Unités et coûts à la date de vente à vérifier. Les sources SPIFF divergent ; SPIFF désactivé. Avoirs, exclusions contractuelles et déclenchement du paiement à confirmer.'
});
export const COMMISSION_ISSUES=Object.freeze({
 incomplete_source_amount:'Montant source manquant : estimation suspendue',
 lines_total_mismatch:'Total HT différent de la somme des lignes : estimation suspendue',
 signed_adjustment:'Ligne négative ou ajustement : traitement à confirmer, estimation suspendue',
 forecast_total_mismatch:'Estimation totale différente de la somme des lignes : estimation suspendue',
 invalid_line_inputs:'Prix ou remise incompatible avec le scénario : estimation suspendue',
 not_eur:'Devise différente de EUR : estimation suspendue'
});
export function cents(value){
 if(typeof value!=='number'||!Number.isFinite(value))return null;
 const rounded=Math.round(value*100);
 return Number.isSafeInteger(rounded)?rounded:null;
}
export function sumCents(values){
 let result=0;
 for(const value of values){
  const amount=cents(value);
  if(amount===null||!Number.isSafeInteger(result+amount))return null;
  result+=amount;
 }
 return result;
}
export function sourceAmountIssues(amount,lines,{amountKey='subtotalHT',quantityKey='quantity'}={}){
 const issues=[],total=sumCents(lines.map(line=>line[amountKey])),orderAmount=cents(amount);
 if(total===null||orderAmount===null)issues.push('incomplete_source_amount');
 // Odoo can round line subtotals. Four cents is the existing gateway tolerance.
 else if(Math.abs(total-orderAmount)>4)issues.push('lines_total_mismatch');
 if((typeof amount==='number'&&amount<0)||lines.some(line=>
  (typeof line[amountKey]==='number'&&line[amountKey]<0)||
  (typeof line[quantityKey]==='number'&&line[quantityKey]<0)))issues.push('signed_adjustment');
 return issues;
}
