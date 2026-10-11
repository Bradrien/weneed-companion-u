/** Only fixed Odoo models and numeric source identities can become links. */
export function odooRecordUrl(model,id){
 if(!['sale.order','account.move'].includes(model)||!Number.isSafeInteger(id)||id<1)
  throw Error('invalid_odoo_record');
 return 'https://weneedweed.odoo.com/web#id='+id+'&model='+model+'&view_type=form';
}
