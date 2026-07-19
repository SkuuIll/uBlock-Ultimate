# AGENTS.md

## Canonical architecture

- Browser target: Chromium Manifest V3.
- Static extension source: `src/extension/`.
- TypeScript application source: `src/js/`, `src/core/` and `src/runtime/`.
- Service-worker entrypoint: `src/extension/js/sw-entry.ts`.
- Generated unpacked extension: `platform/chromium/`.
- Generated packages and reports: `dist/`.

Never edit `platform/chromium` directly. `npm run build` deletes and recreates it.

## Source and generated boundaries

- Files ending in `*-bundle.js` are generated from TypeScript entrypoints.
- `platform/chromium/js/sw.js` is generated from `src/extension/js/sw-entry.ts`.
- DNR diagnostics, source maps and budget reports belong in `dist`, never in the
  static source or production package.
- Only these locales are supported: `de`, `en`, `es`, `fr`, `hi`, `it`, `ja`,
  `pt_BR`, `pt_PT`, `ru`, `zh_CN`, `zh_TW`.
- Preserve GPL headers and third-party attribution when modifying derived code.

## Required verification

Run:

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. `npm run build`
5. `npm run audit`

Run `npm run test:e2e` when a Chromium binary is available. Run
`npm run package` for the final local ZIP.

## Runtime rules

- Do not fetch or execute remote JavaScript.
- Remote filter data must use HTTPS, an allowlisted host, strict size/time limits
  and complete validation before installation.
- Never silently truncate a remote list.
- Keep large lists in packaged static DNR rulesets.
- Preserve the last known-good dynamic rules when an update fails.
- Do not add telemetry.
