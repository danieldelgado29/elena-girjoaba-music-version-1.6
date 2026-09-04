# EGP 1.6 — AISLAMIENTO TOTAL

Fecha: 2026-09-04

## Regla permanente

La copia 1.6 es un sistema independiente y congelado respecto de la .com.

### Permitido
- Repositorio: danieldelgado29/elena-girjoaba-music-version-1.6
- Firebase: egm16-respaldo-daniel-260904
- namespaces locales: egm16-* / egp16-*

### Prohibido
- Firebase fuerte: elena-girjoaba-music
- Local Core fuerte: core.elenagirjoaba.com
- Bridge de la .com
- reutilizar claves localStorage/IndexedDB de la versión fuerte

### Barreras técnicas
- Firebase projectId se valida antes de initializeApp()
- EGP Músicos 1.6 mantiene Local Core desactivado
- localStorage/sessionStorage/IndexedDB usan namespace 1.6
- service workers/caches usan namespace 1.6
