require('dotenv').config();
const axios = require('axios');

async function testKanban() {
    const KANBANCW_URL = process.env.KANBANCW_URL;
    const KANBANCW_HEADERS = {
        'access-token': process.env.KANBANCW_ACCESS_TOKEN,
        'client': process.env.KANBANCW_CLIENT,
        'uid': process.env.KANBANCW_UID,
        'token-type': 'Bearer',
        'content-type': 'application/json'
    };

    console.log('Testando autenticação no KanbanCW com credenciais Devise...');
    try {
        const response = await axios.get(`${KANBANCW_URL}/kanban/boards`, { headers: KANBANCW_HEADERS });
        console.log('✅ Sucesso! Devise Tokens ainda são válidos. Total de boards:', response.data.length);
    } catch (error) {
        console.error('❌ Erro de Autenticação KanbanCW JWT/Devise:');
        console.error(error.response?.status, error.response?.data || error.message);
    }
}

testKanban();
