/**
 * PRISM AST Parsing & Symbol Call-Graph Test Suite (P1-03)
 */
const assert = require('node:assert');
const path = require('node:path');
const { parseCodeEntities } = require('../../src/ingestion/astParser');
const { SymbolCallGraph } = require('../../src/ingestion/symbolGraph');
const { getDatabase, initDatabase } = require('../../src/db/database');

function runAstSymbolGraphTests() {
  console.log('\n=====================================================');
  console.log('🌳 RUNNING PRISM AST & SYMBOL CALL GRAPH TESTS (P1-03)');
  console.log('=====================================================');

  let passedCount = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✔ ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`  ✖ FAIL: ${name}`);
      console.error(err);
      throw err;
    }
  }

  // Ensure database is initialized with migrations
  initDatabase();
  const db = getDatabase();

  test('Test 1: JavaScript AST parsing extracts functions, classes, methods and call sites', () => {
  const jsCode = `
    class OrderProcessor {
      processOrder(orderId, amount) {
        validateOrder(orderId);
        chargePayment(amount);
        return true;
      }
    }

    function validateOrder(id) {
      checkDatabase(id);
    }

    const chargePayment = (amt) => {
      gatewayCharge(amt);
    };
  `;

  const { symbols } = parseCodeEntities(jsCode, 'src/orders.js');
  assert.ok(Array.isArray(symbols));
  assert.strictEqual(symbols.length, 4);

  const orderClass = symbols.find(s => s.name === 'OrderProcessor');
  assert.strictEqual(orderClass.kind, 'CLASS');

  const processMethod = symbols.find(s => s.name === 'processOrder');
  assert.strictEqual(processMethod.kind, 'METHOD');
  assert.deepStrictEqual(processMethod.parameters, ['orderId', 'amount']);
  assert.ok(processMethod.calls.some(c => c.name === 'validateOrder'));
  assert.ok(processMethod.calls.some(c => c.name === 'chargePayment'));

  const validateFunc = symbols.find(s => s.name === 'validateOrder');
  assert.strictEqual(validateFunc.kind, 'FUNCTION');
  assert.deepStrictEqual(validateFunc.parameters, ['id']);
  assert.ok(validateFunc.calls.some(c => c.name === 'checkDatabase'));

  const chargeArrow = symbols.find(s => s.name === 'chargePayment');
  assert.strictEqual(chargeArrow.kind, 'FUNCTION');
  assert.deepStrictEqual(chargeArrow.parameters, ['amt']);
});

test('Test 2: Python AST parsing extracts classes, methods and functions', () => {
  const pyCode = `
class UserManager:
    def authenticate(self, username, password):
        user = find_user(username)
        return verify_hash(user, password)

def find_user(name):
    query_db(name)
  `;

  const { symbols } = parseCodeEntities(pyCode, 'auth/manager.py');
  assert.strictEqual(symbols.length, 3);

  const userClass = symbols.find(s => s.name === 'UserManager');
  assert.strictEqual(userClass.kind, 'CLASS');

  const authMethod = symbols.find(s => s.name === 'authenticate');
  assert.strictEqual(authMethod.kind, 'METHOD');
  assert.ok(authMethod.calls.some(c => c.name === 'find_user'));
  assert.ok(authMethod.calls.some(c => c.name === 'verify_hash'));

  const findFunc = symbols.find(s => s.name === 'find_user');
  assert.strictEqual(findFunc.kind, 'FUNCTION');
  assert.ok(findFunc.calls.some(c => c.name === 'query_db'));
});

test('Test 3: Go AST parsing extracts functions, structs and methods', () => {
  const goCode = `
package service

type Config struct {
    Port int
}

func StartServer(cfg Config) {
    initLogger()
    listen(cfg.Port)
}

func (s *Server) Stop() {
    closeConn()
}
  `;

  const { symbols } = parseCodeEntities(goCode, 'pkg/server.go');
  assert.strictEqual(symbols.length, 3);

  const structSym = symbols.find(s => s.name === 'Config');
  assert.strictEqual(structSym.kind, 'CLASS');

  const startFunc = symbols.find(s => s.name === 'StartServer');
  assert.strictEqual(startFunc.kind, 'FUNCTION');
  assert.deepStrictEqual(startFunc.parameters, ['cfg']);
  assert.ok(startFunc.calls.some(c => c.name === 'initLogger'));

  const stopMethod = symbols.find(s => s.name === 'Stop');
  assert.strictEqual(stopMethod.kind, 'METHOD');
  assert.ok(stopMethod.calls.some(c => c.name === 'closeConn'));
});

