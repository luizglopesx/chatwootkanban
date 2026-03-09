const CREDIARIO_RULES = [
    {
        pattern: /\[STATUS: success\]/i,
    },
    {
        pattern: /fatura de energia el[eé]trican/i,
    },
    {
        pattern: /an[aá]lise de cr[eé]dito realizada|sistema n[aã]o liberou ofertas/i,
    }
];

const messages1 = [
    { content: "Olá tudo bom" },
    { content: "Fatura de energia elétrica" },
    { content: "análise de crédito realizada" }
];

function isCrediarioConversation(messages) {
    return messages.some(m => m.content && CREDIARIO_RULES.some(r => r.pattern.test(m.content)));
}

console.log("Teste Crediário regex: ", isCrediarioConversation(messages1));
