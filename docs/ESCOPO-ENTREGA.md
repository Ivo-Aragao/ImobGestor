# ImobGestor — escopo desta entrega

## Implementado na base desta versão

- Aplicação web responsiva para computador, tablet e celular (sem aplicativo Android/iOS nativo).
- Autenticação de escritório e portal independente de cliente; recuperação de senha e convites.
- Estrutura multiempresa e associação de usuários a escritórios.
- Clientes, imóveis urbanos/rurais e participantes vinculados a imóveis.
- Catálogo de serviços com versões, etapas e documentos exigidos configuráveis por escritório.
- Procedimentos que recebem cópia das etapas e exigências da versão escolhida do modelo.
- Documentos, solicitações, versões e publicação controlada ao portal, via storage S3/R2 privado.
- Agenda, eventos, tarefas, responsáveis e lembretes diários.
- Financeiro administrativo com receitas, despesas, parcelas individuais e baixa manual.
- Dashboard, relatórios operacionais e resumo financeiro condicionado à permissão.
- Modelos de documentos com variáveis, pré-visualização e exportação HTML para impressão.
- Atendimento pelo portal: solicitações e mensagens entre cliente e escritório.
- Notificações internas, e-mails transacionais via Resend e regras administrativas de automação.
- Equipe, convites, permissões, trilha de auditoria e configurações do escritório.
- Painel administrativo da plataforma, planos e atribuição manual de assinaturas.
- Cron diário para alertas de tarefas, compromissos, documentos vencendo e atualização de recebíveis vencidos.

## Ainda depende de escolha de fornecedor, credenciais ou homologação

- Assinatura eletrônica efetiva: escolher fornecedor, obter credenciais e implementar chamadas/webhooks específicos.
- Cobrança automática de assinaturas SaaS: escolher gateway, credenciais, checkout, webhooks, cancelamento e conciliação.
- Integrações com cartórios, INCRA/SIGEF, Receita e outras bases públicas: avaliar API, autorização, autenticação e termos de uso de cada fonte.
- Antivírus/antimalware para arquivos: contratar/configurar serviço de inspeção antes de liberar documentos reais em produção.
- Exportação PDF/DOCX de documentos: a versão atual fornece pré-visualização e HTML para impressão; a geração fiel de PDF/DOCX depende de biblioteca/serviço e templates revisados.
- Testes jurídicos, revisão LGPD, pentest e teste de isolamento multiempresa independente.

## Exclusão expressa

Não foi desenvolvido aplicativo nativo Android ou iOS. O frontend web é responsivo e acessível pelo navegador do celular.

## Validações realizadas no pacote

- `node --check` em todos os arquivos JavaScript do backend.
- Análise sintática de arquivos JS/JSX do frontend com TypeScript transpile: sem diagnósticos de sintaxe.
- Conferência de imports relativos: todos os caminhos locais conferidos existem.
- Contagem e verificação estrutural básica dos modelos Prisma.

## Validações ainda necessárias no ambiente do projeto

A instalação completa de dependências não terminou neste ambiente, portanto não foi possível executar o Prisma CLI nem o build Vite aqui. Após baixar o ZIP, execute `npm install`, `npm run db:validate`, `npm run db:generate`, crie a migração Prisma e execute `npm run build`. Corrija qualquer incompatibilidade relatada pelo CLI antes de publicar.
