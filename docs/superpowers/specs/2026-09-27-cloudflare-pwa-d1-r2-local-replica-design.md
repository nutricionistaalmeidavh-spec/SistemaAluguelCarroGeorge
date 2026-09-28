# Sistema Locadora George — PWA principal + Cloudflare D1/R2 + réplica local no PC

## Status

Especificação arquitetural para evolução do `SistemaAluguelCarroGeorge`.

Branch: `spec/cloudflare-pwa-d1-r2-local-replica`

Esta branch contém somente documentação de arquitetura/roadmap. Nenhuma alteração funcional deve ser feita antes da aprovação desta especificação e da criação do plano de implementação.

---

## 1. Objetivo

Transformar o sistema atual em uma aplicação híbrida em que:

- **celular/tablet/PWA seja a superfície principal de uso diário**;
- o usuário consiga acessar o sistema de qualquer lugar pela internet;
- o sistema continue utilizável no celular em períodos sem internet;
- **Cloudflare D1 seja a base operacional online de dados estruturados**;
- **Cloudflare R2 seja a base online de arquivos e anexos**;
- o PC Windows mantenha uma **réplica local completa e independente**, com SQLite, anexos e backups;
- perda, roubo ou troca do celular não cause perda operacional;
- falha ou formatação do PC não seja uma perda catastrófica, porque existe cópia na nuvem;
- exclusões acidentais e corrupção tenham mecanismos de recuperação;
- não exista dependência silenciosa de serviço pago: o projeto deve partir do uso dos planos gratuitos e qualquer migração para plano pago deve ser explícita;
- os dados sejam exportáveis e restauráveis fora da Cloudflare, evitando lock-in operacional irreversível.

O PC **não é a interface prioritária nem precisa estar ligado para o celular funcionar**. O seu papel é servir como segunda cópia durável, plataforma desktop e ponto independente de recuperação.

---

## 2. Estado atual do repositório

A aplicação atual já possui componentes úteis para a migração:

- Electron para Windows;
- instalador NSIS;
- PWA e `manifest.webmanifest`;
- Service Worker com cache do shell;
- SQLite local no Electron;
- SQLite/WASM + OPFS no navegador quando disponível, com IndexedDB como fallback;
- sincronização PC ↔ navegador por snapshots;
- RBAC;
- reservas, clientes, frota, financeiro, cobrança diária, contratos, vistorias, manutenção, alertas e auditoria;
- backup com checksum SHA-256;
- testes unitários, E2E e gates de release.

### Limitações atuais que justificam a mudança

1. O SQLite desktop usa essencialmente uma tabela `kv`, e o estado principal da locadora é persistido como um snapshot JSON grande.
2. O navegador também mantém uma cópia própria e a sincronização transfere snapshots completos.
3. Fotos de vistoria são armazenadas como `data:`/base64 dentro do estado, aumentando muito o tamanho das sincronizações.
4. O servidor de sincronização atual é adequado para LAN, mas não deve ser simplesmente exposto na internet.
5. A autenticação atual foi desenhada para uso local; não é suficiente como fronteira de segurança de uma aplicação pública.
6. Conflitos são resolvidos no nível de snapshots/coleções, quando a arquitetura final deve trabalhar por registro/operação.

A migração deve **preservar regras de negócio existentes**, substituindo progressivamente persistência, transporte, autenticação e sincronização.

---

## 3. Princípios arquiteturais

### 3.1 Mobile-first de verdade

A PWA não deve ser tratada como um acessório do Electron. Ela passa a ser uma interface de primeira classe, capaz de:

- login;
- consulta;
- cadastro;
- reservas;
- controle de locações;
- recebimento de diárias;
- vistorias e fotos;
- financeiro autorizado;
- contratos/documentos compatíveis com mobile;
- trabalho offline temporário;
- sincronização automática quando a conexão retornar.

### 3.2 Cloud-first operacional, local-first para resiliência

A fonte operacional online será a API do Worker apoiada em D1/R2.

O dispositivo mantém dados locais suficientes para:

- abrir rapidamente;
- continuar fluxos já carregados sem conexão;
- registrar alterações em uma outbox local;
- enviar alterações assim que houver conectividade.

