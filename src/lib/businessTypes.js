'use strict';
/** Kinds of seller on the Business directory. The key is stored on the listing; the label is what members see. */
const TYPES = [
  { key: 'hostel', label: 'Hostel & rooms', who: 'Hostel managers', icon: 'home', tone: 2, pitch: 'List rooms, rates, facilities and viewing times so students find you first.' },
  { key: 'food', label: 'Food & drinks', who: 'Food vendors', icon: 'gift', tone: 4, pitch: 'Share your menu, prices and where to find you. Daily specials welcome.' },
  { key: 'shop', label: 'Shop & retail', who: 'Shop owners and sellers', icon: 'tag', tone: 5, pitch: 'Sell fashion, electronics, stationery and everyday goods to the whole campus.' },
  { key: 'service', label: 'Services', who: 'Service providers', icon: 'tool', tone: 3, pitch: 'Salons, laundry, printing, repairs and deliveries, booked by message.' },
  { key: 'other', label: 'Other business', who: 'Anyone else selling', icon: 'store', tone: 8, pitch: 'If you sell something to students, this is the place to be seen.' },
];
const KEYS = TYPES.map((t) => t.key);
const isType = (k) => KEYS.includes(k);
const labelOf = (k) => (TYPES.find((t) => t.key === k) || {}).label || '';

module.exports = { TYPES, KEYS, isType, labelOf };
