# API — exemplos rápidos

Todas as rotas do painel usam a sessão `imob_session` (cookie HttpOnly). O portal usa `imob_portal_session`.

## Criar escritório (somente desenvolvimento)

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "tenantName": "Escritório Modelo",
  "name": "Responsável",
  "email": "responsavel@example.com",
  "password": "SenhaForte123"
}
```

## Criar cliente

```http
POST /api/v1/clients
Content-Type: application/json

{
  "type": "PERSON",
  "name": "Maria da Silva",
  "document": "00000000000",
  "email": "maria@example.com",
  "phone": "88999990000",
  "city": "Crateús",
  "state": "CE"
}
```

## Criar imóvel

```http
POST /api/v1/properties
Content-Type: application/json

{
  "type": "RURAL",
  "title": "Sítio Boa Vista",
  "city": "Crateús",
  "state": "CE",
  "areaValue": "12.5",
  "areaUnit": "ha"
}
```

## Criar modelo de serviço

```http
POST /api/v1/service-templates
Content-Type: application/json

{
  "name": "Regularização de imóvel rural",
  "description": "Fluxo interno configurado pelo escritório.",
  "category": "Imóveis rurais",
  "stages": [
    { "name": "Atendimento inicial", "visibleToClient": true },
    { "name": "Análise documental", "visibleToClient": true },
    { "name": "Encaminhamento", "visibleToClient": true }
  ],
  "documentRequirements": [
    { "name": "Documento de identificação", "required": true, "allowClientUpload": true },
    { "name": "Documentação do imóvel", "required": true, "allowClientUpload": true }
  ]
}
```

## Criar procedimento

```http
POST /api/v1/cases
Content-Type: application/json

{
  "clientId": "ID_DO_CLIENTE",
  "propertyId": "ID_DO_IMOVEL",
  "templateId": "ID_DO_MODELO",
  "title": "Regularização — Sítio Boa Vista",
  "priority": "NORMAL"
}
```

Na criação, as etapas e exigências documentais da versão atual do modelo são copiadas para o procedimento.

## Convidar cliente para o portal

```http
POST /api/v1/clients/ID_DO_CLIENTE/portal-invites
Content-Type: application/json

{ "email": "cliente@example.com" }
```

A resposta contém `activationUrl`, com validade de 48 horas. A integração com provedor de e-mail deve ser feita antes da produção.

## Upload privado

1. `POST /api/v1/documents/presign` com `caseId`, `fileName`, `mimeType` e `sizeBytes`.
2. Fazer `PUT` do arquivo na `uploadUrl`, enviando exatamente o header `Content-Type` retornado.
3. `POST /api/v1/documents/complete` com `caseId`, `storageKey`, `fileName`, `mimeType` e opcionalmente `requestId`.

O processo equivalente do cliente usa `/api/v1/portal/documents/presign` e `/api/v1/portal/documents/complete`.


## Atendimento do portal

- `GET /api/v1/portal/requests`: solicitações do cliente autenticado no portal.
- `POST /api/v1/portal/requests`: abre solicitação e primeira mensagem.
- `POST /api/v1/portal/requests/:requestId/messages`: responde dentro de solicitação aberta.
- `GET /api/v1/portal-requests`: caixa de entrada do escritório (permissão `portal.requests.read`).
- `PATCH /api/v1/portal-requests/:requestId`: atualiza situação (permissão `portal.requests.manage`).
- `POST /api/v1/portal-requests/:requestId/messages`: resposta da equipe ao cliente (permissão `portal.requests.manage`).