O PC mantém uma réplica integral para segurança e continuidade independente.

### 3.3 Sem dependência do PC para uso móvel

Com o PC desligado:

- a PWA deve abrir;
- usuários autenticados devem conseguir trabalhar normalmente quando houver internet;
- dados devem ser lidos/escritos no D1/R2;
- o Electron apenas retomará a réplica quando voltar a ficar online.

### 3.4 Sem snapshot gigante como protocolo principal

A sincronização final deve trabalhar com:

- registros;
- operações/eventos idempotentes;
- cursores de sincronização;
- versões por entidade;
- tombstones para exclusões;
- fila de alterações pendentes.

Snapshots completos podem continuar existindo apenas para exportação/backup, não como protocolo ordinário de sincronização.

### 3.5 Portabilidade e saída da Cloudflare

Mesmo utilizando D1/R2 como camada online, o produto deve manter:

- esquema SQL versionado no repositório;
- migrations reproduzíveis;
- exportação periódica dos dados;
- réplica SQLite local no PC;
- cópia local dos anexos;
- mecanismo documentado de restauração.

O uso de Cloudflare é uma decisão operacional explícita, não uma prisão dos dados.

---

## 4. Arquitetura alvo

```text
                    ┌───────────────────────────┐
                    │        PWA / MOBILE       │
                    │ iPhone / Android / Tablet │
                    │                           │
                    │ cache + outbox offline    │
                    └─────────────┬─────────────┘
                                  │ HTTPS
                                  ▼
                    ┌───────────────────────────┐
                    │    CLOUDFLARE WORKER      │
                    │ API + Auth + validação    │
                    │ Assets da PWA             │
                    └──────────┬───────┬────────┘
                               │       │
                    SQL        │       │ objetos
                               ▼       ▼
                        ┌─────────┐  ┌─────────┐
                        │   D1    │  │   R2    │
                        │ dados   │  │ arquivos│
                        └────┬────┘  └────┬────┘
                             │            │
                             └──────┬─────┘
                                    │ sync incremental
                                    ▼
                    ┌───────────────────────────┐
                    │      PC DO GEORGE         │
                    │ Electron                  │
                    │ SQLite local              │
                    │ attachments locais        │
                    │ backups rotativos         │
                    └───────────────────────────┘
```

---

## 5. Autoridade e cópias dos dados

### 5.1 Dados estruturados

Durante operação online:

- autoridade operacional: **D1**;
- réplica de segurança/desktop: **SQLite no PC**;
- cache/outbox temporária: **armazenamento local da PWA**.

### 5.2 Arquivos

Durante operação online:

- autoridade online: **R2**;
- réplica local: diretório `attachments/` no PC;
- cache temporário no dispositivo móvel conforme necessidade.

### 5.3 Regra de confirmação

Online:

```text
PWA → Worker → commit D1/R2 → confirmação para o usuário
```

Offline:

```text
PWA → outbox local → estado “pendente de sincronização”
                         ↓
                   internet retorna
                         ↓
                    Worker/D1/R2
```

O usuário deve conseguir distinguir pelo menos:

- `Salvo neste aparelho`;
- `Sincronizado na nuvem`;
- opcionalmente `Replicado no PC` em telas administrativas de diagnóstico.

O status de réplica no PC não deve bloquear o trabalho normal do George.

---

## 6. Modelo de dados

O modelo atual baseado em snapshot deve migrar para tabelas relacionais explícitas.

### 6.1 Tabelas principais esperadas

```text
installations
devices
users
sessions

customers
vehicles
vehicle_documents
rentals
rental_payments

expenses
ledger

inspections
inspection_items
inspection_photos

maintenance

contract_templates
issued_contracts

billing_plans
billing_installments
collection_actions

alerts / alert_state

audit_log
attachments

sync_changes
sync_cursors
schema_migrations
```

A lista final poderá ser refinada durante o plano de implementação, mas não deve reintroduzir um único JSON monolítico como fonte primária.

### 6.2 IDs

IDs devem ser globalmente únicos entre dispositivos.

