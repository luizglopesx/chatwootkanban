require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { OpenAI } = require('openai');

const app = express();
app.use(express.json());

// Instância da OpenAI API
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Credenciais (Configure isso no arquivo .env)
const CHATWOOT_URL = process.env.CHATWOOT_URL;
const CHATWOOT_TOKEN = process.env.CHATWOOT_TOKEN;
const KANBANCW_URL = process.env.KANBANCW_URL;
const KANBANCW_HEADERS = {
    'access-token': process.env.KANBANCW_ACCESS_TOKEN,
    'client': process.env.KANBANCW_CLIENT,
    'uid': process.env.KANBANCW_UID,
    'token-type': 'Bearer',
    'content-type': 'application/json'
};

// Regras de detecção para o Funil de Crediário (por padrão de texto)
const CREDIARIO_RULES = [
    {
        pattern: /\[STATUS: success\]/i,
        stageId: process.env.KANBANCW_STAGE_ANALISE_ID,
        label: 'analise-credito',
        nome: 'Análise de Crédito'
    },
    {
        pattern: /fatura de energia el[eé]trica/i,
        stageId: process.env.KANBANCW_STAGE_PROPOSTA_ID,
        label: 'proposta-enviada',
        nome: 'Proposta Enviada'
    },
    {
        pattern: /an[aá]lise de cr[eé]dito realizada|sistema n[aã]o liberou ofertas/i,
        stageId: process.env.KANBANCW_STAGE_REPROVADO_ID,
        label: 'reprovado',
        nome: 'Reprovado'
    }
];

// Verifica se alguma mensagem do histórico bate com os padrões do crediário
function isCrediarioConversation(messages) {
    return messages.some(m => m.content && CREDIARIO_RULES.some(r => r.pattern.test(m.content)));
}

// Função auxiliar para mover card e adicionar label
async function moverCard(conversationId, accountId, stageId, label, nome) {
    await axios.patch(
        `${KANBANCW_URL}/api/kanban/${conversationId}/move`,
        { targetColumn: stageId },
        { headers: KANBANCW_HEADERS }
    );
    await axios.post(
        `${CHATWOOT_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}/labels`,
        { labels: [label] },
        { headers: { 'api_access_token': CHATWOOT_TOKEN } }
    );
    console.log(`[CREDIÁRIO] Conversa ${conversationId} → ${nome} (label: ${label})`);
}

