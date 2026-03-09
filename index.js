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

// A IA agora fará o papel de identificar se é vendas ou crediário com base no contexto.
// Função auxiliar para reabrir a conversa no Chatwoot

// Função auxiliar para reabrir a conversa no Chatwoot
async function reopenConversation(conversationId, accountId) {
    try {
        await axios.post(
            `${CHATWOOT_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}/toggle_status`,
            { status: 'open' },
            { headers: { 'api_access_token': CHATWOOT_TOKEN } }
        );
        console.log(`[REABERTURA] Conversa ${conversationId} foi REABERTA no Chatwoot com sucesso!`);
    } catch (error) {
        console.error(`[ERRO REABERTURA] Falha ao reabrir a conversa ${conversationId}:`, error.response?.data || error.message);
    }
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
    
    // Reabrir o card logo em seguida para voltar a aparecer no kanban
    await reopenConversation(conversationId, accountId);
}

app.post('/webhook/chatwoot', async (req, res) => {
    try {
        const payload = req.body;

        // Funcionalidade de Regex no message_created foi removida, 
        // a triagem será feita via IA no status "resolved".

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

        // ─── EVITAR RE-AVALIAÇÃO DE CONVERSAS QUE JÁ FORAM CLASSIFICADAS OU ESTÃO PERDIDAS/REPROVADOS ───
        const existingLabels = payload.conversation?.labels || payload.labels || [];
        const hasBeenClassified = existingLabels.some(lbl => 
            ['analise-credito', 'proposta-enviada', 'reprovado', 'topo', 'meio', 'fundo', 'perdido'].includes(lbl)
        );

        if (hasBeenClassified) {
            console.log(`[IGNORADO] Conversa ${conversationId} resolvida novamente, porém já classificada/encerrada (${existingLabels.join(', ')}).`);
            return res.status(200).send('Ignorado: conversa já havia sido classificada ou possui label de finalização.');
        }

        // ─── TRIAGEM UNIVERSAL: Vendas ou Crediário? ───
        console.log(`[IA TRIAGEM] Conversa ${conversationId} - Analisando se é Vendas ou Crediário...`);

        const promptSystem = `Você é o classificador mestre da Senhor Colchão.
Sua missão é ler o histórico e colocar este lead em EXATAMENTE UMA das 6 caixas possíveis.

## Funil de Vendas (Consultor)
Se o cliente quer comprar, cotar preço, ou o bot diz que vai repassar para os Consultores de Vendas:
- **topo**: Dúvidas genéricas, sem falar modelo ("qual preço?", "vende colchão?")
- **meio**: Engajado, escolhendo produto, perguntando de frete, tamanho ("no boleto faz?", "qual a densidade?")
- **fundo**: Pronto pra comprar, negociando desconto, batendo o martelo final.

## Funil de Crediário (Crefaz/Energia)
Se na conversa eles falam de "parcelamento na conta de luz", "simulação de limite", pedem documentos:
- **analise-credito**: Estão pedindo dados ou falaram de simulação / análise de crédito, ou o sistema deu [STATUS: success]
- **proposta-enviada**: Pediram a fatura de luz / aprovaram o crédito e mandaram proposta
- **reprovado**: Análise de crédito reprovou / não liberou ofertas

## Instrução:
Lembre-se: O cliente que perguntou de boleto e recebeu negativa mas começou a ver crediário entra na caixinha do crediário. 
Responda APENAS com UMA destas palavras EXATAS:
topo
meio
fundo
analise-credito
proposta-enviada
reprovado`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: promptSystem },
                { role: "user", content: `Histórico:\n${historyText}` }
            ],
            temperature: 0.1
        });

        const stage = completion.choices[0].message.content.trim().toLowerCase();

        // Mapeamento dos IDs baseados na resposta
        const stageIds = {
            'topo':             { id: process.env.KANBANCW_STAGE_TOPO_ID,      nome: 'Topo (Vendas)' },
            'meio':             { id: process.env.KANBANCW_STAGE_MEIO_ID,      nome: 'Meio (Vendas)' },
            'fundo':            { id: process.env.KANBANCW_STAGE_FUNDO_ID,     nome: 'Fundo (Vendas)' },
            'analise-credito':  { id: process.env.KANBANCW_STAGE_ANALISE_ID,   nome: 'Análise (Crediário)' },
            'proposta-enviada': { id: process.env.KANBANCW_STAGE_PROPOSTA_ID,  nome: 'Proposta (Crediário)' },
            'reprovado':        { id: process.env.KANBANCW_STAGE_REPROVADO_ID, nome: 'Reprovado (Crediário)' }
        };

        const selected = stageIds[stage];

        if (selected && selected.id) {
            await moverCard(conversationId, accountId, selected.id, stage, selected.nome);
        } else {
            console.log(`[AVISO] Conversa ${conversationId} classificada como ${stage}, mas o ID não existe ou retornou valor inesperado.`);
        }

        res.status(200).send({ success: true, funil: 'vendas', classification: stage });

    } catch (error) {
        console.error('[ERRO]', error.response?.data || error.message);
        res.status(500).send('Erro interno do servidor');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando Webhook na porta ${PORT}`));
