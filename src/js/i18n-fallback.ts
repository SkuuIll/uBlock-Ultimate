// Simple i18n replacement for Chrome MV3 popup
(function() {
    const translations = {
        'extName': 'uBlock Ultimate',
        'popupNoPopups_v2': 'No popups',
        'popupNoLargeMedia_v2': 'No large media',
        'popupNoCosmeticFiltering_v2': 'No cosmetic',
        'popupNoRemoteFonts_v2': 'No fonts',
        'popupNoScripting_v2': 'No scripting',
        'popupBlockedOnThisPage_v2': 'Blocked on this page',
        'popupDomainsConnected_v2': 'Domains connected',
        'popupBlockedSinceInstall_v2': 'Blocked since install',
        'popupTipZapper': 'Zapper',
        'popupTipPicker': 'Picker',
        'popupTipLog': 'Log',
        'popupTipDashboard': 'Dashboard',
        'unprocessedRequestTooltip': 'Unprocessed request',
        'popupVersion': 'Version',
        'popupMoreButton_v2': 'More',
        'popupLessButton_v2': 'Less',
        'popupAnyRulePrompt': 'all',
        'popupImageRulePrompt': 'Image',
        'popup3pAnyRulePrompt': '3rd-party',
        'popupInlineScriptRulePrompt': 'Inline script',
        'popup1pScriptRulePrompt': '1st-party script',
        'popup3pScriptRulePrompt': '3rd-party script',
        'popup3pFrameRulePrompt': '3rd-party frame',
        'loggerRowFiltererBuiltinNot': 'Not',
        'loggerRowFiltererBuiltinBlocked': 'Blocked',
        'loggerRowFiltererBuiltinAllowed': 'Allowed',
        'popup3pScriptFilter': 'Script',
        'popup3pFrameFilter': 'Frame'
    };

    function applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = el.getAttribute('data-i18n');
            if (translations[key]) {
                el.textContent = translations[key];
            }
        });
        document.querySelectorAll('[data-i18n-title]').forEach((el) => {
            const key = el.getAttribute('data-i18n-title');
            if (translations[key]) {
                el.setAttribute('title', translations[key]);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyTranslations);
    } else {
        applyTranslations();
    }
})();
