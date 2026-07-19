# uBlock Ultimate

uBlock Ultimate es un bloqueador de contenido para Chromium basado en Manifest V3.
Mantiene herramientas avanzadas —listas, filtros propios, reglas dinámicas, logger,
picker y zapper— con una interfaz oscura y un build reproducible.

## Estado

- Versión: `0.2.0`
- Plataforma: Chromium MV3
- Distribución actual: instalación local/descomprimida
- Telemetría: ninguna
- Licencia: GPL-3.0-only

El proyecto deriva de trabajo de uBlock Origin y de adaptaciones MV3 posteriores.
SkuuIll mantiene y diseña esta variante; los copyrights y créditos originales se
conservan en el código y en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Desarrollo

Requisitos: Node.js 22 o posterior y npm 11 o posterior.

```sh
npm ci
npm run verify
```

Comandos principales:

- `npm run build`: genera `platform/chromium` desde `src`.
- `npm run dev`: genera una variante de desarrollo con sourcemaps.
- `npm test`: ejecuta pruebas unitarias y de integración.
- `npm run test:e2e`: carga la extensión con Playwright.
- `npm run audit`: valida manifiesto, entrypoints, locales y limpieza.
- `npm run package`: crea el ZIP local en `dist/release`.

No se deben editar archivos dentro de `platform/chromium`: esa carpeta es una
salida descartable del build.

## Instalación local

1. Ejecutar `npm ci` y `npm run build`.
2. Abrir `chrome://extensions`.
3. Activar el modo de desarrollador.
4. Elegir **Cargar descomprimida**.
5. Seleccionar `platform/chromium`.

Las listas DNR grandes se actualizan al reconstruir la extensión. Quick-fixes
suplementarios pueden comprobarse al instalar o iniciar Chromium; una descarga
inválida nunca reemplaza las últimas reglas válidas.

## Rendimiento y afirmaciones

El proyecto registra tamaño, tiempos y regresiones con pruebas reproducibles.
No se afirma superioridad frente a otros bloqueadores sin publicar el entorno,
el corpus y los resultados correspondientes.
