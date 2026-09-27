# Sistema Locadora

Sistema standalone de gestão de locação de veículos da ArtiSys.

## Escopo final

- Desktop Windows em Electron.
- Acesso mobile via navegador responsivo na mesma rede Wi-Fi/LAN do PC.
- PWA completa quando executada em contexto seguro HTTPS.
- Uma única operação da locadora: **sem multi-tenant**.
- Desktop com dados persistentes em **SQLite local**.
- No navegador: SQLite/WASM + OPFS quando disponível; fallback persistente do arquivo SQLite em armazenamento privado do navegador quando OPFS não estiver disponível.
- Sincronização PC ↔ navegador opcional pela rede configurada.
- Nenhum backend de dados obrigatório.

## Funcionalidades

### P0
- Agenda/reservas com bloqueio de conflito por veículo e período.
- Login local e RBAC para Admin, Atendente e Vistoriador.
- Financeiro com contas a receber, pagamentos parciais, despesas e caixa líquido.
- Auditoria.
- Backup verificável com SHA-256.

### P1
- Dashboard operacional e financeiro.
- Vistorias de retirada/devolução com checklist, fotos, KM, combustível e avarias.
- Manutenção por data/quilometragem e custos vinculados ao veículo.
- Alertas de devolução, manutenção, documentos do veículo e CNH.
- Contrato, recibo e relatório de vistoria em PDF.
- Rentabilidade por veículo.

### P2
- Interface responsiva para celular/tablet.
- Persistência local no navegador.
- Fila offline persistente quando o navegador/contexto permitir.
- Pareamento PC ↔ navegador por endereço + token.
- Sincronização manual ou automática.
- Revisões e cópia de recuperação em conflitos.
- Merge por entidade para preservar alterações concorrentes em clientes, veículos, locações, vistorias, manutenção, financeiro e auditoria.

### P3 — Contratos, recorrência e inadimplência
- Editor de modelos de contrato com versão, ativo/inativo, duplicação e modelo padrão.
- Variáveis dinâmicas de locadora, cliente, CNH, veículo, locação e atendente.
- Prévia com dados reais de uma locação antes da emissão; variáveis desconhecidas são sinalizadas e bloqueiam a emissão.
- Emissão de contrato com conteúdo congelado no histórico e PDF próprio da versão emitida.
- Cobranças recorrentes diária, semanal, quinzenal, mensal e personalizada.
- Geração de parcelas futuras com tratamento de fim de mês.
- Multa, juros mensais, pagamentos parciais e atualização do saldo.
- Recebíveis recorrentes entram no Financeiro, dashboard, caixa e relatórios sem perder o detalhamento da tela de Cobranças.
- Painel de inadimplência com total vencido, clientes, vencendo hoje, próximos 7 dias, atraso médio e aging 1–7, 8–15, 16–30, 31–60 e 60+ dias.
- Régua de cobrança com canal, observação, promessa de pagamento e próxima ação.
- Relatórios de devedores por cliente/veículo.
- Auditoria e sincronização PC ↔ navegador também para contratos, parcelas, planos recorrentes e ações de cobrança.
- Snapshots existentes são normalizados automaticamente para a estrutura comercial v4 ao carregar do SQLite.

## Persistência local

### Desktop

O Electron cria um único banco no diretório de dados do usuário:

```text
locadora.sqlite
```

Nele ficam:

- snapshot operacional;
- clientes, veículos, locações, financeiro e vistorias contidos no snapshot;
- contratos, modelos, cobranças recorrentes, parcelas e histórico de cobrança;
- fotos/evidências das vistorias;
- token de pareamento;
- fila/metadados de sincronização;
- estado do servidor LAN.

Não são mantidos arquivos JSON paralelos para estado persistente. Instalações que ainda possuírem os antigos `sync-config.json`/`sync-state.json` têm esses sidecars absorvidos pelo SQLite e removidos.

### Web / celular

Ao abrir um dos links exibidos em **PC ↔ Mobile**, o navegador usa armazenamento local próprio para o banco SQLite/WASM. Em contexto HTTPS com OPFS disponível, o arquivo `locadora.sqlite` é persistido diretamente no armazenamento privado do navegador. O Service Worker e a instalação PWA completa continuam condicionados a contexto seguro HTTPS, conforme as regras do navegador.

## Uso no celular pela rede local

1. Instale e abra o EXE no PC.
2. Conecte PC e celular à mesma rede Wi-Fi/LAN do PC.
3. No sistema, abra **PC ↔ Mobile**.
4. Copie um dos links exibidos.
5. Abra o link no navegador do celular.
6. O token do link realiza o pareamento e a sincronização com o PC.

## Preparar os arquivos web

```bash
npm install
npm run pwa:prepare
```

Isso copia `sql-wasm.js` e `sql-wasm.wasm` para `vendor/sqlite/`.

## Desenvolvimento

```bash
npm install
npm test
npm run check
npm run desktop
```

## Gerar instalador Windows

```bash
npm install
npm run dist
```

Saída esperada:

```text
release/Sistema-Locadora-Setup-0.7.0.exe
```

## Acesso inicial

- Usuário: `admin`
- Senha: `1234`

A credencial inicial deve ser alterada na implantação.
