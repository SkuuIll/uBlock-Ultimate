# Actualización híbrida de filtros

Las listas grandes permanecen como rulesets DNR estáticos y se actualizan al
reconstruir la extensión.

Al instalar y en cada evento real `runtime.onStartup`, el runtime consulta
quick-fixes suplementarios. No realiza esa consulta al reactivarse el service
worker.

El descriptor define fuentes HTTPS y hosts permitidos. Cada respuesta tiene un
timeout de 15 segundos y un máximo de 10 MiB. Se usan `ETag` y `Last-Modified`.
La lista completa debe compilar dentro del rango dinámico reservado; una regla
de red no soportada, una lista vacía o una cuota insuficiente cancela la
actualización. Las reglas instaladas anteriormente permanecen intactas.