Preferência:

- UUID/ULID ou IDs atuais desde que comprovadamente únicos entre dispositivos;
- nunca usar apenas `MAX(id)+1` de um banco local para entidades sincronizadas.

### 6.3 Concorrência

Entidades mutáveis devem ter metadados equivalentes a:

```text
id
created_at
updated_at
version
updated_by_device
```

Exclusões sincronizáveis devem utilizar tombstone lógico quando necessário:

```text
deleted_at
```

Registros financeiros exigem regras mais estritas e não podem depender apenas de `last-write-wins`.

---

## 7. Sincronização incremental

### 7.1 Conceito

Cada alteração relevante gera um evento/operação idempotente, por exemplo:

```json
{
  "operationId": "...",
  "installationId": "LOCADORA-GEORGE",
  "deviceId": "GEORGE-IPHONE",
  "entityType": "rental_payment",
  "entityId": "...",
  "operation": "create",
  "baseVersion": 4,
  "createdAt": "..."
}
```

O `operationId` impede aplicação duplicada depois de retries.

### 7.2 Outbox mobile

A PWA terá uma outbox persistente local.

Fluxo:

1. usuário altera um registro;
2. alteração é aplicada ao estado local compatível com offline;
3. operação entra na outbox;
4. UI informa que existe alteração pendente;
5. sincronizador envia para o Worker;
6. Worker valida autenticação, autorização, versão e regras de domínio;
7. D1 confirma a transação;
8. outbox marca a operação como sincronizada;
9. cliente recebe alterações remotas posteriores ao seu cursor.

### 7.3 Pull incremental

Cada dispositivo mantém um cursor de alterações aceitas.

Exemplo lógico:

```text
GET /api/sync/changes?after=18421
```

Resposta contém somente mudanças posteriores ao cursor permitido para aquela instalação/usuário.

### 7.4 Conflitos

Categorias:

#### Dados cadastrais

Pode usar resolução por versão, com tela de conflito quando duas alterações concorrentes não puderem ser conciliadas automaticamente.

#### Financeiro

Não usar `last-write-wins` para operações monetárias. Pagamentos devem ser eventos idempotentes e auditáveis.

Exemplo:

- dois dispositivos não podem criar duas aplicações do mesmo pagamento por retry;
- duas cobranças realmente distintas devem permanecer distintas;
- estorno deve gerar operação própria, não apagar silenciosamente o pagamento original.

#### Reservas/locações

Conflitos de disponibilidade devem ser validados no servidor dentro de transação antes da confirmação online.

Operações feitas offline que entrarem em conflito posteriormente devem retornar estado explícito para resolução, nunca ser descartadas silenciosamente.

---

## 8. D1

### 8.1 Responsabilidade

D1 armazenará os dados transacionais e cadastrais da operação.

Não armazenar blobs/fotos grandes diretamente em colunas.

### 8.2 Migrations

Adicionar diretório versionado, por exemplo:

```text
cloudflare/
  migrations/
    0001_initial.sql
    0002_...
```

Requisitos:

- migrations reproduzíveis;
- nunca depender de alteração manual feita apenas no painel;
- CI valida migrations;
- schema local SQLite deve permanecer semanticamente compatível com o schema da nuvem quando possível.

### 8.3 Multi-tenant

Esta instalação é específica do George.

Mesmo sem transformar o produto em SaaS multi-tenant nesta fase, recomenda-se possuir `installation_id` nas tabelas/sessões relevantes ou uma fronteira equivalente, para:

- evitar mistura de ambientes;
- facilitar clonagem futura da arquitetura para outro cliente;
- permitir validações de segurança por instalação.

Não criar painel multi-tenant comercial neste roadmap.

---

## 9. R2 e anexos

### 9.1 O que vai para R2

- fotos de vistoria;
- documentos de veículos;
- CNH/documentos de clientes quando o produto armazená-los;
- PDFs emitidos quando fizer sentido preservá-los;
- comprovantes;
- exports/backups históricos previstos por esta especificação.

### 9.2 Metadados no D1

Tabela `attachments`, por exemplo:

