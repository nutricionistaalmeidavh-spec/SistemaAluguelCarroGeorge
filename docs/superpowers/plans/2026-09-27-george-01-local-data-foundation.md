# George 01 — Local Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar o Electron de `kv + snapshot` para SQLite relacional e remover fotos/documentos base64 do estado principal, sem depender de Cloudflare e sem regredir as regras atuais.

**Architecture:** O schema SQL versionado vira o contrato canônico. Um conversor determinístico traduz o snapshot legado para linhas relacionais; o Electron faz backup pré-migração, aplica migrations e usa repositories transacionais, enquanto a UI continua consumindo um agregado compatível durante a transição. Anexos passam para storage binário local referenciado por metadata.

**Tech Stack:** Node.js, `node:test`, `node:sqlite`/`DatabaseSync`, Electron 39, JavaScript ESM/CJS, filesystem local, Web Crypto/Node crypto SHA-256.

**Spec:** `docs/superpowers/specs/2026-09-27-cloudflare-pwa-d1-r2-local-replica-design.md`

## Global Constraints

- Electron deve continuar funcionando integralmente sem D1/R2 ao final deste plano.
- Não apagar o `kv`/snapshot legado até a migração ser confirmada e existir backup pré-migração verificável.
- IDs sincronizáveis devem ser globalmente únicos; não introduzir `MAX(id)+1`.
- Preservar cobrança diária, `rental_schedule`, pagamentos parciais e ausência de dupla contabilização.
- Preservar RBAC, auditoria, backup/restore e estados de locação.
- Fotos/documentos novos não podem ser persistidos como base64 dentro do agregado principal.
- `app.getPath('userData')` continua sendo a raiz dos dados desta instalação.
- Nenhuma dependência paga ou serviço externo é necessário para desenvolver/testar este bloco.

## Review Focus

1. Snapshot legado sem coleções opcionais deve migrar para coleções vazias, não falhar.
2. `rental_schedule` convertido deve produzir exatamente o mesmo total previsto/recebido/saldo do domínio atual.
3. Migração interrompida entre backup e commit deve reabrir a base antiga sem perda.
4. Foto base64 legada inválida deve gerar erro/registro de migração explícito, nunca sumir silenciosamente.
5. `locadora.sqlite` já relacional deve iniciar idempotentemente sem repetir importação do snapshot.

---

### Task 1: Congelar uma baseline sintética representativa

