if (!(() => {
    try {
        const host = location.hostname.toLowerCase();
        return host === "youtube.com" || host.endsWith(".youtube.com") ||
            host === "youtu.be" || host.endsWith(".youtu.be") ||
            host === "suno.com" || host.endsWith(".suno.com") ||
            host === "yandex.com" || host.endsWith(".yandex.com") ||
            host === "yandex.ru" || host.endsWith(".yandex.ru");
    } catch (e) {
        return false;
    }
})()) {
const NOOP = function(){};
const EMPTY_STR = "";

function setConst(name, value) {
    try { window[name] = value; } catch (e) { console.warn('[uBlock Ultimate] ad-block: setConst failed', name, e); }
}

function setCstArr(name) {
    try { window[name] = []; } catch (e) { console.warn('[uBlock Ultimate] ad-block: setCstArr failed', name, e); }
}

function setCstObj(name) {
    setConst(name, {});
}

function setNoop(name) {
    setConst(name, NOOP);
}

function setStr(name) {
    setConst(name, EMPTY_STR);
}

// Google Adsense / AdSense
setCstArr("google_ad_break");
setCstObj("google_ad_holder");
setCstObj("google_ad_block");
setCstObj("google_ad_frame");
setCstObj("google_ad_iframe");
setCstObj("google_ad_container");
setCstObj("google_ad_wrapper");
setCstArr("google_ad_divs");
setStr("google_ad_client");
setStr("google_ad_host");
setStr("google_ad_slot");
setConst("google_ad_width", 0);
setConst("google_ad_height", 0);
setStr("google_adtest");
setConst("google_adsense_settings", void 0);
setConst("__google_ad", void 0);
setStr("__google_ad_url");
setStr("google_ad_region");
setStr("google_ad_output");
setStr("google_ad_type");
setStr("google_ad_format");
setConst("google_ad_js", void 0);
setStr("google_ad_channel");
setStr("google_ad_section");

// Google Ad Manager / GPT

// Google Analytics / Tag Manager
setConst("gaGlobal", void 0);
setStr("GoogleAnalyticsObject");
setConst("google_tag_data", void 0);
setConst("googletagmanager", void 0);
setConst("_gaq", void 0);
setConst("_ga", void 0);
setConst("_gat", void 0);
setConst("_gid", void 0);
setConst("_gaUserPrefs", void 0);
setConst("google_conversion", void 0);
setConst("google_conversion_id", 0);
setStr("google_conversion_label");
setConst("google_conversion_value", 0);
setStr("google_conversion_currency");
setConst("google_remarketing", void 0);
setConst("google_remarketing_only", false);
setConst("_gac", void 0);

// Google Ads API / DFP
setConst("gptad", void 0);
setConst("dfpAd", void 0);
setConst("_AdSense", void 0);

// Facebook / Meta
setNoop("fbq");
setConst("_fbq", void 0);
setConst("_fbp", void 0);
setConst("_fbc", void 0);

// Twitter / X
setNoop("twq");
setNoop("ttq");

// TikTok
setNoop("tiktok");
setNoop("snaptr");
setConst("snap", void 0);
setConst("Snap", void 0);
setConst("_scs", void 0);
setConst("_scq", void 0);

// Pinterest
setNoop("pintrk");
setCstArr("_pinterest");
setConst("pinterest", void 0);

// LinkedIn
setNoop("lintrk");
setStr("_linkedin_partner_id");
setStr("_linkedin_data_partner_id");

// Reddit
setNoop("rdt");

// Quora
setNoop("qevents");

// Amazon
setCstArr("amzn_ads");
setConst("amzn_assoc", void 0);
setConst("AmazonAd", void 0);
setCstArr("_amzn_ads");
setCstArr("amazon_ads");

// Yandex
setConst("yandex_metrika", void 0);
setConst("yaCounter", void 0);
setConst("yandex_ad", void 0);
setConst("Ya", void 0);
setConst("Yandex", void 0);
setConst("adfox", void 0);
setCstArr("yandex_metrika_callbacks");
setConst("__ym", void 0);
setConst("ym", void 0);
setConst("_ym", void 0);


// Hotjar
setConst("hotjar", void 0);
setConst("hjs", void 0);
setConst("_hj", void 0);
setConst("hj", void 0);
setConst("_hjSettings", void 0);
setConst("_hjAbsoluteSessionInProgress", void 0);
setConst("_hjFirstSeen", void 0);
setConst("_hjIncludedInPageviewSample", void 0);
setConst("_hjIncludedInSessionSample", void 0);
setConst("_hjSession", void 0);
setConst("_hjSessionUser", void 0);
setConst("_hjTLDTest", void 0);
setConst("_hjUserAttributes", void 0);
setConst("_hjRecording", void 0);
setConst("_hjRecordingLastActivity", void 0);
setConst("_hjSessionResumed", void 0);


// Mouseflow
setNoop("mouseflow");
setCstArr("_mfq");

// Lucky Orange
setConst("luckyorange", void 0);
setConst("_learnq", void 0);

// Heap
setConst("heap", void 0);
setConst("Heap", void 0);

// FullStory
setNoop("FS");
setConst("fullstory", void 0);

// Amplitude
setNoop("amplitude");

// Mixpanel
setNoop("mixpanel");

// Bugsnag
setConst("bugsnag", void 0);
setConst("Bugsnag", void 0);

// Rollbar
setConst("Rollbar", void 0);
setConst("rollbar", void 0);

// New Relic
setConst("newrelic", void 0);
setConst("NREUM", void 0);

// Datadog
setConst("datadog", void 0);
setConst("DD_RUM", void 0);
setConst("DD_LOGS", void 0);

// Optimizely
setConst("optimizely", void 0);
setConst("optimizelyDatafile", void 0);

// Freshmarketer
setConst("freshmarketer", void 0);
setConst("_conv_page", void 0);
setConst("_conv_q", void 0);
setConst("_conv_s", void 0);

// HubSpot
setConst("_hsq", void 0);
setConst("hbspt", void 0);

// Intercom
setConst("intercom", void 0);
setConst("Intercom", void 0);

// Drift
setConst("drift", void 0);
setConst("Drift", void 0);

// Matomo / Piwik
setCstArr("_paq");
setConst("_pk", void 0);
setConst("_pk_id", void 0);
setConst("_pk_ref", void 0);
setConst("_pk_ses", void 0);

// Segment
setConst("analytics", void 0);

// RudderStack
setConst("rudderanalytics", void 0);
setConst("rudderstack", void 0);

// Adobe Analytics / Omniture
setConst("s", void 0);
setConst("s_account", void 0);
setConst("AppMeasurement", void 0);
setConst("_satellite", void 0);

// Snowplow
setConst("_snowplow", void 0);
setConst("snowplow", void 0);

// Prebid
setNoop("pbjs");
setConst("prebid", void 0);

// AppNexus
setConst("AppNexus", void 0);
setConst("appnexus", void 0);

// GDPR / CMP
setConst("__tcfapi", void 0);
setConst("__gpp", void 0);
setConst("__uspapi", void 0);
setConst("cookieConsent", void 0);
setConst("__admrl", void 0);

// Others
setConst("_AdsBot", void 0);
setConst("_adftrack", void 0);
setConst("_adf", void 0);
setConst("_adr", void 0);
setConst("_ads", void 0);
setConst("aiptag", void 0);
setConst("AdsNext", void 0);
setConst("adbl_det", void 0);
setConst("admiral", void 0);
setConst("_sul", void 0);
setConst("sdid", void 0);
setConst("__ATA", void 0);
setConst("_mNConfig", void 0);
setConst("mNConfig", void 0);
setConst("adsPool", void 0);
setConst("_AdProvider", void 0);
setConst("AdProvider", void 0);
setConst("pageAds", void 0);
setConst("omni", void 0);
setConst("s_objectID", void 0);
setConst("omniture", void 0);
setConst("AMCV_", void 0);
setConst("adobe", void 0);
setConst("_adobe", void 0);
setConst("_elq", void 0);
setConst("Eloqua", void 0);
setConst("_tr", void 0);
setConst("tr", void 0);
setConst("_gu", void 0);
setConst("_gAPI", void 0);
setConst("_gapi", void 0);
setConst("__gapi", void 0);
setConst("hubspot", void 0);
setConst("futy", void 0);
setConst("futy_ad", void 0);
setConst("_fw_", void 0);
setConst("FW", void 0);
setConst("_clarity", void 0);
setConst("clarity", void 0);
setConst("_clc", void 0);
setConst("_clsk", void 0);
setConst("_ra", void 0);
setConst("_rax", void 0);
setConst("_ds_", void 0);
setConst("aws", void 0);
setConst("AWS", void 0);
setConst("_segment", void 0);
}
