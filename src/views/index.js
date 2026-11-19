'use strict';
const pub = require('./pages/public');
const account = require('./pages/account');
const admin = require('./pages/admin');
const system = require('./pages/system');
const legal = require('./pages/legal');
const msgPages = require('./pages/messages');
const assistantPages = require('./pages/assistant');
const payPages = require('./pages/payments');

/** Registry used by res.render(name, data). */
const views = {
  error: pub.errorPage,
  home: pub.home,
  browse: pub.browse,
  businessPage: pub.businessPage,
  lostFoundPage: pub.lostFoundPage,
  listingDetail: pub.listingDetail,
  rules: pub.rules,
  legalHub: legal.legalHub,
  privacy: legal.privacy,
  terms: legal.terms,
  cookies: legal.cookies,
  moderation: legal.moderation,
  copyright: legal.copyright,
  dataProtection: legal.dataProtection,
  businessTerms: legal.businessTerms,
  refunds: legal.refunds,
  disclaimer: legal.disclaimer,
  login: account.login,
  register: account.register,
  forgot: account.forgot,
  resetPassword: account.resetPassword,
  listingForm: account.listingForm,
  myListings: account.myListings,
  profile: account.profile,
  publicProfile: account.publicProfile,
  reportForm: account.reportForm,
  notifications: account.notifications,
  assistant: assistantPages.assistantPage,
  pricing: payPages.pricing,
  saved: account.saved,
  alerts: account.alertsPage,
  promote: payPages.promote,
  orderDetail: payPages.orderDetail,
  myOrders: payPages.myOrders,
  adminOrders: payPages.adminOrders,
  messageInbox: msgPages.messageInbox,
  messageThread: msgPages.messageThread,
  helpCentre: msgPages.helpCentre,
  adminHelp: msgPages.adminHelp,
  adminHelpThread: msgPages.adminHelpThread,
  adminLogin: admin.adminLogin,
  adminDashboard: admin.dashboard,
  adminReports: admin.reportsList,
  adminReport: admin.reportDetail,
  adminListings: admin.adminListings,
  adminUsers: admin.adminUsers,
  adminUser: admin.adminUserDetail,
  adminCategories: admin.adminCategories,
  adminAudit: admin.adminAudit,
  adminSystem: system.systemPage,
  adminInsights: require('./pages/insights').insightsPage,
  adminSignals: admin.adminSignals,
  adminUpdates: admin.adminUpdates,
  adminErrors: admin.adminErrors,
  whatsNew: require('./pages/whatsNew').whatsNewPage,
  getApp: require('./pages/getApp').getApp,
  listingPoster: require('./pages/posters').listingPoster,
  launchKit: require('./pages/posters').launchKit,
  twoFactorSetup: require('./pages/twofactor').twoFactorSetup,
  twoFactorCodes: require('./pages/twofactor').twoFactorCodes,
  twoFactorStatus: require('./pages/twofactor').twoFactorStatus,
  maintenance: pub.maintenancePage,
};

function renderMiddleware(req, res, next) {
  res.render = async function render(name, data = {}) {
    try {
      const fn = views[name];
      try { req.navCats = await require('../repo/categories').active(); } catch (_) { req.navCats = []; } // cached for a minute
      if (!fn) throw new Error(`Unknown view: ${name}`);
      const out = fn(req, data);
      if (req.persistSession) await req.persistSession();
      this.set('Cache-Control', 'private, no-store'); // pages are personalised; never cache them
      this.type('html').send(out);
    } catch (err) {
      console.error('[render]', name, err);
      if (!this.headersSent) this.status(500).type('html').send('<!doctype html><meta charset="utf-8"><title>Error</title><h1>Something went wrong</h1><p>Please try again.</p>');
    }
  };
  next();
}

module.exports = { renderMiddleware };
