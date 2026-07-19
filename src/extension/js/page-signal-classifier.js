export const PAGE_PROFILE = Object.freeze({
  AUTH_SENSITIVE: "auth-sensitive",
  PAYMENT_SENSITIVE: "payment-sensitive",
  APP_SHELL: "app-shell",
  DEFAULT_WEB: "default-web",
  TRUSTED_OFF: "trusted-off",
  VIDEO_SITE: "video-site",
});

export function classifyPageProfile(pageSignals) {
  const signals = pageSignals || {};
  const hasAuthForm = signals.hasAuthForm === true;
  const hasPaymentForm = signals.hasPaymentForm === true;
  const hasContentEditable = signals.hasContentEditable === true;
  const hasLargeAppRoot = signals.hasLargeAppRoot === true;
  const hasPrimaryVideo = signals.isVideoPage === true || signals.hasPrimaryVideo === true;

  if (hasAuthForm) return PAGE_PROFILE.AUTH_SENSITIVE;
  if (hasPaymentForm) return PAGE_PROFILE.PAYMENT_SENSITIVE;
  if (hasPrimaryVideo) return PAGE_PROFILE.VIDEO_SITE;
  if (hasContentEditable || hasLargeAppRoot) return PAGE_PROFILE.APP_SHELL;

  return null;
}

export function classifyFirstKnownProfile(pageSignals, hasKnownFilterSupport, hasEstablishedSupport) {
  const fromSignals = classifyPageProfile(pageSignals);
  if (fromSignals) return fromSignals;

  // Articles with no auth/payment/app/video signals get default-web
  if (pageSignals && pageSignals.isArticle === true) return PAGE_PROFILE.DEFAULT_WEB;

  if (hasKnownFilterSupport || hasEstablishedSupport) {
    return PAGE_PROFILE.DEFAULT_WEB;
  }

  return null;
}
