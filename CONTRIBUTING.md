# Contribuir

1. Instala Node.js 22+ y npm 11+.
2. Ejecuta `npm ci`.
3. Modifica únicamente fuentes bajo `src`; `platform/chromium` es generado.
4. Añade o actualiza pruebas para cualquier cambio funcional.
5. Ejecuta `npm run verify`.

Los cambios de filtros remotos deben respetar la allowlist, límites, validación
completa y rollback definidos en `docs/FILTER_UPDATES.md`. No se aceptan
telemetría, código remoto ejecutable ni afirmaciones de rendimiento sin medición.

El código derivado debe mantener sus copyrights y licencias originales.
