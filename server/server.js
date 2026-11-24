/**
 * @fileoverview Servidor HTTP + API REST Ful-Stack (Node.js v24 + SQLite Nativo).
 * Serve os arquivos estáticos da SPA e disponibiliza persistência ACID em SQLite.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const dbLayer = require('./db.js');
const Scheduler = require('../src/domain/scheduler.js');

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = path.join(__dirname, '..');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(body);
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', (chunk) => {
            raw += chunk;
            if (raw.length > 5 * 1024 * 1024) {
                reject(new Error('Payload excede 5MB'));
            }
        });
        req.on('end', () => {
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch (e) {
                reject(new Error('JSON inválido'));
            }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    try {
        const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = urlObj.pathname;

        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            });
            return res.end();
        }

        // Rotas da API REST
        if (pathname === '/api/health' && req.method === 'GET') {
            const state = dbLayer.getAllState();
            return sendJson(res, 200, {
                status: 'ok',
                engine: 'Node.js ' + process.version + ' + node:sqlite (WAL)',
                dbFile: path.basename(dbLayer.DB_PATH),
                taskCount: state.tasks.length
            });
        }

        if (pathname === '/api/state' && req.method === 'GET') {
            const state = dbLayer.getAllState();
            return sendJson(res, 200, state);
        }

        if (pathname === '/api/state' && req.method === 'PUT') {
            const body = await readJsonBody(req);
            const updated = dbLayer.saveAllState({
                tasks: body.tasks,
                settings: body.settings
            });
            return sendJson(res, 200, updated);
        }

        if (pathname === '/api/schedule' && req.method === 'POST') {
            const current = dbLayer.getAllState();
            const result = Scheduler.autoScheduleTimeBlocks(current.tasks, current.settings);
            dbLayer.saveAllState({ tasks: result.tasks, settings: current.settings });
            return sendJson(res, 200, result);
        }

        if (pathname === '/api/reset-demo' && req.method === 'POST') {
            dbLayer.seedDatabase();
            const freshState = dbLayer.getAllState();
            return sendJson(res, 200, freshState);
        }

        // Servidor de Arquivos Estáticos
        const safePath = pathname === '/' ? '/index.html' : pathname;
        const resolvedPath = path.normalize(path.join(ROOT_DIR, safePath));

        if (!resolvedPath.startsWith(ROOT_DIR)) {
            return sendJson(res, 403, { error: 'Acesso negado' });
        }

        if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
            const ext = path.extname(resolvedPath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            const content = fs.readFileSync(resolvedPath);
            res.writeHead(200, { 'Content-Type': contentType });
            return res.end(content);
        }

        sendJson(res, 404, { error: 'Recurso não encontrado' });
    } catch (err) {
        console.error('[SmartPlanner Server Error]:', err);
        sendJson(res, 500, { error: err.message || 'Erro interno no servidor' });
    }
});

if (require.main === module) {
    // Inicializa o banco ao subir o servidor
    dbLayer.getDb();
    server.listen(PORT, () => {
        console.log('==============================================================');
        console.log('  SmartPlanner v2.0 — Agenda Inteligente Determinística');
        console.log(`  Servidor Full-Stack Ativo: http://localhost:${PORT}`);
        console.log(`  Banco de Dados SQLite:     ${dbLayer.DB_PATH}`);
        console.log('==============================================================');
    });
}

module.exports = { server };
