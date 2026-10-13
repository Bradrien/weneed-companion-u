import test from 'node:test';
import assert from 'node:assert/strict';
import {contactActions} from '../validation-v12/assets/v1-interface.mjs';

function links(channels,extra=[]){
 const previous=globalThis.document;
 globalThis.document={createElement(tag){return {tag,children:[],attributes:{},append(...items){this.children.push(...items)},setAttribute(key,value){this.attributes[key]=value}}}};
 try{return contactActions([{name:'Contact Test',channels},...extra]).children}
 finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous}
}
const channel=(type,value)=>({type,value});

test('international WhatsApp opens the exact number without preparing or sending a message',()=>{
 const result=links([channel('whatsapp','+33 (6) 12-34.56 78')]);
 assert.deepEqual(result.map(n=>[n.textContent,n.href]),[['WhatsApp','https://wa.me/33612345678'],['Appeler','tel:+33612345678']]);
 assert.equal(result[0].target,'_blank');
 assert.equal(result[0].rel,'noopener noreferrer');
 assert.equal(result[0].attributes['aria-label'],'WhatsApp · Contact Test · +33 (6) 12-34.56 78');
 assert.equal(new URL(result[0].href).search,'');
});

test('00 country-code notation is normalized consistently for mobile and telephone',()=>{
 const mobile=links([channel('mobile','0033 6 12 34 56 78')]);
 assert.deepEqual(mobile.map(n=>n.href),['https://wa.me/33612345678','tel:+33612345678']);
 assert.deepEqual(links([channel('phone','0033 5 12 34 56 78')]).map(n=>n.href),['tel:+33512345678']);
});

test('a local number keeps its calling action without guessing a country for WhatsApp',()=>{
 for(const type of ['whatsapp','mobile','phone'])assert.deepEqual(links([channel(type,'06 12 34 56 78')]).map(n=>n.href),['tel:0612345678']);
});

test('invalid and injected telephone values create no actions',()=>{
 for(const value of ['+033612345678','003','+1234567','+1234567890123456','javascript:alert(1)','+33612345678?text=hello','+33612345678#fragment','+33/612345678','+33612345678;ext=1','+33612345678abc'])assert.equal(links([channel('whatsapp',value)]).length,0,value);
});

test('maximum international length supports both plus and 00 prefixes',()=>{
 for(const prefix of ['+','00'])assert.equal(links([channel('whatsapp',prefix+'123456789012345')])[0].href,'https://wa.me/123456789012345');
});

test('equivalent duplicate contact channels yield one action of each kind',()=>{
 const result=links([channel('whatsapp','+33612345678'),channel('phone','0033612345678')],[{name:'Duplicate',channels:[channel('mobile','+33 6 12 34 56 78')]}]);
 assert.deepEqual(result.map(n=>n.href),['https://wa.me/33612345678','tel:+33612345678']);
});

test('safe mail links remain available and injected mail values are rejected',()=>{
 assert.equal(links([channel('email','sales@example.test')])[0].href,'mailto:sales@example.test');
 for(const value of ['sales@example.test?bcc=hidden@example.test','sales@example.test\nBcc:other@example.test','javascript:alert(1)'])assert.equal(links([channel('email',value)]).length,0);
});
