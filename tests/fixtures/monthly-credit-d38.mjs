import {calculateKinoLine} from '../../validation-v12/assets/kino-calculation-d31.mjs';
export function creditFixture(month='2026-10'){
 const c=calculateKinoLine({tier:'A',cost:1,quantity:100,subtotalHT:300});
 return {ok:true,data:{version:'odoo_monthly_credits_v1',month,read_at:new Date().toISOString(),source_rechecked:true,
 scope:'seller_attributed_credit_notes_invoice_date_read_only_rechecked',read_consistency:'two_read_windows_not_atomic_snapshot',
 catalog_snapshot_at:new Date().toISOString(),calculation_version:'original_line_commission_prorata_return_quantity_v1',
 automatic_deduction:false,spiff_enabled:false,historical_costs_verified:false,document_count:1,line_count:1,estimated_lines:1,
 documents:[{id:1,reference:'TEST-CREDIT',client:'Client de test',date:month+'-05',state:'posted',company:'TR',currency:'EUR',
 amount_ht:60,amount_total:72,reversed_invoice_id:2,issues:[],origin_reference:'',external_reference:'',note:'',
 explicit_invoice_references:[],original_invoice:{id:2,reference:'TEST-INVOICE',link_kind:'native_reversal'},
 lines:[{id:101,product_id:30,product:'Produit de test',sku:'TEST/SKU',quantity:20,subtotal_ht:60,price_unit:3,discount_pct:0,
 unit_id:40,unit:'g',link_kind:'direct_sale_line',original_invoice_line_id:null,
 original:{order_id:301,reference:'TEST-OLDER',date:'2026-09-10',state:'sale',line_id:201,quantity:100,subtotal_ht:300,price_unit:3,discount_pct:0,unit_id:40},
 reason:null,unit_basis:'catalog_price_matches_odoo_unit',pack_size_g:null,effective_unit_cost_eur:1,kino_tier:'A',original_calculation:c,deduction_estimate_cents:1050}]}]}};
}
