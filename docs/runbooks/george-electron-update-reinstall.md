# Runbook — atualização ou reinstalação do Electron

## Antes
1. Executar diagnóstico operacional e registrar app/schema/cursor.
2. Criar backup local verificado e anotar o diretório do backup.
3. Confirmar que existe backup cloud válido recente.

## Atualização normal
Instalar a nova versão sobre a anterior. O instalador não deve reutilizar dados de outro produto Artisys. Abrir o app, executar migrations, sincronização e verificar backup/anexos.

## Reinstalação mantendo dados
Preservar explicitamente o `userData` **Sistema Locadora George**. Reinstalar e confirmar que o SQLite abre, migrations são idempotentes e o agente continua do cursor persistido.

## Reinstalação com limpeza total
Só apagar `userData` após confirmar backup cloud válido. Depois seguir `george-pc-rebuild.md`; não copiar arquivos SQLite parciais ou WAL isolados.

## Critério de aceite
Instalador inicia, app/schema estão corretos, dados permanecem íntegros ou são reconstruídos pela cloud, anexos verificam SHA-256 e um novo backup local é criado.
