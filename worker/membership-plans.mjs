// Prices use integer micro-USDT in the ledger; one source for API and quoting.
export const PRICE_VERSION='membership-duration-coupons-v2';
export const plans=[
 {id:'month',name:'月度',months:1,price:'1.00',units:'1000000'},
 {id:'quarter',name:'季度',months:3,price:'2.00',units:'2000000'},
 {id:'half-year',name:'半年',months:6,price:'3.00',units:'3000000'},
 {id:'year',name:'年度',months:12,price:'5.00',units:'5000000'}
].map(plan=>Object.freeze({...plan,currency:'USDT'}));
export const priceUnits=Object.fromEntries(plans.map(plan=>[plan.id,plan.units]));
