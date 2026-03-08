require('dotenv').config();
const axios = require('axios');

async function getKanbanData() {
    const kanbanUrl = process.env.KANBANCW_URL;
    const token = process.env.KANBANCW_TOKEN;

    if (!kanbanUrl || !token || token === 'seu_bearer_token_kanbancw') {
        console.error('❌ ERRO: Você precisa definir o KANBANCW_TOKEN real no arquivo .env antes de rodar este script.');
        return;
    }

    try {
        console.log(`Buscando Boards (Funis) em: ${kanbanUrl}/kanban/boards\n`);
        
        const response = await axios.get(`${kanbanUrl}/kanban/boards`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const boards = response.data;
        
        if (!boards || boards.length === 0) {
            console.log('Nenhum Funil/Board encontrado na sua conta do KanbanCW.');
            return;
        }

        boards.forEach(board => {
            console.log('=========================================');
            console.log(`🟢 FUNIL: ${board.name} (ID: ${board.id})`);
            console.log('=========================================');
            
            if (board.stages && board.stages.length > 0) {
                console.log('Estágios (Colunas) e seus respectivos IDs:\n');
                board.stages.forEach(stage => {
                    console.log(`  ➡ Nome da Coluna: "${stage.name}"`);
                    console.log(`     ID p/ colocar no .env: ${stage.id}\n`);
                });
            } else {
                console.log('  Nenhum estágio/coluna encontrado neste funil.\n');
            }
        });

        console.log('\n✅ Script finalizado! Copie os IDs acima e cole no seu arquivo .env');

    } catch (error) {
        console.error('❌ ERRO ao acessar a API do KanbanCW:');
        console.error(error.response?.data || error.message);
    }
}

getKanbanData();
