export type SenderKind = "content-script" | "popup" | "dashboard" | "logger" | "extension-page";

export type MessageContract = {
    channel: string;
    what: string;
    allowedSenders: SenderKind[];
    requiresTab?: boolean;
    requiresPolicy?: boolean;
    schema?: unknown;
};

export const MESSAGE_CONTRACTS: MessageContract[] = [
    {
        channel: "contentscript",
        what: "getPagePolicy",
        allowedSenders: ["content-script"],
        requiresTab: true,
        requiresPolicy: false,
    },
    {
        channel: "contentscript",
        what: "getCosmeticSelectorsForDomain",
        allowedSenders: ["content-script"],
        requiresTab: true,
        requiresPolicy: true,
    },
    {
        channel: "contentscript",
        what: "retrieveGenericCosmeticSelectors",
        allowedSenders: ["content-script"],
        requiresTab: true,
        requiresPolicy: true,
    },
    {
        channel: "contentscript",
        what: "onDomReady",
        allowedSenders: ["content-script"],
        requiresTab: true,
        requiresPolicy: false,
    },
    {
        channel: "contentscript",
        what: "enableCSS",
        allowedSenders: ["content-script"],
        requiresTab: true,
        requiresPolicy: true,
    },
    {
        channel: "contentscript",
        what: "disableCSS",
        allowedSenders: ["content-script"],
        requiresTab: true,
        requiresPolicy: true,
    },
    {
        channel: "contentscript",
        what: "getAssetContent",
        allowedSenders: ["dashboard", "logger"],
        requiresTab: false,
        requiresPolicy: false,
    },
    {
        channel: "popup",
        what: "*",
        allowedSenders: ["popup"],
        requiresTab: true,
        requiresPolicy: false,
    },
    {
        channel: "dashboard",
        what: "*",
        allowedSenders: ["dashboard"],
        requiresTab: false,
        requiresPolicy: false,
    },
];