```text
id
installation_id
entity_type
entity_id
object_key
mime_type
size_bytes
sha256
created_at
created_by
status
```

### 9.3 Object keys

Não usar nome original do usuário como chave única.

Exemplo:

```text
installations/<installationId>/inspections/<inspectionId>/<attachmentId>.webp
```

### 9.4 Fotos de vistoria

Eliminar armazenamento base64 dentro do estado principal.

Pipeline previsto:

```text
câmera → compressão/normalização no cliente → upload → R2
                                             ↓
                                      metadata no D1
```

Se o upload ocorrer offline, a PWA preserva o blob na fila local até confirmação do R2.

### 9.5 Réplica no PC

Electron baixa incrementalmente anexos novos/alterados para:

```text
<userData>/attachments/
```

O banco local guarda o mapeamento e checksum.

Arquivos existentes com checksum correto não devem ser baixados novamente.

---

## 10. PWA e funcionamento offline

### 10.1 Cache do shell

Preservar Service Worker para:

- HTML;
- CSS;
- JS;
- ícones;
- manifest;
- recursos estáticos necessários para abrir o app.

### 10.2 Dados locais

O armazenamento local da PWA deixa de ser um banco mestre independente e assume três responsabilidades:

1. cache das entidades necessárias para uso recente/offline;
2. outbox de operações ainda não confirmadas;
3. blobs/anexos ainda não enviados.

### 10.3 Escopo offline obrigatório

No mínimo, após dados relevantes terem sido carregados previamente, deve ser possível:

- abrir a aplicação;
- visualizar locações recentes/abertas;
- visualizar clientes e veículos necessários aos fluxos atuais;
- iniciar/completar vistoria;
- registrar fotos;
- registrar operação financeira autorizada como pendente;
- registrar observações e alterações operacionais;
- sincronizar tudo depois.

### 10.4 Operações que podem exigir conexão

A especificação permite que algumas operações de alto risco exijam online se a regra de negócio não puder ser validada de forma segura offline. Isso deve ser decidido explicitamente no plano, nunca acontecer por acidente.

---

## 11. Electron e réplica local

### 11.1 Papel do Electron

Electron continuará sendo:

- interface desktop completa;
- agente de réplica local;
- visualizador de saúde da sincronização;
- executor de backups locais;
- ponto de exportação e restauração;
- cópia independente dos dados da nuvem.

### 11.2 Banco local

Migrar de `kv + snapshot` para SQLite relacional.

Local esperado:

```text
%APPDATA%/SistemaLocadoraGeorge/
  locadora.sqlite
  attachments/
  backups/
  logs/
```

O caminho real deve continuar baseado em `app.getPath('userData')` para respeitar o isolamento desta instalação.

### 11.3 Sincronização desktop

O PC mantém seu próprio cursor.

Quando estiver online:

```text
Worker/D1 → mudanças após cursor → transação SQLite → avanço de cursor
R2        → anexos ausentes      → arquivo local + checksum
```

Se o PC ficar desligado vários dias, deve retomar do último cursor sem exigir reinstalação ou snapshot manual.

### 11.4 Alterações feitas no desktop

O desktop continua podendo editar dados.

Nesse caso ele usa a mesma API/outbox e regras de sincronização dos demais dispositivos, evitando uma segunda lógica de domínio exclusiva.

---

## 12. Autenticação e segurança

A versão pública não reutilizará a autenticação local atual como fronteira de segurança.

### 12.1 Senhas

Requisitos:

- hash de senha resistente a ataque offline, preferencialmente scrypt/Argon2/PBKDF2 conforme compatibilidade do runtime escolhido;
- salt individual;
- nenhuma senha default fixa em produção;
- primeiro acesso força definição de credencial real ou fluxo equivalente.

### 12.2 Sessões

Preferência:

- sessão emitida pelo backend;
- cookie `HttpOnly`;
- `Secure`;
- `SameSite` apropriado;
- expiração e revogação;
- sessão ligada a installation/user/device quando aplicável.

### 12.3 RBAC

As permissões existentes continuam, porém a validação deve ocorrer também no Worker/API.

