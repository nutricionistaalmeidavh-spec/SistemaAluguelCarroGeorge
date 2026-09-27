# Runbook — perda ou roubo de celular

## Objetivo
Bloquear o aparelho perdido sem apagar dados da locadora e colocar um novo celular em operação usando apenas a cópia cloud D1/R2.

## Procedimento
1. Em um dispositivo administrativo ainda confiável, abrir **Dispositivos** e localizar o aparelho perdido pelo nome/último acesso.
2. Revogar o dispositivo. A operação deve marcar `devices.active=0`, revogar as sessões e invalidar credenciais persistentes daquele aparelho.
3. Executar **encerrar outras sessões** quando houver dúvida sobre qual aparelho foi perdido.
4. No celular novo, instalar/abrir a PWA pelo endereço oficial e autenticar novamente. Nunca copiar cookie, token ou armazenamento do aparelho antigo.
5. Confirmar clientes, frota, locações, diárias e vistorias. Abrir pelo menos um anexo/foto para provar acesso ao R2.
6. Conferir que o dispositivo antigo aparece como revogado e que o novo possui `lastSeenAt` recente.

## Critério de aceite
O aparelho antigo não autentica mais; o novo opera com dados cloud completos; nenhuma informação depende do cache do aparelho perdido.

## Se algo falhar
Não reative o aparelho antigo. Preserve o diagnóstico, valide o último backup cloud e siga `george-cloud-restore.md` apenas se houver evidência de perda/corrupção de dados.
