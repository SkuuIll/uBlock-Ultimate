# Privacidad

uBlock Ultimate no incorpora telemetría, publicidad, cuentas ni analítica.

La extensión procesa localmente URLs, pestañas y solicitudes para aplicar reglas
de bloqueo, mostrar el logger y ejecutar las herramientas elegidas por el usuario.
La configuración, los filtros propios, la whitelist, las reglas y los metadatos
de actualización se guardan mediante `chrome.storage.local`.

Al instalar o iniciar Chromium, la extensión puede realizar solicitudes HTTPS a
los proveedores declarados de listas suplementarias. Esas solicitudes descargan
datos de filtros; no incluyen historial, contenido de páginas ni identificadores
creados por uBlock Ultimate. Si una fuente falla, se conserva la versión local
anterior.

No se vende, comparte ni transmite información del usuario a SkuuIll.
