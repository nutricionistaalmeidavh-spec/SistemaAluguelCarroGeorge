# Runbook — perda ou roubo de celular

## Objetivo
Bloquear o aparelho perdido sem apagar dados da locadora e colocar um novo celular em operação usando apenas a cópia cloud D1/R2.

## Procedimento
1. Em um dispositivo administrativo ainda confiável, abrir o endereço oficial da PWA e acessar `/security.html`.
2. Em **Dispositivos e sessões**, localizar o aparelho perdido pelo nome/último acesso e clicar em **Revogar**. A operação marca `devices.active=0`, revoga as sessões e invalida credenciais persistentes daquele aparelho.
3. Executar **Encerrar outras sessões** quando houver dúvida sobre qual aparelho foi perdido.
4. No celular novo, instalar/abrir a PWA pelo endereço oficial e autenticar novamente. Nunca copiar cookie, token ou armazenamento do aparelho antigo.
5. Confirmar clientes, frota, locações, diárias e vistorias. Abrir pelo menos um anexo/foto para provar acesso ao R2.
6. Voltar a `/security.html` e conferir que o dispositivo antigo aparece como revogado e que o novo possui `lastSeenAt` recente.

## Critério de aceite
O aparelho antigo não autentica mais; o novo opera com dados cloud completos; nenhuma informação depende do cache do aparelho perdido.

## Se algo falhar
Não reative o aparelho antigo. Preserve o diagnóstico, valide o último backup cloud e siga `george-cloud-restore.md` apenas se houver evidência de perda/corrupção de dados.
