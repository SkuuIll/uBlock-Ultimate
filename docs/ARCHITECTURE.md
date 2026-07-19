# Arquitectura

`src/extension` contiene los archivos estáticos y el entrypoint del service
worker. `src/js`, `src/core` y `src/runtime` contienen módulos TypeScript que
generan los bundles de interfaz y contenido.

`build.mjs` valida la fuente estática, crea un staging limpio, compila únicamente
entrypoints con consumidores y reemplaza atómicamente `platform/chromium`.

`platform/chromium` y `dist` son descartables. La primera es la extensión que se
carga en Chromium; la segunda contiene staging, sourcemaps de desarrollo y ZIPs.

Los controles de `protections.html` sólo pueden modificar el allowlist interno
de rulesets opcionales declarado por el service worker. La UI consulta
`getEnabledRulesets()` y `getAvailableStaticRuleCount()`; no acepta rutas, reglas
ni identificadores arbitrarios desde mensajes.

Las pruebas E2E copian `platform/chromium` a un perfil temporal antes de cargarla.
Esto aísla el almacenamiento de prueba y evita que los índices `_metadata`
creados por Chromium entren en el build o en el paquete reproducible.
