// Prices use integer micro-USDT in the ledger; one source for API and quoting.
export const PRICE_VERSION='membership-1-3-5-9-v1';
export const plans=[
 {id:'month',name:'月度',months:1,price:'1.00',units:'1000000'},
 {id:'half-year',name:'半年',months:6,price:'3.00',units:'3000000'},
 {id:'year',name:'年度',months:12,price:'5.00',units:'5000000'},
 {id:'permanent',name:'永久',months:0,price:'9.00',units:'9000000'}
].map(plan=>Object.freeze({...plan,currency:'USDT'}));
export const priceUnits=Object.fromEntries(plans.map(plan=>[plan.id,plan.units]));
