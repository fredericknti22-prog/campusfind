'use strict';
/**
 * DEVELOPMENT ONLY. Fills Firebase with sample members, listings and reports so the UI can be reviewed.
 * Runs against the emulators by default; refuses to touch a real project unless ALLOW_DEMO_SEED=1.
 *   npm run seed:demo        (with the emulators running)
 * All demo accounts share the password below (local testing only).
 */
const config = require('../src/config');
const DEMO_PASSWORD = 'Demo-Passw0rd-2026';

async function seed() {
  if (!config.firebase.emulator && process.env.ALLOW_DEMO_SEED !== '1') {
    throw new Error('Refusing to seed demo data into a real Firebase project. Use the emulators, or set ALLOW_DEMO_SEED=1 if you really mean it.');
  }
  const { init } = require('../src/bootstrap');
  const users = require('../src/repo/users');
  const listings = require('../src/repo/listings');
  const categories = require('../src/repo/categories');
  const reports = require('../src/repo/reports');
  const { createAccount } = require('../src/services/auth');

  await init();

  const people = [
    ['Amara Okafor', 'amara@demo.campus', 'student'],
    ['Kofi Mensah', 'kofi@demo.campus', 'student'],
    ['Lindiwe Dlamini', 'lindiwe@demo.campus', 'student'],
    ['Tariq Hassan', 'tariq@demo.campus', 'student'],
    ['Maya Chen', 'maya@demo.campus', 'student'],
    ['Moses Kamau', 'moderator@demo.campus', 'moderator'],
  ];
  const ids = {};
  for (const [name, email, role] of people) {
    const existing = await users.getByEmail(email);
    ids[email] = existing ? existing.user_id : (await createAccount({ name, email, password: DEMO_PASSWORD, role })).user_id;
  }

  const cats = Object.fromEntries((await categories.all(true)).map((c) => [c.slug, c.category_id]));
  const now = Date.now();
  const H = 3600_000;
  const rows = [
    ['amara@demo.campus', 'textbooks', 'Calculus: Early Transcendentals, 9th ed.', 'Clean copy, no highlighting. Includes the student solutions manual. Great for MATH 101 and 102.', 'fixed', 4500, 'Main library, level 2', 'WhatsApp 555-0141 (evenings)', 5 * H],
    ['kofi@demo.campus', 'electronics', 'Casio fx-991EX scientific calculator', 'Approved for exams. Cover included. Selling because I upgraded.', 'fixed', 1800, 'Engineering Block C', 'Message me on the campus app', 20 * H],
    ['lindiwe@demo.campus', 'housing', 'Room in 3-bed flat, 6 min walk from campus', 'Furnished room, shared kitchen and bathroom. Wi-Fi and water included. Two quiet housemates. Available from next month.', 'negotiable', 32000, 'Hillside Road', 'Email lindiwe@demo.campus', 2 * H],
    ['tariq@demo.campus', 'services', 'Maths and Physics tutoring (first-years)', 'Final-year Engineering student. Past-paper practice and clear explanations. Group rates available.', 'fixed', 1500, 'Library study rooms', 'DM or WhatsApp 555-0177', 30 * H],
    ['maya@demo.campus', 'opportunities', 'Paid research assistant, Biology Dept.', 'Eight hours a week helping with sample labelling and data entry. Training provided.', 'none', null, 'Science Block', 'Email the lab: biolab@demo.campus', 48 * H],
    ['amara@demo.campus', 'events', 'Robotics Club open day', 'Come and see the build lab, meet the team and try the drones. Free pizza. Open to all courses.', 'free', null, 'Innovation Hub', 'Just show up. No sign-up needed.', 60 * H],
    ['kofi@demo.campus', 'lost-found', 'Found: blue lanyard with keys', 'Found outside the cafeteria on Tuesday. Describe the keyring to claim it.', 'none', null, 'Cafeteria entrance', 'Message me with the keyring details', 8 * H],
    ['lindiwe@demo.campus', 'free', 'Desk lamp and extension cord, free to a good home', 'Works perfectly. Moving out this week and need it gone. First come, first served.', 'free', null, 'Hall 4', 'Message me', 12 * H],
    ['tariq@demo.campus', 'electronics', 'Lenovo ThinkPad T14, 16GB RAM', 'Runs well, battery lasts around five hours. New SSD last year. Charger included.', 'fixed', 38000, 'Engineering Block C', 'WhatsApp 555-0177', 70 * H],
    ['maya@demo.campus', 'textbooks', 'Organic Chemistry notes bundle', 'Typed lecture notes, summary sheets and three years of past papers with worked answers.', 'fixed', 1200, 'Science Block', 'Email maya@demo.campus', 90 * H],
  ];

  const existing = new Set((await listings.recent(500)).map((l) => l.title));
  let made = 0;
  const create = (who, slug, title, description, price_type, price_cents, location, contact, age, extra = {}) => {
    const t = now - age;
    return listings.create({
      owner_id: ids[who], category_id: cats[slug], title, description, price_type, price_cents, location, contact,
      status: 'active', created_at: t, updated_at: t, published_at: t, ...extra,
    });
  };
  for (const r of rows) {
    if (existing.has(r[2])) continue;
    const featured = ['Room in 3-bed flat, 6 min walk from campus', 'Robotics Club open day'].includes(r[2]);
    await create(...r, featured ? { is_featured: 1, featured_until: now + 10 * 86_400_000 } : {});
    made += 1;
  }

  // one scammy listing + open reports so the moderation queue is not empty
  const scam = 'iPhone 15 Pro, brand new, urgent sale';
  if (!existing.has(scam)) {
    const l = await create('tariq@demo.campus', 'electronics', scam, 'Cheap! Send deposit first via gift card payment and I will courier it. WhatsApp me only.', 'fixed', 15000, 'Anywhere', 'WhatsApp 555-0000', 3 * H);
    await reports.create({ reporter_id: ids['maya@demo.campus'], target_type: 'listing', target_id: l.listing_id, owner_id: l.owner_id, reason: 'scam', details: 'Asked me to pay a deposit with a gift card before showing the phone.' });
    await reports.create({ reporter_id: null, target_type: 'listing', target_id: l.listing_id, owner_id: l.owner_id, reason: 'scam', details: 'Automatic screening matched: payment-scam phrase. A human must confirm.' });
  }

  await seedRichDemo({ ids, cats, now, H, create, existing });

  console.log(`Demo data ready (${made} new listings, plus photos, messages, orders and promotions).`);
  console.log(`Demo password for all demo accounts: ${DEMO_PASSWORD}`);
  console.log('Accounts: amara@, kofi@, lindiwe@, tariq@, maya@ (students) and moderator@ (staff) - all @demo.campus');
}