test('Test 4: SymbolCallGraph resolves caller-callee links and transitive blast radius', () => {
  const graph = new SymbolCallGraph('repo_test_1');
  const mockSymbols = [
    { id: 's1', name: 'handleHttpRequest', calls: [{ name: 'authService' }] },
    { id: 's2', name: 'authService', calls: [{ name: 'queryDatabase' }] },
    { id: 's3', name: 'queryDatabase', calls: [{ name: 'poolConnect' }] },
    { id: 's4', name: 'poolConnect', calls: [] },
    { id: 's5', name: 'unrelatedHelper', calls: [] }
  ];

  graph.loadSymbols(mockSymbols);

  // If poolConnect breaks, it should affect queryDatabase -> authService -> handleHttpRequest
  const blast = graph.getBlastRadius('poolConnect', 5);
  assert.strictEqual(blast.root.name, 'poolConnect');
  assert.strictEqual(blast.totalCount, 3);
  assert.ok(blast.affectedSymbols.some(s => s.name === 'queryDatabase'));
  assert.ok(blast.affectedSymbols.some(s => s.name === 'authService'));
  assert.ok(blast.affectedSymbols.some(s => s.name === 'handleHttpRequest'));
  assert.strictEqual(blast.affectedSymbols.some(s => s.name === 'unrelatedHelper'), false);
  assert.strictEqual(blast.blastLevel, 'MEDIUM');
});

test('Test 5: Symbol persistence and query plan indexing', () => {
  const repoId = `repo_${Date.now()}`;
  // Insert test project and repo
  db.prepare(`
    INSERT INTO organizations (id, name, slug, created_at, updated_at)
    VALUES ('org_ast_test', 'AST Org', 'ast-org', datetime('now'), datetime('now'))
    ON CONFLICT DO NOTHING
  `).run();

  db.prepare(`
    INSERT INTO projects (id, organization_id, name, description, status, created_at, updated_at)
    VALUES ('proj_ast_test', 'org_ast_test', 'AST Proj', 'ast-proj-desc', 'ACTIVE', datetime('now'), datetime('now'))
    ON CONFLICT DO NOTHING
  `).run();

  db.prepare(`
    INSERT INTO repositories (id, project_id, url, provider, status, created_at)
    VALUES (?, 'proj_ast_test', 'https://github.com/test/repo.git', 'GITHUB', 'INDEXED', datetime('now'))
  `).run(repoId);

  const rawParsed = [
    {
      filePath: 'src/index.js',
      symbols: [
        { name: 'main', kind: 'FUNCTION', start_line: 1, end_line: 10, parameters: [], calls: [{ name: 'initApp', line: 5 }] },
        { name: 'initApp', kind: 'FUNCTION', start_line: 11, end_line: 20, parameters: ['cfg'], calls: [] }
      ]
    }
  ];

  const result = SymbolCallGraph.persistGraph(db, repoId, rawParsed);
  assert.strictEqual(result.symbolCount, 2);

  const dbSymbols = db.prepare('SELECT * FROM repository_symbols WHERE repository_id = ?').all(repoId);
  assert.strictEqual(dbSymbols.length, 2);

  const dbCalls = db.prepare('SELECT * FROM symbol_call_graphs WHERE repository_id = ?').all(repoId);
  assert.strictEqual(dbCalls.length, 1);
  assert.strictEqual(dbCalls[0].callee_name, 'initApp');
  assert.ok(dbCalls[0].callee_symbol_id !== null);

  // Check query plan uses indexes
  const explain = db.prepare('EXPLAIN QUERY PLAN SELECT * FROM repository_symbols WHERE repository_id = ? AND name = ?').all(repoId, 'main');
  const planDetail = explain.map(e => e.detail).join(' ');
  assert.ok(planDetail.includes('USING INDEX idx_repo_symbols_repo_name'), `Index not used: ${planDetail}`);
});

  console.log(`\n✔ ALL AST & SYMBOL CALL GRAPH TESTS PASSED (${passedCount}/${passedCount})`);
  return passedCount;
}

if (require.main === module) {
  runAstSymbolGraphTests();
}

module.exports = { runAstSymbolGraphTests };
