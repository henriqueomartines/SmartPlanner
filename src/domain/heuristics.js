/**
 * @fileoverview Categorização Heurística Rápida e Extração Determinística de Entidades (RN-06).
 * Analisa entradas em linguagem natural sem dependência de LLMs ou APIs externas.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SmartPlanner = root.SmartPlanner || {};
        root.SmartPlanner.Heuristics = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * Remove acentos e normaliza texto para comparação determinística.
     * @param {string} text
     * @returns {string}
     */
    function normalizeText(text) {
        return String(text || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
    }

    /**
     * Dicionário léxico determinístico conforme RN-06:
     * - Acadêmico: "prova", "tcc", "estudar", "aula", etc.
     * - Trabalho: "reunião", "relatório", "projeto", etc.
     * - Pessoal: "treino", "médico", "compras", "pagar", etc.
     * - Geral: Categoria padrão caso nenhum termo seja identificado.
     */
    const CATEGORY_KEYWORDS = {
        'Acadêmico': [
            'prova', 'tcc', 'estudar', 'estudo', 'aula', 'faculdade', 'universidade',
            'calculo', 'algoritmo', 'banco de dados', 'engenharia', 'artigo', 'seminario',
            'monografia', 'dissertacao', 'exercicio', 'lista de exercicios', 'revisao',
            'laboratorio', 'disciplina', 'materia', 'capítulo', 'capitulo', 'abnt',
            'feynman', 'pomodoro', 'vestibular', 'leitura academica', 'resumo'
        ],
        'Trabalho': [
            'reuniao', 'relatorio', 'projeto', 'cliente', 'sprint', 'deploy', 'entrega',
            'apresentacao', 'alinhamento', 'orcamento', 'proposta', 'call', 'daily',
            'feedback', 'gestao', 'planilha', 'contrato', 'servidor', 'produção', 'producao',
            'bug', 'feature', 'roadmap', 'expediente', 'escritorio'
        ],
        'Pessoal': [
            'treino', 'medico', 'compras', 'pagar', 'academia', 'corrida', 'caminhada',
            'mercado', 'supermercado', 'consulta', 'dentista', 'exame', 'farmacia',
            'boleto', 'conta', 'banco', 'familia', 'casa', 'limpeza', 'almoco',
            'jantar', 'terapia', 'descanso', 'viagem', 'lazer', 'dormir'
        ]
    };

    /**
     * RN-06: Identifica a categoria automaticamente por varredura de palavras-chave.
     * @param {string} rawText
     * @returns {{ category: string, matchedKeyword: string|null }}
     */
    function detectCategoryByKeywords(rawText) {
        const normalized = normalizeText(rawText);
        if (!normalized) {
            return { category: 'Geral', matchedKeyword: null };
        }

        for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
            for (const kw of keywords) {
                const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(?:^|\\s|[,.;:!?()\\-/])${escaped}(?:$|\\s|s|es|[,.;:!?()\\-/])`, 'i');
                if (regex.test(normalized) || normalized.includes(kw)) {
                    return { category, matchedKeyword: kw };
                }
            }
        }

        return { category: 'Geral', matchedKeyword: null };
    }

    /**
     * Extrai duração estimada em minutos a partir de expressões como:
     * "por 45min", "90 min", "1h30", "2 horas", "1.5h"
     * @param {string} rawText
     * @returns {number|null}
     */
    function extractDurationMinutes(rawText) {
        const normalized = normalizeText(rawText);

        // Padrão 1h30, 2h15m
        const hmMatch = normalized.match(/\b(\d{1,2})\s*h(?:oras?)?\s*(?:e\s*)?(\d{1,2})\s*(?:m|min|minutos?)?\b/);
        if (hmMatch) {
            const h = parseInt(hmMatch[1], 10);
            const m = parseInt(hmMatch[2], 10);
            const total = h * 60 + m;
            if (total >= 5 && total <= 720) return total;
        }

        // Padrão "45 min", "90min", "30 minutos"
        const minMatch = normalized.match(/\b(\d{1,3})\s*(?:min|minutos?|m)\b/);
        if (minMatch) {
            const mins = parseInt(minMatch[1], 10);
            if (mins >= 5 && mins <= 720) return mins;
        }

        // Padrão "2h", "1 hora", "3 horas"
        const hourMatch = normalized.match(/\b(\d{1,2}(?:[.,]\d)?)\s*(?:h|horas?)\b/);
        if (hourMatch) {
            const hours = parseFloat(hourMatch[1].replace(',', '.'));
            const total = Math.round(hours * 60);
            if (total >= 5 && total <= 720) return total;
        }

        return null;
    }

    /**
     * Extrai horário fixo se presente (ex: "às 14:00", "as 09h30", "16:00")
     * @param {string} rawText
     * @returns {string|null} Horário no formato "HH:MM"
     */
    function extractStartTime(rawText) {
        const normalized = normalizeText(rawText);
        const match = normalized.match(/(?:as|de|das|@|\b)\s*([01]?\d|2[0-3])(?:h|:)([0-5]\d)\b/) ||
                      normalized.match(/\b(?:as|@)\s*([01]?\d|2[0-3])\s*h\b/);
        if (match) {
            const hh = String(parseInt(match[1], 10)).padStart(2, '0');
            const mm = match[2] ? String(parseInt(match[2], 10)).padStart(2, '0') : '00';
            return `${hh}:${mm}`;
        }
        return null;
    }

    /**
     * Extrai sinais heurísticos de urgência e importância do texto.
     * @param {string} rawText
     * @param {string} category
     * @returns {{ urgency: number, importance: number, daysOffset: number }}
     */
    function extractPrioritySignals(rawText, category) {
        const normalized = normalizeText(rawText);
        let urgency = 3.0;
        let importance = 3.5;
        let daysOffset = 0;

        if (category === 'Acadêmico') importance = 4.0;
        if (category === 'Trabalho') importance = 4.0;

        if (/\b(urgente|critico|imediato|agora|hoje|prova|entrega)\b/.test(normalized)) {
            urgency = Math.max(urgency, 4.5);
        }
        if (/\b(importante|tcc|exame|apresentacao|final|cliente)\b/.test(normalized)) {
            importance = Math.max(importance, 4.5);
        }
        if (/\b(opcional|depois|talvez|baixa prioridade|quando der)\b/.test(normalized)) {
            urgency = 2.0;
            importance = 2.0;
        }

        if (/\b(amanha)\b/.test(normalized)) {
            daysOffset = 1;
        } else if (/\b(semana que vem|proxima semana)\b/.test(normalized)) {
            daysOffset = 7;
        }

        return { urgency, importance, daysOffset };
    }

    /**
     * Realiza o parse completo de uma string da Caixa de Adição Rápida Heurística.
     * @param {string} rawInput
     * @param {Date} [referenceDate]
     * @returns {Object} Dados estruturados da tarefa + metadados de detecção
     */
    function parseQuickTaskInput(rawInput, referenceDate) {
        const text = String(rawInput || '').trim();
        const { category, matchedKeyword } = detectCategoryByKeywords(text);
        const extractedDuration = extractDurationMinutes(text);
        const extractedTime = extractStartTime(text);
        const { urgency, importance, daysOffset } = extractPrioritySignals(text, category);

        const baseDate = referenceDate ? new Date(referenceDate) : new Date();
        baseDate.setDate(baseDate.getDate() + daysOffset);
        const yyyy = baseDate.getFullYear();
        const mm = String(baseDate.getMonth() + 1).padStart(2, '0');
        const dd = String(baseDate.getDate()).padStart(2, '0');
        const deadline = `${yyyy}-${mm}-${dd}`;

        // Limpa sufixos explícitos de duração/horário apenas se desejar manter título limpo,
        // mas preserva o sentido natural digitado pelo usuário
        const cleanTitle = text.replace(/\s+/g, ' ').trim();

        return {
            title: cleanTitle,
            category,
            matchedKeyword,
            duration: extractedDuration || 60,
            durationExtracted: Boolean(extractedDuration),
            startTime: extractedTime,
            isFixed: Boolean(extractedTime),
            urgency,
            importance,
            deadline
        };
    }

    return {
        normalizeText,
        CATEGORY_KEYWORDS,
        detectCategoryByKeywords,
        extractDurationMinutes,
        extractStartTime,
        parseQuickTaskInput
    };
});
