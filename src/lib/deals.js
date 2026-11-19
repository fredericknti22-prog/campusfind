'use strict';
/** Goods and rooms end in a deal; services, jobs, events, businesses and lost property do not. */
const SELLABLE = { textbooks: 'Mark as sold', electronics: 'Mark as sold', free: 'Mark as given away', housing: 'Mark as taken' };
const soldLabel = (l) => SELLABLE[l && l.cat_slug] || null;
const isSold = (l) => Boolean(l && l.status === 'closed' && l.outcome === 'sold');
module.exports = { soldLabel, isSold };