Nunca confiar apenas no fato de um botão estar oculto na PWA.

### 12.4 Dispositivos

Cada dispositivo terá identidade própria.

Permitir:

- nome amigável;
- data do último acesso;
- revogação;
- encerramento de sessões;
- auditoria de qual dispositivo realizou uma ação.

### 12.5 CORS e API

Remover modelo público baseado em `Access-Control-Allow-Origin: *` para endpoints autenticados.

A API deve aceitar somente origens e mecanismos previstos pelo produto.

### 12.6 Segredos

Segredos Cloudflare ficam em bindings/secrets próprios do ambiente.

Nunca versionar:

- tokens;
- chaves privadas;
- credenciais administrativas;
- secrets de sessão.

---

## 13. Backup e recuperação

A meta não é apenas ter várias cópias, mas **testar restauração**.

### 13.1 Camadas

1. dados ativos no D1;
2. objetos ativos no R2;
3. mecanismos nativos de recuperação do D1 disponíveis no plano utilizado;
4. export periódico do banco para backup histórico;
5. réplica SQLite no PC;
6. réplica de anexos no PC;
7. backups locais rotativos do PC.

### 13.2 Backup cloud histórico

Criar processo de exportação periódica para chave dedicada no R2 ou formato equivalente recuperável.

Estrutura lógica:

```text
backups/
  <installationId>/
    database/
      YYYY-MM-DD/...
    manifests/
      YYYY-MM-DD.json
```

Cada manifesto deve registrar ao menos:

- horário;
- versão de schema;
- checksum/identificador dos artefatos;
- installation id;
- sucesso/falha.

### 13.3 Backup local

Recomendação inicial de retenção:

- 7 diários;
- 4 semanais;
- 12 mensais.

O número final pode ser ajustado conforme espaço real.

### 13.4 Restauração

Devem existir procedimentos para:

- novo celular;
- celular perdido/roubado;
- PC formatado;
- banco local corrompido;
- exclusão acidental de registros;
- objeto R2 excluído;
- corrupção lógica causada por versão defeituosa;
- restauração integral da instalação.

Restauração deve sempre gerar auditoria e identificador de geração/ponto de recuperação para impedir que um dispositivo antigo reintroduza dados que foram intencionalmente removidos por restore.

---

## 14. Observabilidade e saúde

Adicionar diagnóstico operacional sem serviço pago obrigatório.

Tela administrativa deve exibir:

- status da API;
- última sincronização deste dispositivo;
- tamanho/quantidade da outbox;
- último erro;
- cursor local;
- última réplica confirmada pelo PC;
- último backup local;
- último backup cloud;
- espaço aproximado de anexos locais;
- versão do schema/app.

Logs locais devem evitar dados sensíveis desnecessários.

---

## 15. Estratégia de migração

A migração deve ocorrer sem big-bang.

### Etapa A — compatibilidade

Criar leitura do estado atual e conversão determinística para o novo schema.

### Etapa B — dual validation

Nos testes, validar que dados convertidos preservam:

- clientes;
- veículos;
- reservas/locações;
- financeiro;
- cobrança diária;
- vistorias;
- manutenção;
- contratos;
- auditoria.

### Etapa C — banco relacional local

Converter o Electron primeiro para o schema relacional local, mantendo comportamento funcional.

### Etapa D — D1/R2

Subir o mesmo modelo lógico na nuvem e ativar API.

### Etapa E — PWA online

PWA passa a consumir a API em vez de depender do snapshot remoto.

### Etapa F — offline/outbox

Reintroduzir/fortalecer offline sobre o novo protocolo incremental.

### Etapa G — remover protocolo legado

Somente depois dos gates verdes remover:

- `/api/sync/exchange` por snapshot;
- sidecars/estruturas de compatibilidade que deixarem de ser necessárias;
- base64 de anexos no estado.

---

## 16. Roadmap por fases

### Fase 0 — baseline e proteção de regressão

Objetivo: congelar o comportamento atual antes da migração.

Entregas:

- fixtures representativas do snapshot atual;
- testes de migração dos dados existentes;
- inventário de entidades e invariantes;
- teste de backup/restore atual;
- gate completo da branch antes de mudanças estruturais.

