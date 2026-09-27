# Cobrança diária — fases 0 a 4

## Objetivo

Integrar o recebimento por diária diretamente ao fluxo de locação já existente, reutilizando `billingPlans`, `billingInstallments`, `ledger`, auditoria, RBAC, SQLite/local-first e sync PC↔Mobile. O escopo desta branch cobre as fases 0 a 4 do roadmap aprovado.

## Estado de partida

A `main` já possui:
- criação de locação com `dailyRate`, `days`, `total` e recebível principal;
- planos de cobrança recorrente com frequência `daily`;
- parcelas (`billingInstallments`) com pagamento parcial;
- ledger com `receivable` e `billing_receivable`;
- inadimplência, alertas, contratos, auditoria e RBAC;
- persistência local e sync PC↔Mobile;
- QA/e2e/release gates.

O principal risco atual é a dupla contabilização caso uma locação de R$ 1.000 mantenha seu `receivable` de R$ 1.000 e seja decomposta em 10 `billing_receivable` de R$ 100 que também entrem na receita consolidada.

## Fase 0 — autoridade financeira sem dupla contabilização

Adicionar ao plano de cobrança uma finalidade explícita:

- `purpose: 'rental_schedule'` — parcelas são decomposição do recebível da locação;
- `purpose: 'additional'` — cobrança realmente adicional, mantendo o comportamento atual.

Para `rental_schedule`, o resumo financeiro deve contar a receita da locação uma única vez. As parcelas continuam sendo a superfície operacional de vencimento e recebimento, mas não somam nova receita sobre o `receivable` pai.

### Critérios de aceite

- locação de 10 × R$ 100 continua com receita prevista de R$ 1.000 após gerar 10 parcelas diárias;
- planos `additional` continuam somando receita adicional;
- pagamentos de parcelas do `rental_schedule` refletem corretamente no caixa sem duplicar recebimento;
- nenhuma regressão nos planos mensais/semanais existentes.

### Teste de fluxo obrigatório

Criar locação de R$ 1.000 → criar plano diário `rental_schedule` de 10 × R$ 100 → verificar:
- receita prevista = R$ 1.000;
- saldo aberto inicial = R$ 1.000;
- número de parcelas = 10;
- nenhum valor dobrado no ledger consolidado.

## Fase 1 — cobrança diária integrada à criação da locação

A tela `Nova reserva` deve permitir escolher:
- `Receber valor total`;
- `Receber por diária`.

Ao escolher `Receber por diária`, a criação da locação deve também criar, na mesma operação de domínio, um plano `purpose: 'rental_schedule'`, `frequency: 'daily'`, com:
- `amount = rental.dailyRate`;
- `occurrences = rental.days`;
- `firstDueAt = data da retirada`.

A criação não pode deixar locação sem plano nem plano sem locação se houver erro no meio do fluxo.

### Critérios de aceite

- uma reserva diária cria locação + plano + parcelas + entradas necessárias de ledger + auditoria;
- modo `valor total` preserva o comportamento anterior;
- conflito de reserva ou validação inválida não deixa artefatos financeiros órfãos.

### Teste de fluxo obrigatório

Criar reserva de 5 dias a R$ 100 no modo diário → verificar uma locação de R$ 500 e cinco parcelas de R$ 100 com datas consecutivas.

## Fase 2 — UX de controle de diárias

Reutilizar `billingInstallments` como fonte de verdade. Não criar uma segunda entidade `RentalDailyCharge`.

Para planos `frequency: 'daily'` + `purpose: 'rental_schedule'`, a interface deve apresentar linguagem de locadora:
- “Controle de diárias”;
- data de cada diária;
- valor;
- pago;
- saldo;
- status `Pago`, `Parcial`, `Pendente` ou `Atrasado`;
- resumo com diárias totais, pagas, pendentes, recebido e a receber.

A tela genérica de Cobranças continua existindo para demais recorrências.

### Critérios de aceite

- usuário identifica rapidamente quais diárias foram pagas;
- status é derivado das parcelas existentes, não duplicado em outro armazenamento;
- usuários sem `billing.read` não obtêm acesso indireto aos detalhes financeiros.

### Teste de fluxo obrigatório

