# uBlock Ultimate

[![Build and release](https://github.com/SkuuIll/uBlock-Ultimate/actions/workflows/release.yml/badge.svg)](https://github.com/SkuuIll/uBlock-Ultimate/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/SkuuIll/uBlock-Ultimate?include_prereleases&label=release)](https://github.com/SkuuIll/uBlock-Ultimate/releases/latest)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-7c3aed)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![License GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-64748b)](LICENSE.txt)

uBlock Ultimate es un bloqueador de contenido Manifest V3 para Chromium,
Firefox Desktop y Firefox para Android.
Mantiene herramientas avanzadas —listas, filtros propios, reglas dinámicas, logger,
picker y zapper— con una interfaz oscura y un build reproducible.

> Proyecto independiente mantenido por SkuuIll y basado en el trabajo de
> [uBlock Origin](https://github.com/gorhill/uBlock). No existe afiliación oficial.

## Descargas

La versión verificada más reciente se encuentra en
[GitHub Releases](https://github.com/SkuuIll/uBlock-Ultimate/releases/latest):

- **Chrome / Chromium MV3:** `uBlock-Ultimate-<versión>-chromium.zip`
- **Firefox Desktop / Android:** `uBlock-Ultimate-<versión>-firefox.zip`

Los paquetes publicados contienen solamente la extensión instalable. El código
fuente, las pruebas, las herramientas de desarrollo y las dependencias no se
incluyen dentro de esos ZIP.

## Estado

- Versión: `0.2.0`
- Plataformas: Chromium 120+, Firefox Desktop 140+ y Firefox Android 142+
- Distribución actual: build local; Firefox requiere firma de Mozilla para una
  instalación permanente
- Telemetría: ninguna
- Licencia: GPL-3.0-only

## Créditos y procedencia

uBlock Ultimate es un trabajo derivado de
[uBlock Origin](https://github.com/gorhill/uBlock), creado y mantenido por
Raymond Hill (`gorhill`) junto con sus colaboradores. Su arquitectura de
bloqueo, código de filtrado y bases de interfaz constituyen una parte fundamental
del trabajo heredado por este proyecto.

SkuuIll mantiene y diseña esta variante independiente, pero no
reclama autoría sobre el código de uBlock Origin ni representa una afiliación
oficial con su proyecto. Se conservan GPL-3.0, los encabezados de copyright y los
créditos correspondientes. Los detalles adicionales están documentados en
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Desarrollo

Requisitos: Node.js 22 o posterior y npm 11 o posterior.

```sh
npm ci
npm run verify
```

Comandos principales:

- `npm run build`: genera `platform/chromium` y `platform/firefox` desde `src`.
- `npm run build:chromium` / `npm run build:firefox`: genera un solo destino.
- `npm run dev`: genera una variante de desarrollo con sourcemaps.
- `npm test`: ejecuta pruebas unitarias y de integración.
- `npm run test:e2e`: carga la extensión con Playwright.
- `npm run lint:firefox`: valida la salida con el linter oficial de Mozilla.
- `npm run audit`: valida ambos manifiestos, entrypoints, locales y limpieza.
- `npm run package`: crea ZIP separados de Chromium y Firefox reproducibles en
  `dist/release`.

No se deben editar archivos dentro de `platform/chromium` ni
`platform/firefox`: son salidas descartables del build.

La prueba E2E carga una copia temporal de la extensión para impedir que Chromium
contamine la salida con su carpeta `_metadata`. Chrome y Edge oficiales ya no
admiten los flags de carga lateral usados por automatización; para E2E se puede
instalar Chromium de Playwright con `npx playwright install chromium` o definir
`CHROME_PATH` hacia un Chromium compatible.

## Instalación local en Chromium

1. Ejecutar `npm ci` y `npm run build`.
2. Abrir `chrome://extensions`.
3. Activar el modo de desarrollador.
4. Elegir **Cargar descomprimida**.
5. Seleccionar `platform/chromium`.

Las listas DNR grandes se actualizan al reconstruir la extensión. Quick-fixes
suplementarios pueden comprobarse al instalar o iniciar Chromium; una descarga
inválida nunca reemplaza las últimas reglas válidas.

Chrome para Android no admite extensiones. El botón **Agregar al escritorio**
que muestra Chrome móvil solamente agenda la instalación en una computadora.
Para móviles compatibles, usar Firefox para Android.

## Firefox Desktop y Android

1. Ejecutar `npm ci`, `npm run package` y `npm run lint:firefox`.
2. Para una prueba temporal en Firefox Desktop, abrir `about:debugging`,
   elegir **Este Firefox**, **Cargar complemento temporal** y seleccionar
   `platform/firefox/manifest.json`.
3. Para una instalación permanente en Firefox Desktop o Android, enviar
   `dist/release/uBlock-Ultimate-0.2.0-firefox.zip` a Mozilla Add-ons para
   firma, ya sea como publicación pública o distribución propia.
4. Una vez firmado, instalarlo desde Mozilla Add-ons. En Android se administra
   desde **Complementos** dentro de Firefox.

El manifiesto Firefox declara explícitamente soporte Android, ausencia de
telemetría y de transmisión de datos. La interfaz usa controles táctiles de
44–48 px, paneles sin ancho fijo y navegación adaptable para pantallas desde
320 px.

## Builds y Releases automáticos

Cada push o pull request sobre `main` ejecuta validaciones y crea dos artefactos
independientes:

- `uBlock-Ultimate-<versión>-chromium.zip`
- `uBlock-Ultimate-<versión>-firefox.zip`

Los push directos a `main` actualizan automáticamente el Release normal
**uBlock Ultimate <versión> - Latest** bajo el tag móvil `continuous` y lo
marcan como la versión más reciente. Los tags de versión,
por ejemplo `v0.2.1`, crean un Release versionado y deben coincidir con la
versión declarada en `package.json`.

Para que un Release versionado incluya además el XPI Firefox instalable, se
deben configurar los secretos de GitHub Actions `AMO_JWT_ISSUER` y
`AMO_JWT_SECRET`. Sin esos secretos, el workflow publica el ZIP validado listo
para enviar a Mozilla, pero no simula una firma inexistente.

## Protecciones opcionales

La pestaña **Protección** permite activar y desactivar rulesets DNR empaquetados
sin reiniciar el navegador. Incluye:

- limpieza de parámetros de campañas en navegaciones principales;
- bloqueo opcional de píxeles sociales de terceros;
- protección contra anuncios de video;
- capas ampliadas de malware, privacidad y filtros principales;
- reparaciones de compatibilidad para sitios afectados por filtrado estricto.

La interfaz consulta la capacidad estática disponible de Chrome antes de mostrar
el estado. Los cambios se aplican con `updateEnabledRulesets`, se conservan entre
sesiones y Chrome rechaza atómicamente cualquier activación que exceda su cuota.

## Rendimiento y afirmaciones

El proyecto registra tamaño, tiempos y regresiones con pruebas reproducibles.
No se afirma superioridad frente a otros bloqueadores sin publicar el entorno,
el corpus y los resultados correspondientes.
