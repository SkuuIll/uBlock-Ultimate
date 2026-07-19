# Esquema de almacenamiento

La versión actual es `storageSchemaVersion = 2`.

| Clave | Tipo | Uso |
|---|---|---|
| `whitelist` | `string` | Lista canónica de sitios permitidos |
| `netWhitelist` | `string` | Alias compatible de `whitelist` |
| `userFilters` | `string` | Filtros propios canónicos |
| `user-filters` | `string` | Alias compatible de `userFilters` |
| `filterUpdateStateV2` | `Record<string, FilterUpdateState>` | Estado y procedencia de actualizaciones |

La migración v1→v2 conserva ambos alias para que las interfaces heredadas sigan
funcionando. Es idempotente y no borra claves desconocidas.
