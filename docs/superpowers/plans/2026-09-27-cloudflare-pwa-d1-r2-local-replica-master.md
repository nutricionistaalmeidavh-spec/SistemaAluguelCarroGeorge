# Cloudflare PWA + D1/R2 + réplica local — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evoluir o Sistema Locadora George para PWA/mobile operacional sobre Cloudflare Workers + D1/R2, mantendo réplica SQLite e anexos completos no PC e funcionamento offline controlado no dispositivo.

**Architecture:** O trabalho é dividido em três planos sequenciais e reversíveis. Primeiro estabilizamos e migramos a persistência local; depois introduzimos Worker/D1/R2, PWA cloud-first e sync incremental; por fim transformamos o Electron em réplica confiável, adicionamos backup/restore, hardening e disaster recovery.

**Tech Stack:** JavaScript ESM/CJS, Node.js `node:test`, Electron 39, `node:sqlite`, PWA/Service Worker, Cloudflare Workers, D1, R2, Wrangler, Web Crypto.

**Spec:** `docs/superpowers/specs/2026-09-27-cloudflare-pwa-d1-r2-local-replica-design.md`

## Global Constraints

- A PWA/mobile é a superfície operacional prioritária; o PC não pode ser requisito para o uso online.
- D1 guarda dados estruturados online; R2 guarda blobs/anexos online.
- O PC deve manter réplica integral independente em SQLite + `attachments/` + backups.
- O funcionamento offline usa cache + outbox; o protocolo cotidiano não pode voltar a snapshots completos.
- Pagamentos e outras operações monetárias devem ser idempotentes e auditáveis; não usar `last-write-wins` financeiro.
- Nenhum segredo deve ser versionado.
- O core de desenvolvimento não pode depender de serviço pago; qualquer upgrade pago futuro é explícito e opcional.
- Preservar RBAC, auditoria, reservas, vistorias, manutenção, contratos, cobrança diária e ausência de dupla contabilização.
- Preservar isolamento desta instalação (`appId`, `productName`, `userData`) e não misturar dados com outros sistemas/repositórios.
- Toda migration deve possuir rollback/recuperação praticável antes de ser usada em produção.
- Mudanças de comportamento seguem RED → GREEN → refactor e cada PR só integra com gates verdes.

## Review Focus

1. **Retry/timeout de pagamentos:** reenviar a mesma operação deve contabilizar exatamente uma vez; coberto no plano 02, Task 8.
2. **Migração de snapshot com dados antigos/incompletos:** converter sem apagar entidades e sem quebrar totais financeiros; coberto no plano 01, Tasks 2–4.
3. **Anexo cujo arquivo some ou diverge do checksum:** detectar e reparar/rebaixar estado sem deixar metadata falsa; coberto nos planos 01 Task 7 e 03 Task 3.
4. **Dispositivo que ficou dias offline:** deve retomar pelo cursor ou por bootstrap controlado sem reintroduzir estado restaurado; coberto nos planos 02 Task 10 e 03 Tasks 2/7.
5. **Permissão manipulada no frontend:** endpoint deve negar mesmo que a UI seja adulterada; coberto no plano 02 Tasks 3–5 e plano 03 Task 6.

---

## Estratégia de branches e PRs

A branch atual é somente de design/plano:

`spec/cloudflare-pwa-d1-r2-local-replica`

A implementação deve sair dela para branches pequenas, sempre rebaseadas/atualizadas com a `main` antes de abrir PR.

Ordem de integração:

1. `feat/george-data-foundation` — F0 a F3.
2. `feat/george-cloud-mobile-sync` — F4 a F8.
3. `feat/george-desktop-replica-dr` — F9 a F12.

Não iniciar o bloco seguinte antes do anterior estar verde e integrado, porque os contratos de schema/sync são dependências reais.

---

## Plano 01 — Fundação local (F0–F3)

**Documento:** `docs/superpowers/plans/2026-09-27-george-01-local-data-foundation.md`

**Resultado integrado:** Electron continua funcionando sem Cloudflare, mas o armazenamento primário deixa de ser `kv + app:snapshot:v3`; os dados passam a tabelas relacionais e fotos/documentos deixam de residir em base64 no estado principal.

