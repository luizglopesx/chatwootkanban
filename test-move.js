require('dotenv').config();
const axios = require('axios');

async function testMove() {
    const KANBANCW_URL = process.env.KANBANCW_URL;
    const KANBANCW_HEADERS = {
        'access-token': process.env.KANBANCW_ACCESS_TOKEN,
        'client': process.env.KANBANCW_CLIENT,
        'uid': process.env.KANBANCW_UID,
        'token-type': 'Bearer',
        'content-type': 'application/json'
    };

    try {
        console.log(`Testando PATCH para ${KANBANCW_URL}/api/kanban/9999999/move`);
        const response = await axios.patch(`${KANBANCW_URL}/api/kanban/9999999/move`, { targetColumn: 10 }, { headers: KANBANCW_HEADERS });
        console.log('✅ Sucesso!', response.data);
    } catch (error) {
        console.log('❌ STATUS:', error.response?.status);
        console.log('   MENSAGEM:', error.message);
        console.log('   DADOS:', error.response?.data);
    }
}
testMove();
