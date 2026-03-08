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

app.post('/webhook/chatwoot', async (req, res) => {
    try {
        const payload = req.body;

        // 1. Filtrar o gatilho. Ex: Só executar quando o status da conversa for atualizado para 'resolved' ou 'snoozed'
        if (payload.event !== 'conversation_status_changed' && !['resolved', 'snoozed'].includes(payload.status)) {
            return res.status(200).send('Ignorado: evento não relevante para qualificação.');
        }

        const accountId = payload.account?.id || process.env.CHATWOOT_ACCOUNT_ID;
        const conversationId = payload.id || payload.conversation_id;

        // 2. Buscar o Histórico da Conversa no Chatwoot
        const historyResponse = await axios.get(
            `${CHATWOOT_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`,
            { headers: { 'api_access_token': CHATWOOT_TOKEN } }
        );

        const messages = historyResponse.data.payload || [];
        
        // Filtrar apenas mensagens com texto e formatar como um chat amigável para a IA
        const historyText = messages
            .filter(m => m.content)
            .map(m => `${m.sender_type === 'Contact' ? 'Cliente' : 'Atendente'}: ${m.content}`)
            .join('\n');

        if (!historyText) return res.status(200).send('Sem histórico válido.');

        // 3. Classificar o lead via AI Agent
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

        // 4. Mover o lead no Funil KanbanCW

        // Mapeamento dos stages do Funil (você precisa pegar esses IDs na API /funnels ou na interface do KanbanCW)
        const stageIds = {
            'topo': process.env.KANBANCW_STAGE_TOPO_ID,
            'meio': process.env.KANBANCW_STAGE_MEIO_ID,
            'fundo': process.env.KANBANCW_STAGE_FUNDO_ID
        };
        const selectedStageId = stageIds[stage] || stageIds['topo'];

        // Chamada para a API do KanbanCW
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
            console.log(`[SUCESSO] Conversa ${conversationId} classificada como ${stage} e movida para o stage ${selectedStageId}`);
        } else {
            console.log(`[AVISO] Conversa ${conversationId} classificada como ${stage}, mas o ID do Stage não foi configurado no .env.`);
        }

        res.status(200).send({ success: true, classification: stage });

    } catch (error) {
        console.error('[ERRO]', error.response?.data || error.message);
        res.status(500).send('Erro interno do servidor');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando Webhook na porta ${PORT}`));
