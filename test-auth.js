const axios = require('axios');
async function test() {
    try {
        const res = await axios.get('https://kanban.senhorcolchao.com/kanban/boards', {
            headers: { 'api_access_token': 'e6a39d36-be78-4720-bdac-8b5735988221' }
        });
        console.log('API_ACCESS_TOKEN ok', res.data.length);
    } catch (e) {
        console.log('err1', e.response?.data);
    }
    
    try {
        const res = await axios.get('https://kanban.senhorcolchao.com/kanban/boards', {
            headers: { 'Authorization': 'Bearer e6a39d36-be78-4720-bdac-8b5735988221' }
        });
        console.log('Bearer ok', res.data.length);
    } catch (e) {
        console.log('err2', e.response?.data);
    }
}
test();