Aceite:

- nenhuma funcionalidade atual relevante fica sem cobertura suficiente para detectar perda de dados na migração.

### Fase 1 — schema relacional canônico

Objetivo: definir o modelo compartilhado entre D1 e SQLite local.

Entregas:

- migrations versionadas;
- IDs globais;
- constraints/índices;
- timestamps/versões;
- tombstones quando aplicável;
- script de conversão do snapshot.

Aceite:

- snapshot existente converte para o schema novo e produz resultados financeiros/operacionais equivalentes.

### Fase 2 — persistência SQLite local estruturada

Objetivo: remover o snapshot monolítico como persistência primária do desktop.

Entregas:

- repositories por entidade/transação;
- transações compostas para fluxos críticos;
- migration automática no primeiro start compatível;
- rollback/backup pré-migração.

Aceite:

- Electron opera integralmente no novo SQLite sem D1.

### Fase 3 — anexos fora do snapshot

Objetivo: retirar fotos/documentos base64 do estado.

Entregas:

- tabela de attachments;
- storage local por arquivos;
- SHA-256;
- compressão/limites;
- migração das evidências existentes.

Aceite:

- novas fotos não aumentam o JSON global; integridade entre metadata e arquivo é verificável.

### Fase 4 — Cloudflare Worker + D1

Objetivo: criar a camada operacional online.

Entregas:

- configuração Wrangler;
- bindings D1;
- migrations remotas;
- API versionada;
- autenticação server-side;
- RBAC server-side;
- validação das operações críticas.

Aceite:

- CRUD/fluxos críticos funcionam por API e os testes garantem isolamento/autorização.

### Fase 5 — R2

Objetivo: nuvem para anexos e documentos.

Entregas:

- binding R2;
- upload/download seguro;
- metadata D1;
- checksums;
- autorização por entidade;
- política de limpeza para objetos órfãos.

Aceite:

- vistoria mobile envia fotos ao R2 e o PC consegue reconstruir a cópia local.

### Fase 6 — PWA cloud-first

Objetivo: tornar o celular a experiência principal.

Entregas:

- PWA hospedada em HTTPS via Worker/Assets;
- chamadas API;
- UX mobile-first dos fluxos principais;
- sessão persistente segura;
- tratamento explícito de loading/error/retry.

Aceite:

- George consegue executar operação diária completa sem PC ligado.

### Fase 7 — outbox e offline

Objetivo: preservar trabalho em quedas de internet.

Entregas:

- armazenamento local;
- outbox persistente;
- retry idempotente;
- cache de entidades recentes;
- UI de pendências;
- upload diferido de anexos.

Aceite:

- fluxo offline definido pode ser concluído e sincronizado posteriormente sem duplicação.

### Fase 8 — sync incremental/cursor

Objetivo: substituir definitivamente sync por snapshot.

Entregas:

- change log server-side;
- cursor por dispositivo;
- pull incremental;
- operações idempotentes;
- estratégia de tombstones;
- conflitos por entidade.

Aceite:

- dois dispositivos trocam apenas deltas e convergem sem transferir o banco completo.

### Fase 9 — réplica automática no Electron

Objetivo: manter segunda cópia completa no PC.

Entregas:

- daemon/agente de sync dentro do Electron;
- aplicação transacional de deltas;
- replicação de anexos;
- verificação por checksum;
- retomada depois de longo período offline.

Aceite:

- PC recém-reinstalado consegue reconstruir base e anexos a partir da nuvem; PC offline preserva última réplica íntegra.

### Fase 10 — backup cloud e local

Objetivo: transformar redundância em recuperação real.

Entregas:

- rotina de export cloud;
- histórico em R2;
- backup local rotativo;
- manifests/checksums;
- tela de saúde do backup.

Aceite:

- último backup pode ser validado e restaurado em ambiente de teste.

### Fase 11 — segurança de produção

Objetivo: endurecer a aplicação antes de exposição definitiva.

Entregas:

