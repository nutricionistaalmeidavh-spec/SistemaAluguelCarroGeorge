# Cobrança diária fases 0–4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar cobrança por diária à locação sem dupla contabilização e com recebimento por parcela sincronizado com a locação e o ledger.

**Architecture:** Reutilizar `billingPlans`/`billingInstallments` como agenda financeira. Planos de finalidade `rental_schedule` decompõem o recebível pai e não criam receita adicional; pagamentos de suas parcelas atualizam o agregado da locação. A UI de Reservas cria a agenda diária e expõe controle/recebimento rápido sem introduzir serviço remoto obrigatório.

**Tech Stack:** JavaScript ES Modules, Node.js test runner, Electron, SQLite local, PWA/local-first.

**Spec:** `docs/superpowers/specs/2026-09-27-daily-billing-phases-0-4-design.md`

## Global Constraints
- Core obrigatório R$ 0, local/self-hosted/open source; nenhuma dependência paga obrigatória.
- Asaas fora do escopo.
- Preservar RBAC, auditoria, backup/restore, sync PC↔Mobile e máquina de estados.
- Implementação somente em `feat/daily-billing-phases-0-4`.
- Cada fase deve ter teste de fluxo RED → GREEN antes da seguinte.

## Review Focus
- Cobrança `rental_schedule` não pode dobrar receita nem recebido.
- Cobrança `additional` precisa manter o comportamento comercial existente.
- Falha ao criar locação diária não pode deixar plano/parcela órfãos.
- Pagamento parcial deve manter locação aberta e parcela parcial.
- O caminho direto de pagamento da locação não pode concorrer com a agenda diária.

---

### Task 1: Fase 0 — autoridade financeira

**Files:**
- Create: `src/domain/daily-billing.mjs`
- Modify: `src/domain/commercial-finance.mjs`
- Test: `tests/daily-billing.test.mjs`

**Interfaces:**
- Produces: `billingPlanPurpose(plan)`, `markRentalSchedulePurpose(snapshot, planId)`, consolidação financeira que substitui o recebível pai pelas parcelas `rental_schedule`.

- [ ] Escrever teste `fase 0: agenda diária não duplica receita` com locação 10 × R$100 e plano diário de 10 parcelas.
- [ ] Rodar o teste e confirmar falha por receita R$2.000 ou função ausente.
- [ ] Implementar a finalidade `rental_schedule` e a consolidação sem dupla contagem.
- [ ] Rodar teste focal e `npm test`.
- [ ] Confirmar que cobrança adicional ainda soma receita.

### Task 2: Fase 1 — criação composta da locação diária

**Files:**
- Modify: `src/domain/daily-billing.mjs`
- Modify: `src/ui/reservas.mjs`
- Test: `tests/daily-billing.test.mjs`

**Interfaces:**
- Produces: `createRentalWithBilling(snapshot, draft, actorId)`.

- [ ] Escrever teste `fase 1: reserva diária cria locação e cinco parcelas atomicamente`.
- [ ] Confirmar RED.
- [ ] Implementar `createRentalWithBilling`, usando `createRental` e `createBillingPlan` sobre cópia retornada; `billingMode='daily'`, `purpose='rental_schedule'`, `frequency='daily'`, `occurrences=rental.days`, `amount=rental.dailyRate`, primeiro vencimento na retirada.
- [ ] Adicionar seleção `Receber valor total` / `Receber por diária` em `Nova reserva`.
- [ ] Rodar teste focal, `npm test` e `npm run verify`.

### Task 3: Fase 2 — controle de diárias

**Files:**
- Modify: `src/domain/daily-billing.mjs`
- Modify: `src/ui/reservas.mjs`
- Test: `tests/daily-billing.test.mjs`

**Interfaces:**
- Produces: `dailyBillingSummary(snapshot, rentalId, asOf)` com `rows`, `totalCount`, `paidCount`, `pendingCount`, `received`, `openAmount`.

- [ ] Escrever teste `fase 2: resumo mostra 5 diárias, 2 pagas e R$300 em aberto`.
- [ ] Confirmar RED.
- [ ] Implementar resumo derivado de `billingInstallments` e `installmentBalance`.
- [ ] Adicionar ação `Diárias` na locação e modal `Controle de diárias`, protegido por `billing.read`.
- [ ] Rodar teste focal, `npm test` e `npm run verify`.

### Task 4: Fase 3 — receber próxima diária

**Files:**
- Modify: `src/domain/daily-billing.mjs`
- Modify: `src/ui/reservas.mjs`
- Test: `tests/daily-billing.test.mjs`

**Interfaces:**
- Produces: `nextDailyInstallment(snapshot, rentalId)` e `recordNextDailyPayment(snapshot, rentalId, payment, actorId)`.

- [ ] Escrever teste `fase 3: próxima diária avança após quitação`.
- [ ] Confirmar RED.
- [ ] Implementar seleção da primeira parcela não quitada e pagamento parcial/total.
- [ ] Adicionar botão `Receber diária`, pré-preenchendo o saldo da próxima parcela e exigindo `billing.write`.
- [ ] Rodar teste focal, `npm test` e `npm run verify`.

### Task 5: Fase 4 — locação, parcela e ledger em uma única verdade

**Files:**
- Modify: `src/domain/commercial.mjs`
- Modify: `src/domain/daily-billing.mjs`
- Modify: `src/domain/commercial-finance.mjs`
- Modify: `src/ui/financeiro.mjs` se necessário
- Test: `tests/daily-billing.test.mjs`
- Create: `qa/e2e/daily-billing.test.cjs`

**Interfaces:**
- `recordInstallmentPayment` detecta plano `rental_schedule` e sincroniza `rental.payments`, `rental.paymentStatus` e o `receivable` pai.
- `registerRentalPayment` bloqueia pagamento direto quando a locação possui agenda diária.

- [ ] Escrever teste `fase 4: 100 + 100 + 50 mantém saldo 250 e quitação final fecha locação financeiramente`.
- [ ] Confirmar RED.
- [ ] Sincronizar pagamento da parcela com locação e recebível pai sem duplicar receita/caixa.
- [ ] Bloquear caminho direto para locação com agenda diária.
- [ ] Criar E2E Electron: criar reserva diária → abrir Controle de diárias → receber próxima diária → conferir estado pago/próxima.
- [ ] Rodar `npm run verify`, `npm run coverage`, `npm run e2e` e `npm run qa:release`.
- [ ] Abrir PR e exigir workflows Linux e Windows verdes antes de qualquer merge.
