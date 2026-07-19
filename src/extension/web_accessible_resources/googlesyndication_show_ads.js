/*
 * Local surrogate for the retired pagead/show_ads.js endpoint.
 *
 * Legacy AdSense integrations synchronously use the height of the script's
 * parent as a blocking signal. A hidden 1px frame preserves that layout
 * contract without making a network request or rendering an advert.
 */

(() => {
    const parent = document.currentScript?.parentElement;
    if ( parent === null || parent === undefined ) { return; }

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = [
        'border:0',
        'display:block',
        'height:1px',
        'visibility:hidden',
        'width:1px',
    ].join(';');
    parent.insertBefore(frame, document.currentScript.nextSibling);
})();
