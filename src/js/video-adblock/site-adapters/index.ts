import { aggressiveVideoGenericAdapter } from "./aggressive-video-generic";
import { genericHtml5Adapter } from "./generic-html5";
import { youtubeAdapter } from "./youtube";
import { genericPrerollSkipperAdapter } from "./generic-preroll-skipper";
import { rutubeYandexVasAdapter } from "./rutube-yandex-vas";
import { embedPlayerVideojsVastAdapter } from "./embed-player-videojs-vast";
import { jwplayerVastAdapter } from "./jwplayer-vast";
import { ktPlayerAdAdapter } from "./kt-player-ad";
import type { VideoSiteAdapter } from "./adapter-types";

export const VIDEO_SITE_ADAPTERS: VideoSiteAdapter[] = [
    youtubeAdapter,
    rutubeYandexVasAdapter,
    embedPlayerVideojsVastAdapter,
    jwplayerVastAdapter,
    ktPlayerAdAdapter,
    genericPrerollSkipperAdapter,
    aggressiveVideoGenericAdapter,
    genericHtml5Adapter,
];

function isGenericAdapter(adapter: VideoSiteAdapter): boolean {
    return adapter.domains.includes("*");
}

export function selectVideoSiteAdapters(hostname: string): VideoSiteAdapter[] {
    const host = hostname.toLowerCase();
    const matching = VIDEO_SITE_ADAPTERS.filter((adapter) => adapter.matches(host));

    const siteSpecific = matching.filter((adapter) => !isGenericAdapter(adapter));
    if (siteSpecific.length > 0) {
        return siteSpecific;
    }

    return matching;
}
