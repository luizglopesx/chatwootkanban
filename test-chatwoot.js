const axios = require('axios');
async function test() {
    try {
        const res = await axios.get('https://chatwoot.senhorcolchao.com/api/v1/accounts/1/conversations?status=all', {
            headers: { 'api_access_token': 'U6fLPxGPCc4Mu4kvAAvY6qSE' }
        });
        console.log('Chatwoot API ok', res.data.data.meta.mine_count);
    } catch (e) {
        console.log('Chatwoot err', e.response?.data);
    }
}
test();