- política de senha/primeiro acesso;
- sessões revogáveis;
- device management;
- rate limiting defensivo onde necessário;
- validação de origem;
- headers seguros;
- auditoria de eventos sensíveis;
- revisão de secrets;
- testes negativos de autorização.

Aceite:

- nenhum endpoint sensível depende apenas de controles da UI.

### Fase 12 — disaster recovery e QA final

Objetivo: provar que a arquitetura cumpre a promessa de segurança.

Cenários obrigatórios:

1. perda do celular e login em novo aparelho;
2. celular offline gera alterações e depois sincroniza;
3. retry da mesma operação não duplica pagamento;
4. PC desligado por vários dias e depois sincroniza;
5. PC formatado é reconstruído;
6. arquivo local perdido é recuperado do R2;
7. exclusão acidental é recuperada de backup/ponto de restauração aplicável;
8. conflito de reserva recebe tratamento explícito;
9. duas alterações concorrentes do mesmo cadastro não somem silenciosamente;
10. restauração impede dispositivo antigo de reintroduzir estado anterior;
11. atualização do Electron preserva o banco desta instalação;
12. desinstalação/reinstalação segue política documentada de retenção/recuperação.

Aceite:

- todos os cenários críticos possuem teste automatizado ou runbook manual reproduzível e evidência de execução.

---

## 17. API prevista

A forma final pode mudar, mas a fronteira deve ser orientada a recursos/operações e não a snapshots completos.

Exemplos:

```text
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/session

GET    /api/customers
POST   /api/customers
PATCH  /api/customers/:id

GET    /api/vehicles
POST   /api/vehicles
PATCH  /api/vehicles/:id

GET    /api/rentals
POST   /api/rentals
PATCH  /api/rentals/:id

POST   /api/rentals/:id/payments
POST   /api/billing/installments/:id/payments

POST   /api/inspections
PATCH  /api/inspections/:id
POST   /api/inspections/:id/attachments

GET    /api/sync/changes
POST   /api/sync/operations

GET    /api/health
GET    /api/sync/status
```

Evitar endpoints genéricos que permitam ao cliente gravar qualquer JSON arbitrário no banco.

---

## 18. Regras financeiras obrigatórias

A migração não pode regredir o trabalho de cobrança diária já incorporado ao sistema.

Preservar:

- `rental_schedule` como decomposição do recebível da locação;
- ausência de dupla contabilização;
- pagamentos parciais;
- estados de diária;
- reconciliação de `rental`, `billingInstallments` e `ledger`;
- auditoria.

Pagamentos passam a ser especialmente protegidos por idempotência.

Exemplo de requisito:

```text
operationId PAGAMENTO-XYZ enviado 3 vezes por timeout
→ exatamente 1 pagamento contabilizado
```

---

## 19. Estratégia de testes

### 19.1 TDD por fase

Mudança de comportamento deve seguir RED → GREEN → refactor.

### 19.2 Camadas

- domínio;
- repository SQLite;
- repository/API D1;
- anexos R2;
- autenticação/RBAC;
- sync/outbox;
- Electron replica;
- PWA E2E;
- disaster recovery.

### 19.3 Gates esperados

Preservar gates atuais e acrescentar os necessários para cloud.

Gate local mínimo por fase:

```text
npm run check
npm test
npm run verify
```

Quando tocar integração:

```text
npm run coverage
npm run e2e
npm run qa:release
```

Adicionar testes de migrations D1/SQLite e Worker conforme a estrutura for criada.

Nenhuma fase deve depender de recursos pagos para executar o gate principal de desenvolvimento.

---

## 20. Custos e restrições

### Core

O desenho inicial deve caber nos recursos gratuitos planejados para este cliente e continuar oferecendo cópia/export local.

Não ativar plano pago automaticamente.

Se volume de D1/R2/Workers ultrapassar limites gratuitos:

1. detectar/monitorar;
2. informar explicitamente;
3. apresentar opção de plano pago e/ou estratégia de redução/migração;
4. nunca transformar cobrança externa em dependência silenciosa.

### Serviços externos

Fora deste roadmap:

- Asaas;
- gateways de pagamento;
- SMS pago;
- serviços pagos de observabilidade;
- CDN/storage adicionais pagos.