/* ------------------------------------------------------------------------------------------------------
   Richer mock data so every screen has something to show: photos, more listings, lost & found (including a
   returned item), promoted listings, message threads (some unread), orders (paid and waiting) and bios.
   Photos are original abstract pictures drawn here, not stock images.
   ------------------------------------------------------------------------------------------------------ */
const PALETTES = {
  blue: ['#0B2A6B', '#3D6FD8'], teal: ['#0E6B6B', '#3FC1B0'], amber: ['#B86B00', '#FBB404'], plum: ['#4A2C7A', '#B07CFF'],
  green: ['#1E6B3A', '#7BD389'], coral: ['#A8321F', '#FF8A6B'], slate: ['#2B3A4A', '#7C93AD'], rose: ['#8A1F55', '#FF7EB0'],
};
function artwork(paletteName, variant) {
  const [c1, c2] = PALETTES[paletteName] || PALETTES.blue;
  const shapes = [
    '<circle cx="610" cy="140" r="150" fill="#fff" fill-opacity=".16"/><circle cx="170" cy="380" r="210" fill="#fff" fill-opacity=".10"/><rect x="300" y="170" width="220" height="150" rx="22" fill="#fff" fill-opacity=".28"/>',
    '<rect x="90" y="90" width="260" height="320" rx="26" fill="#fff" fill-opacity=".22"/><rect x="390" y="150" width="300" height="200" rx="26" fill="#fff" fill-opacity=".14"/><circle cx="640" cy="110" r="70" fill="#fff" fill-opacity=".24"/>',
    '<path d="M0 360 Q200 240 400 330 T800 270 V500 H0Z" fill="#fff" fill-opacity=".18"/><circle cx="560" cy="150" r="90" fill="#fff" fill-opacity=".30"/><rect x="120" y="120" width="170" height="170" rx="85" fill="#fff" fill-opacity=".16"/>',
    '<rect x="140" y="130" width="520" height="250" rx="30" fill="#fff" fill-opacity=".20"/><rect x="190" y="180" width="200" height="30" rx="15" fill="#fff" fill-opacity=".45"/><rect x="190" y="235" width="320" height="20" rx="10" fill="#fff" fill-opacity=".30"/><rect x="190" y="280" width="260" height="20" rx="10" fill="#fff" fill-opacity=".30"/>',
  ];
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="800" height="500" fill="url(#g)"/>${shapes[variant % shapes.length]}</svg>`);
}

const BUSINESS_TYPE_BY_TITLE = {
  'Sunrise Hostel: single and shared rooms, 3 minutes from campus': 'hostel',
  'Kente Kitchen: jollof, waakye and fried rice lunches': 'food',
  'Brew & Books Cafe: student discount every weekday': 'food',
  'Glow Studio: nails, lashes and facials': 'service',
  'PrintPoint: printing, binding and passport photos': 'service',
  'Campus Laundry & Ironing: pickup and delivery': 'service',
};

async function seedRichDemo({ ids, cats, now, H, create, existing }) {
  const sharp = require('sharp');
  const users = require('../src/repo/users');
  const listings = require('../src/repo/listings');
  const messages = require('../src/repo/messages');
  const orders = require('../src/repo/orders');
  const images = require('../src/services/images');
  const payments = require('../src/services/payments');
  const crypto = require('crypto');
  const DAY = 86_400_000;

  /* members: bios and programmes */
  const bios = {
    'amara@demo.campus': ['Mechatronics', 'Year 3', 'Robotics Club president. Selling books I no longer need and always up for a coffee chat.'],
    'kofi@demo.campus': ['Electrical Engineering', 'Year 4', 'Final year. Gadgets, calculators and the odd lost key found around Block C.'],
    'lindiwe@demo.campus': ['Architecture', 'Year 2', 'Looking after a quiet flat near campus. Message me about rooms.'],
    'tariq@demo.campus': ['Mechanical Engineering', 'Year 4', 'Tutor for first-year maths and physics.'],
    'maya@demo.campus': ['Biology', 'Year 3', 'Lab assistant, coffee lover, serial note-taker.'],
  };
  for (const [email, [program, study_year, bio]] of Object.entries(bios)) {
    await users.update(ids[email], { profile: { bio, program, study_year, show_program: 1, updated_at: now } });
  }

  /* more listings */
  const more = [
    ['kofi@demo.campus', 'electronics', 'Dell 24-inch monitor, barely used', 'Full HD, HDMI and VGA. Perfect for a hostel desk setup. Original box and cables included.', 'fixed', 22000, 'Hall 2', 'Message me in the app', 4 * H, 'teal', 1],
    ['maya@demo.campus', 'services', 'Braiding and hair styling at student rates', 'Box braids, cornrows and twists in my room on campus. Book at least two days ahead. Mobile Money accepted.', 'fixed', 8000, 'Hall 5', 'Message me in the app', 9 * H, 'rose', 0],
    ['lindiwe@demo.campus', 'housing', 'Single room near the north gate, available now', 'Self-contained room with its own bathroom and a small fridge. Utilities included. Quiet street, 4 minutes to campus.', 'negotiable', 28000, 'North Gate Road', 'Message me in the app', 26 * H, 'amber', 2],
    ['tariq@demo.campus', 'opportunities', 'Weekend campus tour guide wanted', 'Open day tours for new students every Saturday. Paid per tour. Friendly and well organised people only.', 'none', null, 'Visitor Centre', 'Message me in the app', 36 * H, 'green', 3],
    ['amara@demo.campus', 'events', 'Open mic night, Friday 7pm', 'Poetry, music and comedy. Sign up at the door or just come to watch. Snacks provided by the Arts Society.', 'free', null, 'Student Union courtyard', 'Just turn up', 14 * H, 'plum', 0],
    ['kofi@demo.campus', 'lost-found', 'Lost: black Nike backpack with a laptop inside', 'Left in the library second floor study area on Monday evening. Silver laptop sleeve inside. A reward is offered.', 'none', null, 'Main library, level 2', 'Message me in the app', 6 * H, 'slate', 1],
    ['lindiwe@demo.campus', 'lost-found', 'Found: set of three keys on a green ribbon', 'Found near the Hall 4 bus stop on Wednesday morning. Describe the keys and the ribbon to claim them.', 'none', null, 'Hall 4 bus stop', 'Message me in the app', 10 * H, 'green', 3],
    ['tariq@demo.campus', 'free', 'Moving out: free kettle, mugs and bedding', 'Electric kettle, six mugs, a duvet and two pillows. All clean and in good shape. Please collect before Friday.', 'free', null, 'Hall 3', 'Message me in the app', 40 * H, 'coral', 2],
    ['maya@demo.campus', 'textbooks', 'Anatomy and Physiology textbook, 12th edition', 'Hardcover with colour-coded tabs. A few pencil notes in the margins, nothing in pen.', 'fixed', 6500, 'Science Block', 'Message me in the app', 52 * H, 'blue', 1],
    ['lindiwe@demo.campus', 'business', 'Sunrise Hostel: single and shared rooms, 3 minutes from campus', 'Furnished single and 2-in-a-room options with Wi-Fi, 24-hour water, CCTV and a quiet study lounge. Viewings every day from 10am to 5pm. Ask about semester rates.', 'negotiable', 120000, 'Behind the north gate', 'Message us in the app', 12 * H, 'amber', 2],
    ['amara@demo.campus', 'business', 'Kente Kitchen: jollof, waakye and fried rice lunches', 'Hot lunches made fresh every day from 11am. Student meal deals from GH₵25. Order ahead in the app and skip the queue.', 'fixed', 2500, 'Opposite Hall 2', 'Message us in the app', 16 * H, 'coral', 1],
    ['lindiwe@demo.campus', 'business', 'Glow Studio: nails, lashes and facials', 'Appointments Monday to Saturday in a calm studio near Hall 5. Student discount with a valid ID. Walk-ins welcome when free.', 'fixed', 6000, 'Hall 5 annex', 'Message us in the app', 30 * H, 'rose', 2],
    ['tariq@demo.campus', 'business', 'PrintPoint: printing, binding and passport photos', 'Colour and black-and-white printing, spiral binding, lamination and passport photos while you wait. Open until 9pm on weekdays.', 'none', null, 'Library annex', 'Message us in the app', 44 * H, 'slate', 3],
    ['kofi@demo.campus', 'business', 'Campus Laundry & Ironing: pickup and delivery', 'We wash, dry and fold within 24 hours. Free pickup from any hall. Student price list in the photo.', 'fixed', 2000, 'Behind Hall 1', 'Message us in the app', 18 * H, 'teal', 3],
    ['maya@demo.campus', 'business', 'Brew & Books Cafe: student discount every weekday', 'Coffee, snacks and a quiet study corner with free Wi-Fi. Show your student card for 15 percent off.', 'none', null, 'Opposite the library', 'Message us in the app', 22 * H, 'amber', 0],
  ];
  const made = {};
  for (const [who, slug, title, description, price_type, price_cents, location, contact, age, , ] of more) {
    if (existing.has(title)) continue;
    made[title] = await create(who, slug, title, description, price_type, price_cents, location, contact, age);
  }
  // a Lost & Found item that has been returned to its owner
  const returnedTitle = 'Lost: black folding umbrella (returned)';
  if (!existing.has(returnedTitle)) {
    made[returnedTitle] = await create('maya@demo.campus', 'lost-found', returnedTitle, 'Left in lecture hall B on Tuesday. Thank you to everyone who helped. It is back with its owner.', 'none', null, 'Lecture hall B', 'Message me in the app', 72 * H, { status: 'closed', outcome: 'returned' });
  }

  /* look every listing up by title, then give it a photo and a believable view count */
  const all = await listings.recent(500);
  const byTitle = new Map(all.map((l) => [l.title, l]));
  const photoPlan = [
    ['Calculus: Early Transcendentals, 9th ed.', 'blue', 1], ['Casio fx-991EX scientific calculator', 'slate', 0], ['Room in 3-bed flat, 6 min walk from campus', 'amber', 2],
    ['Maths and Physics tutoring (first-years)', 'plum', 3], ['Robotics Club open day', 'coral', 2], ['Desk lamp and extension cord, free to a good home', 'green', 0],
    ['Lenovo ThinkPad T14, 16GB RAM', 'teal', 1], ['Organic Chemistry notes bundle', 'blue', 3],
    ...more.filter((m) => m[10] !== undefined).map((m) => [m[2], m[9], m[10]]),
  ];
  let seedRng = 7;
  const rand = (n) => { seedRng = (seedRng * 9301 + 49297) % 233280; return Math.floor((seedRng / 233280) * n); };
  for (const [title, palette, variant] of photoPlan) {
    const l = byTitle.get(title);
    if (!l) continue;
    const patch = { views: 12 + rand(180) };
    if (BUSINESS_TYPE_BY_TITLE[title]) patch.business_type = BUSINESS_TYPE_BY_TITLE[title];
    if (!(l.images || []).length && config.photosEnabled) {
      const png = await sharp(artwork(palette, variant)).png().toBuffer();
      const staged = await images.prepare({ ext: 'png', buffer: png });
      const filename = await images.save(staged.buffer, staged.ext);
      patch.images = [{ image_id: crypto.randomBytes(6).toString('hex'), filename, position: 0 }];
      patch.cover = filename;
    }
    await listings.update(l.listing_id, patch);
  }

  /* orders: promotions bought through the normal flow (manual payments), plus one still waiting for payment */
  const asUser = async (email) => users.getByEmail(email);
  const buy = async (email, title, productKey, confirm) => {
    const l = (await listings.recent(500)).find((x) => x.title === title);
    if (!l) return;
    const u = await asUser(email);
    const already = (await orders.byUser(u.user_id)).some((o) => o.listing_id === l.listing_id && o.product === productKey);
    if (already) return;
    const order = await payments.createOrder({ user: u, listing: l, productKey });
    if (confirm) await payments.fulfil(order.order_id, { by: null, provider: 'manual' });
  };
  await buy('lindiwe@demo.campus', 'Room in 3-bed flat, 6 min walk from campus', 'featured', true);
  await buy('kofi@demo.campus', 'Campus Laundry & Ironing: pickup and delivery', 'business', true);
  await buy('maya@demo.campus', 'Brew & Books Cafe: student discount every weekday', 'premium', true);
  await buy('tariq@demo.campus', 'Lenovo ThinkPad T14, 16GB RAM', 'featured', false);

  /* message threads between members (some unread) */
  const find = async (title) => (await listings.recent(500)).find((x) => x.title === title);
  const talk = async (title, starter, owner, lines) => {
    const l = await find(title);
    if (!l) return;
    const from = await asUser(starter); const to = await asUser(owner);
    const cid = messages.idFor(l.listing_id, from.user_id);
    if (await messages.forListing(l.listing_id, from.user_id)) return;
    for (const [side, body] of lines) {
      const a = side === 's' ? from : to; const b = side === 's' ? to : from;
      await messages.send({ listing: l, from: a.user_id, to: b.user_id, body, cid }); // every line belongs to the starter's thread
    }
  };
  await talk('Casio fx-991EX scientific calculator', 'maya@demo.campus', 'kofi@demo.campus', [
    ['s', 'Hi Kofi, is the calculator still available? Does it come with the cover?'],
    ['o', 'Yes, cover included. I can meet at Engineering Block C at 1pm tomorrow.'],
    ['s', 'Perfect, I will bring the cash. See you then.'],
  ]);
  await talk('Room in 3-bed flat, 6 min walk from campus', 'tariq@demo.campus', 'lindiwe@demo.campus', [
    ['s', 'Hello, is the room still free from next month? Could I see it this weekend?'],
    ['s', 'I am a final-year student and I do not smoke. Happy to share references.'],
  ]);
  await talk('Found: blue lanyard with keys', 'amara@demo.campus', 'kofi@demo.campus', [
    ['s', 'I think that lanyard is mine! There is a silver ring with a small red tag and a Hall 2 room key.'],
  ]);
  await talk('Calculus: Early Transcendentals, 9th ed.', 'kofi@demo.campus', 'amara@demo.campus', [
    ['s', 'Hi Amara, is the solutions manual definitely included? I would pick it up on Friday.'],
  ]);
  await talk('Lost: black Nike backpack with a laptop inside', 'lindiwe@demo.campus', 'kofi@demo.campus', [
    ['s', 'I saw a black Nike bag at the library desk on Tuesday morning. I think the librarians kept it.'],
    ['o', 'Thank you so much! I will go and ask them first thing tomorrow.'],
  ]);
}

module.exports = { seed, DEMO_PASSWORD };

if (require.main === module) {
  seed().then(() => process.exit(0)).catch((err) => { console.error(err.message); process.exit(1); });
}
