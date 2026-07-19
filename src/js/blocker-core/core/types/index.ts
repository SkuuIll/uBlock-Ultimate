// @ts-nocheck
export type ResourceType = "script" | "image" | "stylesheet" | "font" | "xmlhttprequest" | "sub_frame" | "main_frame" | "media";

export type ActionType = "block" | "allow";

export type ProfileName = "strict" | "balanced" | "relaxed" | "custom";

export type Profile = Record<ResourceType, ActionType>;

export type ScopeType = "temporary" | "permanent" | "profile" | "static";

export const RESOURCE_TYPES: ResourceType[] = [
    "script",
    "image",
    "stylesheet",
    "font",
    "xmlhttprequest",
    "sub_frame",
    "main_frame",
    "media",
];

export const RESOURCE_TYPE_TO_DNR: Record<ResourceType, ResourceType> = {
    script: "script",
    image: "image",
    stylesheet: "stylesheet",
    font: "font",
    xmlhttprequest: "xmlhttprequest",
    sub_frame: "sub_frame",
    main_frame: "main_frame",
    media: "media",
};

export const PROFILE_DEFAULTS: Record<ProfileName, Profile> = {
    strict: {
        script: "block",
        sub_frame: "block",
        xmlhttprequest: "block",
        image: "allow",
        stylesheet: "allow",
        font: "allow",
        media: "allow",
        main_frame: "allow",
    },
    balanced: {
        script: "allow",
        sub_frame: "allow",
        xmlhttprequest: "allow",
        image: "allow",
        stylesheet: "allow",
        font: "allow",
        media: "allow",
        main_frame: "allow",
    },
    relaxed: {
        script: "allow",
        sub_frame: "allow",
        xmlhttprequest: "allow",
        image: "allow",
        stylesheet: "allow",
        font: "allow",
        media: "allow",
        main_frame: "allow",
    },
    custom: {},
};

export const PRIORITY_MAP: Record<ScopeType, number> = {
    temporary: 110,
    permanent: 100,
    profile: 9,
    static: 9,
};

export const DYNAMIC_RULE_MIN = 1;
export const DYNAMIC_RULE_MAX = 999999;
export const SESSION_RULE_MIN = 1000000;
export const SESSION_RULE_MAX = 1999999;