Podem ser integrados depois como módulos opcionais.

---

## 21. Fora de escopo

Este roadmap não inclui:

- transformar o produto em marketplace;
- painel comercial multi-tenant completo da ArtiSys;
- cobrança automática Asaas;
- app nativo iOS/Android separado da PWA;
- reescrita total da UI desktop;
- migração para framework frontend novo apenas por estética;
- apagar a capacidade desktop;
- tornar o PC obrigatório para o funcionamento da PWA.

---

## 22. Critérios globais de sucesso

A transformação só pode ser considerada concluída quando:

1. George consegue usar o sistema principalmente pelo celular.
2. PC desligado não impede operação online da PWA.
3. Falta de internet temporária não faz perder trabalho dentro do escopo offline definido.
4. Perda do celular não faz perder dados confirmados na nuvem.
5. Perda/formatação do PC não destrói a operação, pois D1/R2 permitem reconstrução.
6. Falha/indisponibilidade da nuvem não apaga a última réplica íntegra existente no PC.
7. Dados estruturados existem em D1 e em SQLite local replicado.
8. Anexos existem em R2 e em cópia local replicada no PC.
9. Pagamentos nunca são duplicados por retry de sincronização.
10. Fotos não ficam embutidas em snapshots JSON gigantes.
11. Sincronização cotidiana trafega deltas, não snapshots inteiros.
12. Backup não é apenas criado: existe restauração testada.
13. Autorização é validada no backend.
14. Atualização/reinstalação do aplicativo não mistura esta instalação com outro produto/repositório.
15. Existe caminho documentado de exportação/recuperação para evitar perda total ou lock-in irrecuperável.

---

## 23. Ordem recomendada de implementação

A dependência entre fases é:

```text
F0 baseline
   ↓
F1 schema
   ↓
F2 SQLite relacional
   ↓
F3 attachments locais
   ↓
F4 Worker + D1
   ↓
F5 R2
   ↓
F6 PWA cloud-first
   ↓
F7 offline/outbox
   ↓
F8 sync incremental
   ↓
F9 réplica Electron
   ↓
F10 backups
   ↓
F11 hardening
   ↓
F12 DR/QA final
```

Algumas tarefas podem ser desenvolvidas em paralelo após o schema estabilizar, mas os gates de dados devem seguir essa ordem para evitar duas fontes de verdade incompatíveis.

---

## 24. Decisões arquiteturais registradas

### ADR-01 — PWA é a superfície operacional prioritária

**Decisão:** mobile/web é primeira classe; Electron não é pré-requisito de funcionamento.

### ADR-02 — D1 guarda dados estruturados online

**Decisão:** a aplicação online usa D1 como armazenamento transacional operacional.

### ADR-03 — R2 guarda blobs/anexos online

**Decisão:** fotos e documentos deixam de ser base64 no estado principal.

### ADR-04 — PC mantém réplica integral independente

**Decisão:** SQLite + attachments locais servem como segunda cópia, desktop e recuperação.

### ADR-05 — offline mobile usa cache + outbox

**Decisão:** armazenamento mobile existe para resiliência, não como banco isolado que sincroniza snapshots completos.

### ADR-06 — sincronização é incremental e idempotente

**Decisão:** operações/deltas + cursor substituem o protocolo snapshot↔snapshot.

### ADR-07 — backup precisa ser restaurável

**Decisão:** criação de backup sem teste de restauração não satisfaz o requisito de segurança.

### ADR-08 — sem upgrade pago silencioso

**Decisão:** qualquer dependência paga futura deve ser deliberada e aprovada; o desenho inicial usa o nível gratuito e mantém cópias/export locais.

---

## 25. Próximo passo após aprovação deste spec

Após revisão e aprovação desta especificação:

1. criar plano de implementação detalhado por arquivos/tarefas;
2. dividir as fases em PRs pequenos e reversíveis;
3. começar pela Fase 0 e Fase 1;
4. preservar a `main` até os gates de cada etapa ficarem verdes;
5. nunca migrar produção diretamente para uma etapa sem teste de rollback/restore correspondente.