Com 5 parcelas e 2 pagas, renderizar o controle e verificar 5 diárias, 2 pagas, 3 pendentes, R$ 200 recebido e R$ 300 a receber.

## Fase 3 — receber próxima diária

Adicionar ação rápida `Receber diária` para localizar a primeira parcela diária não quitada do plano da locação.

O modal deve permitir:
- forma de pagamento;
- valor, pré-preenchido com o saldo da próxima diária;
- confirmação.

Internamente deve reutilizar `recordInstallmentPayment` ou uma função de domínio composta que mantenha a locação sincronizada.

### Critérios de aceite

- um clique abre a próxima diária pendente correta;
- pagamento parcial continua permitido;
- após quitação, a próxima parcela passa a ser a próxima diária;
- ação exige permissão de escrita financeira/cobrança apropriada.

### Teste de fluxo obrigatório

Cinco diárias → quitar as duas primeiras → ação “próxima diária” deve apontar para a terceira → receber R$ 100 → terceira fica paga e a quarta passa a ser a próxima.

## Fase 4 — unificar pagamento da diária, locação e ledger

Para planos `rental_schedule`, pagamentos das parcelas devem atualizar a visão agregada da locação e do recebível pai. A mesma entrada de dinheiro não pode existir simultaneamente como recebimento da parcela e como recebimento independente da locação.

Regras:
- `rental.payments` deve refletir os pagamentos efetivamente aplicados às diárias, ou a leitura agregada deve ser derivada de uma única fonte sem duplicação;
- `rental.paymentStatus` deve ficar `pago` quando o total devido da locação estiver integralmente quitado;
- `receivable.paidAmount` deve acompanhar o total recebido das parcelas do plano;
- `billing_receivable` de `rental_schedule` não pode aumentar a receita consolidada além do recebível pai;
- pagamentos diretos de locação devem permanecer disponíveis apenas para locações em modo `total`, evitando dois caminhos concorrentes para a mesma obrigação.

### Critérios de aceite

- 5 × R$ 100, todas pagas pelas parcelas → locação mostra R$ 500 recebido, R$ 0 de saldo e `paymentStatus: 'pago'`;
- pagamento parcial de uma diária atualiza o agregado sem marcar a locação como paga;
- não existe dupla contagem em `getFinancialSummary`;
- auditoria registra os recebimentos.

### Teste de fluxo obrigatório

Criar 5 diárias de R$ 100 → pagar R$ 100 + R$ 100 + R$ 50 → verificar recebido agregado R$ 250, saldo R$ 250, terceira diária parcial e locação ainda aberta financeiramente → completar os R$ 250 restantes → verificar saldo zero e locação paga.

## Arquivos esperados

Principais alterações:
- `src/domain/commercial.mjs` — finalidade do plano, criação/consulta de agenda diária e recebimentos;
- `src/domain/commercial-finance.mjs` — consolidação sem dupla contagem;
- `src/domain/rental.mjs` — criação composta da locação diária e sincronização do recebível pai;
- `src/ui/reservas.mjs` — escolha do modo de cobrança e controle de diárias;
- `src/ui/commercial.mjs` — ajustes de apresentação/reuso dos planos;
- `src/ui/financeiro.mjs` — impedir caminho de recebimento incompatível para locação em agenda diária;
- `tests/daily-billing.test.mjs` — testes de domínio/fluxo das fases 0–4;
- `qa/e2e/` — fluxo real de UI para criação e recebimento diário;
- scripts de cobertura apenas se necessário para registrar os novos arquivos/fluxos.

## Estratégia de testes

Cada fase deve seguir RED → GREEN e terminar com seu fluxo específico verde antes da fase seguinte.

Gates por fase:
1. teste focal da fase;
2. `npm test` completo;
3. `npm run verify` quando a fase tocar integração/cobertura vertical.

Gate final da branch:
- `npm run verify`;
- `npm run coverage`;
- `npm run e2e`;
- `npm run qa:release`;
- workflow GitHub verde.

## Restrições

- core obrigatório local/self-hosted/open source, sem dependência paga;
- Asaas fora deste escopo;
- preservar sync PC↔Mobile e IDs globais incorporados pelo PR #2;
- preservar RBAC, auditoria, backup/restore e máquina de estados de locação;
- nenhuma alteração direta na `main`; somente branch e PR após gates verdes.