**Files:**
- Create: `tests/fixtures/build-legacy-snapshot.mjs`
- Create: `tests/helpers/snapshot-invariants.mjs`
- Create: `tests/migration-baseline.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: APIs de domínio existentes em `src/domain/*.mjs`.
- Produces: `buildLegacySnapshotFixture() -> Snapshot`; `assertSnapshotInvariants(snapshot) -> void`; script `test:migration`.

- [ ] **Step 1: Escrever o teste de baseline**

Criar `tests/migration-baseline.test.mjs` com uma fixture que contenha, no mínimo: 2 clientes, 2 veículos, 2 locações (uma `total`, uma `rental_schedule` diária), pagamento parcial, despesa, ledger, vistoria com 1 foto base64, manutenção, template/contrato, usuário e auditoria. Asserções mínimas: contagens esperadas e resumo financeiro sem dupla contabilização.

- [ ] **Step 2: Rodar para confirmar RED**

Run: `node --test tests/migration-baseline.test.mjs`

Expected: FAIL porque `buildLegacySnapshotFixture`/invariantes ainda não existem.

- [ ] **Step 3: Implementar a fixture usando somente APIs atuais de domínio**

`buildLegacySnapshotFixture()` deve construir o estado por chamadas públicas existentes, evitando duplicar manualmente regras de negócio no fixture.

- [ ] **Step 4: Implementar `assertSnapshotInvariants(snapshot)`**

Asserções incluem IDs únicos, referências válidas, totais financeiros coerentes e `rental_schedule` não duplicado no resumo.

- [ ] **Step 5: Adicionar `test:migration`**

`package.json`: `"test:migration": "node --test tests/migration-*.test.mjs tests/schema-*.test.mjs tests/sqlite-relational.test.mjs tests/attachments-local.test.mjs"`.

- [ ] **Step 6: Rodar baseline e suíte atual**

Run: `npm run test:migration && npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures tests/helpers tests/migration-baseline.test.mjs package.json
git commit -m "test: freeze legacy data baseline"
```

---

### Task 2: Criar migrations SQL canônicas e runner local

**Files:**
- Create: `db/migrations/0001_core.sql`
- Create: `db/migrations/0002_commercial.sql`
- Create: `db/migrations/0003_sync_metadata.sql`
- Create: `electron/migration-runner.cjs`
- Create: `tests/schema-migrations.test.mjs`

**Interfaces:**
- Consumes: `DatabaseSync` aberto pelo Electron/testes.
- Produces: `applyMigrations(db, migrationsDir) -> { applied: string[], version: number }`; tabela `schema_migrations`.

- [ ] **Step 1: Escrever teste de banco vazio**

O teste abre `DatabaseSync(':memory:')`, chama `applyMigrations` e verifica existência/constraints básicas das tabelas: `installations`, `devices`, `users`, `customers`, `vehicles`, `rentals`, `rental_payments`, `expenses`, `ledger`, `inspections`, `inspection_items`, `maintenance`, `contract_templates`, `issued_contracts`, `billing_plans`, `billing_installments`, `collection_actions`, `audit_log`, `sync_changes`, `sync_cursors`, `schema_migrations`.

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/schema-migrations.test.mjs`

Expected: FAIL por módulos/migrations inexistentes.

- [ ] **Step 3: Criar `0001_core.sql`**

Fixar colunas compartilhadas das entidades mutáveis: `id TEXT PRIMARY KEY`, `installation_id TEXT NOT NULL`, `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`, `version INTEGER NOT NULL DEFAULT 1`, `updated_by_device TEXT`, `deleted_at TEXT`. Criar FKs/índices para relações críticas.

- [ ] **Step 4: Criar `0002_commercial.sql`**

Modelar ledger/cobranças/contratos preservando `purpose`, `frequency`, `payments` como linhas normalizadas quando houver múltiplos eventos monetários. Não armazenar um JSON monolítico do snapshot.

- [ ] **Step 5: Criar `0003_sync_metadata.sql`**

Criar `sync_changes` e `sync_cursors` sem ainda ativar protocolo cloud; tabelas ficam prontas para os planos seguintes.

- [ ] **Step 6: Implementar `applyMigrations`**

Aplicar arquivos em ordem lexical dentro de transação por migration e registrar checksum/nome/horário em `schema_migrations`; reexecução deve retornar `applied: []`.

- [ ] **Step 7: Testar idempotência e migration parcialmente aplicada**

Adicionar testes que executam duas vezes e que rejeitam checksum alterado de migration já registrada.

- [ ] **Step 8: Rodar testes**

Run: `node --test tests/schema-migrations.test.mjs`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add db/migrations electron/migration-runner.cjs tests/schema-migrations.test.mjs
git commit -m "feat: add canonical relational schema"
```

---

### Task 3: Converter snapshot legado em linhas relacionais

**Files:**
- Create: `src/migration/snapshot-to-relational.mjs`
- Create: `src/migration/relational-to-snapshot.mjs`
- Create: `tests/migration-relational.test.mjs`

**Interfaces:**
- Consumes: `Snapshot` normalizado atual.
- Produces: `snapshotToRelational(snapshot, { installationId, deviceId }) -> RelationalDataset`; `relationalToSnapshot(dataset) -> Snapshot`.

- [ ] **Step 1: Escrever round-trip test**

Gerar a fixture da Task 1 → converter → reconstruir → rodar `assertSnapshotInvariants`. Asserções adicionais: IDs preservados; pagamentos e auditoria preservados; resultado de `getFinancialSummary` igual antes/depois; foto ainda referenciada como legado nesta task (migração binária ocorre na Task 7).

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/migration-relational.test.mjs`

Expected: FAIL porque os conversores não existem.

- [ ] **Step 3: Implementar `snapshotToRelational`**

Retornar objeto com arrays por tabela, nunca SQL raw. Normalizar ausências opcionais para arrays vazios. Propagar `installation_id` e metadados de versão.

- [ ] **Step 4: Implementar `relationalToSnapshot`**

Reconstruir o agregado compatível com a UI/domínio atual. Não reimplementar cálculos; dados derivados devem continuar sendo reconciliados pelas funções de domínio existentes.

- [ ] **Step 5: Adicionar caso legado incompleto**

Fixture sem `billingPlans`, `collectionActions`, `maintenance` e `alertState` deve converter com defaults seguros.

- [ ] **Step 6: Rodar testes de migração + financeiro**

Run: `npm run test:migration && node --test tests/daily-billing*.test.mjs tests/commercial.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/migration tests/migration-relational.test.mjs
git commit -m "feat: convert legacy snapshot to relational rows"
```

---

### Task 4: Criar repositories SQLite transacionais

**Files:**
- Create: `electron/repositories/core-repository.cjs`
- Create: `electron/repositories/commercial-repository.cjs`
- Create: `electron/repositories/operations-repository.cjs`
- Create: `electron/relational-store.cjs`
- Create: `tests/sqlite-relational.test.mjs`

**Interfaces:**
- Consumes: `RelationalDataset` da Task 3 e `DatabaseSync` migrado.
- Produces: `RelationalStore.open(filePath, options)`; `loadSnapshot() -> Snapshot`; `saveSnapshot(snapshot) -> Snapshot`; `replaceFromDataset(dataset) -> void`; `transaction(fn) -> any`; `isRelationalEmpty() -> boolean`.

- [ ] **Step 1: Escrever teste de persistência em arquivo temporário**

Salvar fixture → fechar DB → reabrir → carregar → invariantes e resumo financeiro idênticos.

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/sqlite-relational.test.mjs`

Expected: FAIL por store inexistente.

- [ ] **Step 3: Implementar `core-repository.cjs`**

Responsável apenas por installation/device/users/customers/vehicles/rentals e referências diretas.

- [ ] **Step 4: Implementar `commercial-repository.cjs`**

Responsável por payments/expenses/ledger/billing/contracts/collection actions, com writes monetários dentro da transação fornecida pelo store.

- [ ] **Step 5: Implementar `operations-repository.cjs`**

Responsável por inspections/items/maintenance/audit/alert state.

- [ ] **Step 6: Implementar `relational-store.cjs`**

Abrir DB, aplicar migrations, delegar repositories e expor somente as interfaces acima. `saveSnapshot` usa uma transação única para o agregado compatível da fase de transição.

- [ ] **Step 7: Testar rollback transacional**

Forçar erro após gravação parcial de rental/payment e comprovar que nenhuma metade fica persistida.

- [ ] **Step 8: Rodar suíte**

Run: `npm run test:migration && npm test`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add electron/repositories electron/relational-store.cjs tests/sqlite-relational.test.mjs
git commit -m "feat: persist locadora in relational sqlite"
```

---

### Task 5: Fazer migração automática com backup pré-migração

**Files:**
- Create: `electron/pre-migration-backup.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/storage/repository.mjs`
- Create: `tests/sqlite-upgrade.test.mjs`

**Interfaces:**
- Consumes: DB legado no `userData`, `RelationalStore` da Task 4.
- Produces: `createPreMigrationBackup({ databasePath, userData, reason }) -> { path, sha256 }`; bridge `snapshotLoad()`/`snapshotSave(snapshot)`.

- [ ] **Step 1: Escrever teste de upgrade de um DB legado**

Criar DB temporário com tabela `kv` e `app:snapshot:v3`; iniciar rotina de upgrade; verificar arquivo de backup + SHA-256, dados relacionais equivalentes e marcador de migração concluída.

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/sqlite-upgrade.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implementar backup pré-migração**

Copiar DB somente com conexão em estado seguro/checkpoint e gravar manifesto pequeno com hash, versão e horário em `<userData>/backups/pre-migration/`.

- [ ] **Step 4: Integrar upgrade no `main.cjs`**

Fluxo: abrir legado → detectar snapshot → backup → aplicar migrations → importar em transação → validar invariantes mínimas → marcar importado. Se falhar, fechar novo store e preservar DB/backup sem remover chave legada.

- [ ] **Step 5: Atualizar preload/repository**

O renderer usa `window.locadoraDesktop.snapshotLoad()` e `snapshotSave(snapshot)` no desktop; fallback web atual continua temporariamente disponível para não quebrar PWA antes do plano 02.

- [ ] **Step 6: Testar reabertura idempotente**

Segundo start não cria nova importação nem duplica linhas.

- [ ] **Step 7: Rodar E2E desktop focal**

Run: `npm run e2e:smoke`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add electron src/storage/repository.mjs tests/sqlite-upgrade.test.mjs
git commit -m "feat: migrate legacy sqlite safely on startup"
```

---

### Task 6: Adicionar schema e store local de attachments

**Files:**
- Create: `db/migrations/0004_attachments.sql`
- Create: `electron/attachment-store.cjs`
- Create: `src/storage/attachment-store.mjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Create: `tests/attachments-local.test.mjs`

**Interfaces:**
- Consumes: bytes/blob + metadata de entidade.
- Produces: `AttachmentStore.put({ id, entityType, entityId, mimeType, bytes }) -> AttachmentMetadata`; `get(id) -> Buffer|null`; `verify(id) -> { ok, expectedSha256, actualSha256 }`; `remove(id)`; renderer `putAttachment/getAttachment`.

- [ ] **Step 1: Escrever teste put/get/verify**

Persistir bytes conhecidos, fechar/reabrir store, conferir conteúdo e SHA-256.

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/attachments-local.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Criar migration `0004_attachments.sql`**

Tabela inclui `id`, `installation_id`, `entity_type`, `entity_id`, `local_path`, `mime_type`, `size_bytes`, `sha256`, `created_at`, `created_by`, `status`, versões/tombstone conforme contrato canônico.

- [ ] **Step 4: Implementar store filesystem**

Raiz: `<userData>/attachments`; nome físico baseado em `attachmentId`, nunca no nome original do usuário. Escrita atômica via arquivo temporário + rename.

- [ ] **Step 5: Implementar adapter renderer**

`src/storage/attachment-store.mjs` escolhe bridge desktop; para navegador legado temporário usa IndexedDB Blob, apenas até o plano 02 introduzir R2/outbox.

- [ ] **Step 6: Testar corrupção**

Alterar bytes no arquivo e confirmar `verify(id).ok === false`.

- [ ] **Step 7: Commit**

```bash
git add db/migrations/0004_attachments.sql electron/attachment-store.cjs electron/main.cjs electron/preload.cjs src/storage/attachment-store.mjs tests/attachments-local.test.mjs
git commit -m "feat: store attachments outside snapshots"
```

---

### Task 7: Migrar fotos base64 legadas para attachments

**Files:**
- Create: `src/migration/legacy-attachments.mjs`
- Modify: `src/domain/inspection.mjs`
- Modify: `src/ui/p1.mjs`
- Modify: `src/storage/repository.mjs`
- Create: `tests/migration-attachments.test.mjs`
- Modify: `tests/p1.test.mjs`

**Interfaces:**
- Consumes: inspection photos legadas `{ dataUrl, name, type }` e `attachmentStore`.
- Produces: `migrateLegacyAttachments(snapshot, attachmentStore, context) -> { snapshot, migrated, errors }`; fotos no domínio passam a referenciar `attachmentId`, `mimeType`, `sizeBytes`, `sha256`.

- [ ] **Step 1: Escrever teste de migração da foto da fixture**

Verificar que `dataUrl` desaparece do snapshot resultante, arquivo existe, SHA confere e vistoria continua informando 1 foto.

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/migration-attachments.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implementar parser estrito de data URL legado**

Aceitar somente formatos de imagem previstos; retornar erro por foto inválida sem descartá-la silenciosamente.

- [ ] **Step 4: Implementar migração idempotente**

Fotos já com `attachmentId` não são regravadas; migração só remove base64 após confirmação do store.

- [ ] **Step 5: Alterar domínio/UI de vistoria**

Nova foto: UI obtém arquivo/Blob → `attachmentStore.put` → domínio recebe metadata, não base64. Leitura usa URL temporária/bridge para exibir.

- [ ] **Step 6: Atualizar testes P1**

Substituir asserções de `dataUrl` por `attachmentId`/metadata e manter limites de quantidade/tamanho antes do armazenamento.

- [ ] **Step 7: Rodar testes**

Run: `node --test tests/migration-attachments.test.mjs tests/p1.test.mjs && npm run e2e:smoke`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/migration/legacy-attachments.mjs src/domain/inspection.mjs src/ui/p1.mjs src/storage/repository.mjs tests/migration-attachments.test.mjs tests/p1.test.mjs
git commit -m "feat: migrate inspection photos to attachments"
```

---

### Task 8: Garantir paridade funcional no novo SQLite

**Files:**
- Modify: `qa/e2e/smoke.test.cjs`
- Modify: `qa/e2e/daily-billing.test.cjs`
- Create: `qa/e2e/relational-persistence.test.cjs`
- Modify: `scripts/check-vertical-coverage.cjs`

**Interfaces:**
- Consumes: aplicativo Electron migrado.
- Produces: gate E2E que prova persistência relacional e reabertura.

- [ ] **Step 1: Criar E2E de persistência/restart**

Cadastrar cliente/veículo, criar locação diária, receber parcialmente, fazer vistoria com foto, fechar Electron, reabrir no mesmo `userData`, verificar todos os dados e valores.

- [ ] **Step 2: Rodar para confirmar falhas reais antes dos ajustes finais**

Run: `node --test --test-concurrency=1 qa/e2e/relational-persistence.test.cjs`

Expected: PASS somente quando Tasks 4–7 estiverem integradas; qualquer divergência deve ser corrigida no componente dono, não mascarada no teste.

- [ ] **Step 3: Acrescentar cobertura vertical dos novos módulos**

`check-vertical-coverage.cjs` deve exigir conversor, migrations, relational store e attachment store.

- [ ] **Step 4: Rodar gates do bloco**

```bash
npm run check
npm test
npm run test:migration
npm run verify
npm run coverage
npm run e2e
npm run qa:release
npm run dist
```

Expected: todos PASS e instalador gerado.

- [ ] **Step 5: Verificar instalador isolado**

Instalar sobre diretório limpo e, separadamente, sobre cópia de `userData` legado; confirmar que não mistura appId/userData com outro produto.

- [ ] **Step 6: Commit**

```bash
git add qa/e2e scripts/check-vertical-coverage.cjs
git commit -m "test: gate relational desktop migration"
```

---

### Task 9: Documentar rollback da F0–F3

**Files:**
- Create: `docs/runbooks/george-local-migration-rollback.md`
- Modify: `README.md`

**Interfaces:**
- Produces: runbook reproduzível para voltar ao DB pré-migração e localizar `attachments/`/backups.

- [ ] **Step 1: Escrever runbook**

Incluir: localizar `userData`, parar app, validar hash do backup pré-migração, preservar DB atual, restaurar cópia anterior, reinstalar build anterior se necessário e verificar login/financeiro.

- [ ] **Step 2: Exercitar runbook em diretório temporário**

Usar dados sintéticos; registrar no documento a evidência/resultado esperado, sem dados pessoais.

- [ ] **Step 3: Atualizar README de persistência**

Descrever SQLite relacional, `attachments/`, backups e ausência de snapshot monolítico como fonte primária.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/george-local-migration-rollback.md README.md
git commit -m "docs: add local migration rollback runbook"
```

---

## Gate de saída do Plano 01

A branch `feat/george-data-foundation` só está pronta para PR quando:

- [ ] todos os comandos de Task 8 estão verdes;
- [ ] migration de DB legado foi exercitada duas vezes (primeiro start + reabertura idempotente);
- [ ] backup pré-migração possui checksum verificado;
- [ ] uma foto legada foi migrada e uma nova foto foi criada sem base64 no snapshot;
- [ ] cobrança diária mantém os mesmos totais da baseline;
- [ ] rollback foi testado em ambiente descartável;
- [ ] `main` não foi alterada diretamente.