**Gate do PR:**

```bash
npm run check
npm test
npm run verify
npm run coverage
npm run e2e
npm run qa:release
npm run dist
```

**Rollback:** instalador anterior + backup pré-migração do `locadora.sqlite` e anexos.

---

## Plano 02 — Cloud, mobile e sincronização (F4–F8)

**Documento:** `docs/superpowers/plans/2026-09-27-george-02-cloud-mobile-sync.md`

**Resultado integrado:** PWA funciona com o PC desligado, Worker valida sessão/RBAC, D1/R2 são a camada online, existe outbox persistente e sync incremental por operações/cursor.

**Gate do PR:**

```bash
npm run check
npm test
npm run verify
npm run coverage
npm run e2e
npm run qa:release
npm run cloud:test
npm run cloud:migrations:local
```

**Rollback:** desativar rota cloud/publicação da nova PWA e manter o Electron local do plano 01 íntegro.

---

## Plano 03 — Réplica, backup, segurança e DR (F9–F12)

**Documento:** `docs/superpowers/plans/2026-09-27-george-03-desktop-replica-backup-dr.md`

**Resultado integrado:** PC replica automaticamente D1/R2, backups local/cloud são verificáveis e restauráveis, sessões/dispositivos são gerenciáveis, e os cenários de perda/roubo/formatação/restauração são testados.

**Gate do PR:**

```bash
npm run check
npm test
npm run verify
npm run coverage
npm run e2e
npm run qa:release
npm run cloud:test
npm run dr:test
npm run release:check
npm run dist
```

**Rollback:** desativar agente de réplica/backup sem alterar D1/R2; restaurar último SQLite/anexos validados localmente.

---

## Sequência de marcos

- [ ] **M0 — Baseline congelada:** fixture realista, invariantes e gates atuais verdes.
- [ ] **M1 — Schema canônico:** migrations compartilhadas e conversão determinística snapshot → relational.
- [ ] **M2 — Desktop relacional:** Electron opera integralmente em SQLite estruturado sem Cloudflare.
- [ ] **M3 — Attachments locais:** fotos/documentos fora do snapshot/base64 e verificáveis por SHA-256.
- [ ] **M4 — Worker/D1:** API versionada, autenticação e RBAC backend.
- [ ] **M5 — R2:** upload/download autenticado e metadata no D1.
- [ ] **M6 — PWA cloud-first:** operação diária completa com PC desligado.
- [ ] **M7 — Offline/outbox:** alterações e anexos offline sobrevivem reload e sincronizam depois.
- [ ] **M8 — Delta/cursor:** snapshot sync deixa de ser protocolo ordinário.
- [ ] **M9 — Réplica Electron:** PC reconstrói dados/anexos a partir da nuvem.
- [ ] **M10 — Backup:** backups local/cloud com manifesto, checksum e retenção.
- [ ] **M11 — Hardening:** sessões revogáveis, devices, origem/headers/rate limit defensivo, testes negativos.
- [ ] **M12 — DR comprovado:** todos os 12 cenários obrigatórios do spec possuem teste automatizado ou runbook com evidência.

---

## Regras de merge

- [ ] Cada PR descreve migration/rollback.
- [ ] Nenhum PR mistura refatoração estética não necessária ao objetivo.
- [ ] Nenhum PR remove compatibilidade legada antes do consumidor novo estar verde.
- [ ] Nenhum PR cria recurso Cloudflare manualmente sem configuração equivalente versionada.
- [ ] Nenhum PR exige credenciais reais para executar os testes locais principais.
- [ ] Antes do merge de F4+, migrations D1 rodam localmente do zero e sobre uma base da versão anterior.
- [ ] Antes do merge de F9+, bootstrap de um PC vazio é exercitado.
- [ ] Antes do release final, restore completo é executado em ambiente descartável.

---

## Handoff

Executar os planos na ordem 01 → 02 → 03. O implementador deve ler este plano mestre, o spec e o plano do bloco atual antes de alterar código. Cada bloco encerra em software utilizável e reversível; não acumular os três blocos em uma única PR.