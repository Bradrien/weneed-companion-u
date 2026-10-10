import {configFromEnv,jsonRpc,OdooBridgeError} from './odoo-core.mjs';
export const COMPANIES = Object.freeze({'Global Trust Agriculture SA':'GTA','Trim Rocket s.r.o.':'TR'});
export function stockTransition(previous,current,mode='availability') {
 if(!previous || previous.quantity_basis!==current.quantity_basis || previous.unit!==current.unit) return null;
 const a=previous.available_quantity,b=current.available_quantity;
 if(!Number.isFinite(a)||!Number.isFinite(b))throw new Error('invalid_quantity');
 if(a>0 && b<=0)return 'out_of_stock';
 if(a<=0 && b>0)return 'back_in_stock';
 if(mode==='all_changes' && Math.abs(a-b)>0.000001)return 'quantity_changed';
 return null;
}
export async function readStock(env,fetchImpl=fetch) {
 const cfg=configFromEnv(env);
 const uid=await jsonRpc(cfg,'common','authenticate',[cfg.db,cfg.login,cfg.apiKey,{}],fetchImpl);
 if(!Number.isSafeInteger(uid)||uid<=0|| (cfg.uidPin && cfg.uidPin!==uid))throw new OdooBridgeError('odoo_credentials_rejected');
 const read=(model,method,args,options={})=>jsonRpc(cfg,'object','execute_kw',[cfg.db,uid,cfg.apiKey,model,method,args,options],fetchImpl);
 const companies=await read('res.company','search_read',[[['name','in',Object.keys(COMPANIES)]]],{fields:['id','name'],limit:3});
 if(!Array.isArray(companies)||companies.length!==2||new Set(companies.map(c=>COMPANIES[c.name])).size!==2)throw new OdooBridgeError('stock_company_scope_unverified');
 const fieldNames=['id','name','default_code','uom_id','company_id','sale_ok','active','type','detailed_type','is_storable','qty_available','free_qty','virtual_available'];
 const metadata=await read('product.product','fields_get',[fieldNames],{attributes:['type','string','selection']});
 if(!metadata||!metadata.qty_available||!metadata.uom_id||!metadata.company_id)throw new OdooBridgeError('stock_fields_unavailable');
 const basis=metadata.free_qty?'free_qty':'qty_available';
 const stockType=metadata.detailed_type?.selection?.some(x=>x[0]==='product')?'detailed_type':metadata.type?.selection?.some(x=>x[0]==='product')?'type':null;
 const scope=metadata.is_storable?'tracked_inventory':stockType?'stockable_products':'non_service_products';
 const fields=fieldNames.filter(f=>metadata[f]);
 const rows=[];
 for(const company of companies){
  if(!Number.isSafeInteger(company.id)||company.id<=0)throw new OdooBridgeError('stock_company_scope_unverified');
  const context={allowed_company_ids:[company.id],force_company:company.id,company_id:company.id};
  const domain=[['active','=',true],['sale_ok','=',true],['company_id','in',[false,company.id]]];
  if(metadata.is_storable)domain.push(['is_storable','=',true]);
  else if(stockType)domain.push([stockType,'=','product']);
  else if(metadata.type)domain.push(['type','!=','service']);
  let after=0,companyCount=0;
  while(true){
   const page=await read('product.product','search_read',[domain.concat([['id','>',after]])],{fields,limit:200,order:'id asc',context});
   if(!Array.isArray(page)||page.length>200)throw new OdooBridgeError('invalid_stock_response');
   for(const p of page){
    if((metadata.is_storable&&p.is_storable!==true)||(stockType&& !metadata.is_storable&&p[stockType]!=='product'))throw new OdooBridgeError('invalid_stock_response');
    if(!Number.isSafeInteger(p.id)||p.id<=after||typeof p.name!=='string'||!Array.isArray(p.uom_id)||
       typeof p.uom_id[1]!=='string'||typeof p[basis]!=='number'||!Number.isFinite(p[basis])||
       typeof p.qty_available!=='number'||!Number.isFinite(p.qty_available))throw new OdooBridgeError('invalid_stock_response');
    if(Array.isArray(p.company_id)&&p.company_id[0]!==company.id)throw new OdooBridgeError('stock_company_scope_unverified');
    after=p.id;companyCount++;
    if(companyCount>5000)throw new OdooBridgeError('stock_source_limit_exceeded');
    rows.push({company:COMPANIES[company.name],company_id:company.id,product_id:p.id,
     sku:typeof p.default_code==='string'?p.default_code.slice(0,200):'',product_name:p.name.slice(0,500),
     unit:p.uom_id[1].slice(0,100),quantity_basis:basis,available_quantity:p[basis],on_hand_quantity:p.qty_available,
     forecast_quantity:typeof p.virtual_available==='number'&&Number.isFinite(p.virtual_available)?p.virtual_available:null});
   }
   if(page.length<200)break;
  }
  if(companyCount===0)throw new OdooBridgeError('stock_empty_company');
 }
 return {rows,metadata:{source:'odoo',product_scope:scope,quantity_basis:basis,companies:companies.map(c=>({company:COMPANIES[c.name],id:c.id})),complete:true,read_only_odoo:true}};
}