app.post('/webhook/chatwoot', async (req, res) => {
    try {
        const payload = req.body;

        // ─── FUNIL DE CREDIÁRIO: detecção por padrão de texto em message_created ───
        if (payload.event === 'message_created' && payload.content) {
            const content = payload.content;
            const accountId = payload.account?.id || process.env.CHATWOOT_ACCOUNT_ID;
            const conversationId = payload.conversation?.id;

            if (!conversationId) return res.status(200).send('Ignorado: sem conversation_id.');

            for (const regra of CREDIARIO_RULES) {
                if (regra.pattern.test(content)) {
                    await moverCard(conversationId, accountId, regra.stageId, regra.label, regra.nome);
                    return res.status(200).send({ success: true, funil: 'crediario', stage: regra.nome });
                }
            }

            return res.status(200).send('Ignorado: mensagem não corresponde a nenhuma regra do crediário.');
        }

        // ─── FUNIL DE VENDAS / CREDIÁRIO via IA: conversation_status_changed ───
        if (payload.event !== 'conversation_status_changed' || !['resolved', 'snoozed'].includes(payload.status)) {
            return res.status(200).send('Ignorado: evento não relevante para qualificação.');
        }

        const accountId = payload.account?.id || process.env.CHATWOOT_ACCOUNT_ID;
        const conversationId = payload.id || payload.conversation_id;

        // Buscar o Histórico da Conversa no Chatwoot
        const historyResponse = await axios.get(
            `${CHATWOOT_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`,
            { headers: { 'api_access_token': CHATWOOT_TOKEN } }
        );

        const messages = historyResponse.data.payload || [];

        const historyText = messages
            .filter(m => m.content)
            .map(m => `${m.sender_type === 'Contact' ? 'Cliente' : 'Atendente'}: ${m.content}`)
            .join('\n');

        if (!historyText) return res.status(200).send('Sem histórico válido.');

        // ─── Detecta se é conversa de Crediário ───
        if (isCrediarioConversation(messages)) {
            console.log(`[CREDIÁRIO IA] Conversa ${conversationId} identificada como crediário. Classificando...`);

            const promptCrediario = `Você é um especialista em análise de crédito e vendas de colchões no crediário.
Analise o histórico de conversa abaixo e classifique em qual etapa do funil de crediário este lead se encontra.

## Definição das Etapas:
**ANALISE** — Lead em processo de análise de crédito:
- Enviou dados pessoais para análise
- Está aguardando resultado da consulta de crédito
- O sistema retornou [STATUS: success] (análise iniciada com sucesso)

**PROPOSTA** — Lead com crédito em avaliação ou proposta gerada:
- Foi solicitada fatura de energia elétrica
- Recebeu uma proposta de financiamento
- Está considerando as condições do crediário

**REPROVADO** — Lead com crédito negado:
- A análise de crédito foi realizada e não liberou ofertas
- O sistema não aprovou o financiamento

## Instrução:
Retorne APENAS uma das palavras abaixo, sem explicação, sem pontuação extra:
analise
proposta
reprovado`;

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: promptCrediario },
                    { role: "user", content: `Histórico:\n${historyText}` }
                ],
                temperature: 0.1
            });

            const stage = completion.choices[0].message.content.trim().toLowerCase();

            const stageMap = {
                'analise': { id: process.env.KANBANCW_STAGE_ANALISE_ID, label: 'analise-credito', nome: 'Análise de Crédito' },
                'proposta': { id: process.env.KANBANCW_STAGE_PROPOSTA_ID, label: 'proposta-enviada', nome: 'Proposta Enviada' },
                'reprovado': { id: process.env.KANBANCW_STAGE_REPROVADO_ID, label: 'reprovado', nome: 'Reprovado' }
            };

            const selected = stageMap[stage] || stageMap['analise'];

            await moverCard(conversationId, accountId, selected.id, selected.label, selected.nome);
            return res.status(200).send({ success: true, funil: 'crediario-ia', classification: stage });
        }

        // ─── FUNIL DE VENDAS: classificação com IA ───
        console.log(`[VENDAS] Conversa ${conversationId} classificando com IA...`);

        const promptSystem = `Você é um especialista em funil de vendas de colchões e produtos de sono.
Analise o histórico de conversa abaixo e classifique em qual etapa do funil de vendas este lead se encontra.

## Definição das Etapas:
**TOPO** — Lead recém chegado, ainda descobrindo o problema ou solução:
- Fez perguntas genéricas ("vocês vendem colchão?", "qual o preço?")
- Não demonstrou intenção clara de compra
- Pediu apenas informações básicas
- Ainda não mencionou modelo, tamanho ou condições

**MEIO** — Lead engajado, considerando a compra:
- Comparou modelos ou marcas
- Perguntou sobre formas de pagamento, parcelamento ou frete
- Pediu mais detalhes técnicos (densidade, espuma, molas)
- Demonstrou interesse em um produto específico
- Perguntou sobre prazo de entrega ou disponibilidade

**FUNDO** — Lead pronto para comprar ou em decisão final:
- Perguntou sobre desconto ou negociação de preço
- Pediu confirmação de estoque
- Mencionou data ou urgência de compra
- Está comparando apenas condições finais (frete, prazo, garantia)
- Disse que vai pensar mas já escolheu o produto

## Instrução:
Retorne APENAS uma das palavras abaixo, sem explicação, sem pontuação extra:
topo
meio
fundo`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: promptSystem },
                { role: "user", content: `Histórico:\n${historyText}` }
            ],
            temperature: 0.1
        });

        const stage = completion.choices[0].message.content.trim().toLowerCase();

        const stageIds = {
            'topo': process.env.KANBANCW_STAGE_TOPO_ID,
            'meio': process.env.KANBANCW_STAGE_MEIO_ID,
            'fundo': process.env.KANBANCW_STAGE_FUNDO_ID
        };
        const selectedStageId = stageIds[stage] || stageIds['topo'];

        if (selectedStageId) {
            await axios.patch(
                `${KANBANCW_URL}/api/kanban/${conversationId}/move`,
                { targetColumn: selectedStageId },
                { headers: KANBANCW_HEADERS }
            );
            await axios.post(
                `${CHATWOOT_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}/labels`,
                { labels: [stage] },
                { headers: { 'api_access_token': CHATWOOT_TOKEN } }
            );
            console.log(`[VENDAS] Conversa ${conversationId} classificada como ${stage} → stage ${selectedStageId}`);
        } else {
            console.log(`[AVISO] Conversa ${conversationId} classificada como ${stage}, mas o ID do Stage não foi configurado no .env.`);
        }

        res.status(200).send({ success: true, funil: 'vendas', classification: stage });

    } catch (error) {
        console.error('[ERRO]', error.response?.data || error.message);
        res.status(500).send('Erro interno do servidor');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando Webhook na porta ${PORT}`));
