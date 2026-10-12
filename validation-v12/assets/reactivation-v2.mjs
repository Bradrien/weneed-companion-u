const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}/.test(x)?Date.parse(x.slice(0,10)+'T00:00:00Z'):NaN;
export function reactivationProfile(p,{generatedAt,now=new Date().toISOString()}={}){
 const stamp=Date.parse(generatedAt),instant=Date.parse(now);
 const fresh=Number.isFinite(stamp)&&Number.isFinite(instant)&&instant-stamp<=900000&&stamp-instant<=300000;
 if(!fresh)return {eligible:false,reason:'refresh',label:'Actualiser les ventes',days:null};
 if(!p.odooAvailable||!p.verifiedOdooLink)return {eligible:false,reason:'unverified',label:'Ventes à vérifier',days:null};
 const last=day(p.lastOrderAt),today=day(now);
 if(!p.verifiedOrderCount||!Number.isFinite(last)||!Number.isFinite(today)||last>today)
  return {eligible:false,reason:'no_purchase',label:'Historique insuffisant',days:null};
 const days=Math.floor((today-last)/86400000),median=p.cadence?.medianGapDays;
 const hasCadence=typeof median==='number'&&Number.isFinite(median)&&median>0&&p.cadence.observations>0;
 const threshold=hasCadence?Math.max(30,Math.ceil(median*1.65)):60;
 return {eligible:days>threshold,reason:hasCadence?'cadence':'fixed_window',days,threshold,
  lateDays:Math.max(0,days-threshold),label:days+' j sans achat',
  evidence:hasCadence?'Rythme habituel : '+median+' j · seuil de relance : '+threshold+' j.'
   :'Pas de rythme fiable : relance proposée après 60 j, sans présumer que le client est perdu.'};
}
export function sortReactivation(rows){return rows.slice().sort((a,b)=>(b.reactivation?.lateDays||0)-(a.reactivation?.lateDays||0)||
 (b.revenueHT??-1)-(a.revenueHT??-1)||a.name.localeCompare(b.name,'fr'));}
