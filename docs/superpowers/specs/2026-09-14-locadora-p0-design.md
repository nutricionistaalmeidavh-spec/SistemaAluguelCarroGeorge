# Sistema Locadora P0 — Design

## Objetivo
Separar a Locadora do PDVNexus e entregar um produto standalone preservando os fluxos existentes, com cinco melhorias P0: agenda sem conflitos, RBAC, financeiro, auditoria e backup íntegro.

## Arquitetura
- `src/domain/`: regras puras e testáveis de autenticação, reservas, financeiro, auditoria e backup.
- `src/storage/`: persistência local e migração do store legado 0.1.5.
- `src/app.mjs`: interface e orquestração, sem regra crítica duplicada.
- `tests/`: contrato de comportamento P0.

## Regras P0
1. Reservas do mesmo veículo não podem se sobrepor enquanto não estiverem concluídas/canceladas.
2. Disponibilidade é calculada por período; uma reserva futura não bloqueia o veículo em todos os dias.
3. Admin tem acesso total; atendente opera clientes/reservas/financeiro; vistoriador não altera financeiro.
4. Toda locação cria conta a receber; pagamentos parciais atualizam saldo de forma determinística; despesas pagas entram no caixa líquido.
5. Criação de reserva, pagamento, despesa, mudança de status, cliente e veículo geram auditoria.
6. Backups v2 usam SHA-256 e só restauram se a integridade for válida.
7. Snapshot 0.1.5 é migrado para v2 preservando clientes, frota, locações, pagamentos, despesas e configurações.

## Restrições
- R$ 0 / self-hosted / open source no caminho principal.
- Sem dependência de serviço externo obrigatório.
- Não remover dados do formato legado durante migração.
