# Arquitectura

`src/extension` contiene los archivos estáticos y el entrypoint del service
worker. `src/js`, `src/core` y `src/runtime` contienen módulos TypeScript que
generan los bundles de interfaz y contenido.

`build.mjs` valida la fuente estática, crea un staging limpio, compila únicamente
entrypoints con consumidores y reemplaza atómicamente `platform/chromium`.

`platform/chromium` y `dist` son descartables. La primera es la extensión que se
carga en Chromium; la segunda contiene staging, sourcemaps de desarrollo y ZIPs.
