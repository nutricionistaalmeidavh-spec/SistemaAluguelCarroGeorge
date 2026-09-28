# Runbook — verificação periódica de backups

## Frequência
Verificação automática diária do backup local e, no mínimo, um restore de prova mensal em ambiente descartável.

## Backup local
1. Confirmar retenção de até 7 pontos diários, 4 semanais e 12 mensais.
2. Para o ponto mais recente, validar `manifest.json`, marcador `VALID`, presença do SQLite e hashes SHA-256 de todos os anexos.
3. Backup com arquivo ausente/hash divergente é inválido e não entra como ponto restaurável.

## Backup cloud
1. Confirmar registro `cloud_backups.status=valid`.
2. Baixar/ler o manifest e comparar `manifest_sha256`.
3. Verificar hashes de todos os chunks antes de considerar o ponto utilizável. Manifest ausente/incompleto significa backup inválido.

## Restore de prova mensal
Usar ambiente descartável, restaurar o ponto selecionado e conferir contagens de clientes, veículos, locações, pagamentos e anexos. Abrir amostra de anexos e comparar SHA-256. Não executar teste destrutivo na instalação de produção.

## Evidência
Registrar data, ID do backup, geração, resultado dos hashes, contagens básicas e versão/schema usados no teste.
