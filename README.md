# SmartPlanner v2.0 — Agenda Inteligente de Produtividade (Determinística)

Implementação completa, modular e determinística do projeto acadêmico **Agenda Inteligente de Produtividade**, projetada com **Arquitetura Híbrida Dual-Mode** (Node.js v24 + `node:sqlite` nativo com fallback 100% Client-Side via `LocalStorage`).

---

## Por que esta Arquitetura, Linguagem e Modelo?

1. **Zero Dependências Frágeis & Execução Instantânea (`JavaScript ES2024 + Node.js v24 + node:sqlite`)**:
   - Em vez de depender de compilações pesadas de Java/Maven ou pacotes C++ externos, o projeto utiliza o módulo nativo **`node:sqlite` (`DatabaseSync`)** e o servidor HTTP nativo do **Node.js v24**.
   - **Arquitetura Dual-Mode (Full-Stack SQLite + Standalone Offline)**:
     - **Modo Full-Stack (`npm start` ou `iniciar.bat`)**: Persiste todas as tarefas, checklists e configurações em um banco relacional SQLite (`smartplanner.db` em modo WAL com integridade referencial `ON DELETE CASCADE`) em `http://localhost:3000`.
     - **Modo 100% Client-Side Offline (RNF-03)**: Caso o arquivo `index.html` seja aberto diretamente no navegador (`file://`), o adaptador de repositório (`src/storage/repository.js`) opera automaticamente no `LocalStorage`, sem exigir servidor.
2. **Módulos de Domínio Isomórficos (UMD)**:
   - Os motores matemáticos em `src/domain/` rodam identicamente no navegador e no Node.js, permitindo validação automatizada via `npm test` (`node --test`).

---

## Modelo Matemático e Regras de Negócio (RN-01 a RN-07)

| Código | Regra | Especificação Implementada | Arquivo |
| :--- | :--- | :--- | :--- |
| **RN-01** | **Score de Prioridade** | $\text{Score} = (U \times 0,4) + (I \times 0,4) + \left(\frac{100}{\text{DiasParaOPrazo} + 1} \times 0,2\right) + \Delta_{\text{foco}}$. Se vencido ($\text{Dias} < 0$), fator prazo $= 100$. | `src/domain/scoring.js` |
| **RN-02** | **Time-Blocking Automático** | Algoritmo *First-Fit Decreasing* por varredura de intervalos contínuos livres no expediente configurável (padrão `08:00` às `18:00`). | `src/domain/scheduler.js` |
| **RN-03** | **Matriz de Eisenhower** | Classificação dinâmica em 4 quadrantes (`Q1`, `Q2`, `Q3`, `Q4`) com corte exato em **$3,5$** para Urgência e Importância + plano cartesiano 2D. | `src/domain/scoring.js` |
| **RN-04** | **Progresso por Subtarefas** | Percentual calculado por $\frac{\text{subtarefas concluídas}}{\text{total}} \times 100$. A tarefa principal atinge status *Concluída* automaticamente em `100%`. | `src/domain/scoring.js` |
| **RN-05** | **Prevenção de Conflitos** | Validação matemática de interseção $[S_1, E_1) \cap [S_2, E_2) \neq \emptyset$ antes da gravação de compromissos com horário fixo. | `src/domain/scheduler.js` |
| **RN-06** | **Categorização Heurística** | Reconhecimento léxico instantâneo sem IA externa para **Acadêmico**, **Trabalho**, **Pessoal** e **Geral**, além de extração de duração (`90min`, `2h`) e horário (`às 14:00`). | `src/domain/heuristics.js` |
| **RN-07** | **Gerador de Planos de Estudo** | Modelos estruturados para **Pomodoro** ($4\times 25\text{m} + 3\times 5\text{m} + 1\times 15\text{m}$), **Técnica Feynman** ($45\text{m} / 30\text{m} / 30\text{m}$) e **Estudo Intercalado** (2 disciplinas em blocos de $40\text{m} + 10\text{m}$). | `src/domain/studyPlans.js` |

---

## Como Executar e Testar

### 1. Executar em Modo Full-Stack (com SQLite)
Basta dar duplo clique em **`iniciar.bat`** ou rodar no terminal:
```bash
npm start
```
Acesse **`http://localhost:3000`** no navegador.

### 2. Executar em Modo 100% Offline (Client-Side)
Basta abrir o arquivo **`index.html`** diretamente em qualquer navegador moderno (Chrome, Edge, Firefox, Safari).

### 3. Executar a Suíte Automatizada de Testes (RN-01 a RN-07 e RNF-01)
```bash
npm test
```
