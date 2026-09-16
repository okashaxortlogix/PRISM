/**
 * PRISM Symbol Call-Graph Modeling & Blast Radius Computation
 */
const crypto = require('crypto');

class SymbolCallGraph {
  constructor(repositoryId) {
    this.repositoryId = repositoryId;
    this.symbols = new Map(); // id -> symbol object
    this.symbolsByName = new Map(); // name -> symbol object
    this.adjList = new Map(); // symbolId -> Set<calleeSymbolId>
    this.revAdjList = new Map(); // symbolId -> Set<callerSymbolId>
    this.unresolvedCalls = []; // calls to symbols outside the repository
  }

  /**
   * Loads symbols and their calls into the in-memory graph
   * @param {Array<object>} symbolList
   */
  loadSymbols(symbolList) {
    for (const sym of symbolList) {
      this.symbols.set(sym.id, sym);
      this.symbolsByName.set(sym.name, sym);
      if (!this.adjList.has(sym.id)) this.adjList.set(sym.id, new Set());
      if (!this.revAdjList.has(sym.id)) this.revAdjList.set(sym.id, new Set());
    }

    // Resolve caller-callee links
    for (const caller of symbolList) {
      if (!caller.calls || !Array.isArray(caller.calls)) continue;

      for (const call of caller.calls) {
        const target = this.symbolsByName.get(call.name);
        if (target) {
          this.adjList.get(caller.id).add(target.id);
          this.revAdjList.get(target.id).add(caller.id);
        } else {
          this.unresolvedCalls.push({
            callerId: caller.id,
            calleeName: call.name,
            line: call.line
          });
        }
      }
    }
  }

  /**
   * Computes the downstream blast radius: all symbols that transitively call or are called by this symbol
   * @param {string} symbolIdentifier - Name or ID
   * @param {number} maxDepth - Max BFS traversal depth
   * @returns {{ root: object, affectedSymbols: Array<object>, totalCount: number, blastLevel: string }}
   */
  getBlastRadius(symbolIdentifier, maxDepth = 3) {
    let root = this.symbols.get(symbolIdentifier) || this.symbolsByName.get(symbolIdentifier);
    if (!root) {
      return { root: null, affectedSymbols: [], totalCount: 0, blastLevel: 'LOW' };
    }

    const visited = new Set([root.id]);
    const queue = [{ id: root.id, depth: 0 }];
    const affected = [];

    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      if (depth >= maxDepth) continue;

      // Check both callers (who depends on me) and callees (whom I affect)
      const neighbors = new Set([
        ...(this.revAdjList.get(id) || []),
        ...(this.adjList.get(id) || [])
      ]);

      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          const neighborSym = this.symbols.get(neighborId);
          if (neighborSym) {
            affected.push(neighborSym);
            queue.push({ id: neighborId, depth: depth + 1 });
          }
        }
      }
    }

    let blastLevel = 'LOW';
    if (affected.length > 10) blastLevel = 'CRITICAL';
    else if (affected.length > 5) blastLevel = 'HIGH';
    else if (affected.length > 2) blastLevel = 'MEDIUM';

    return {
      root,
      affectedSymbols: affected,
      totalCount: affected.length,
      blastLevel
    };
  }

  /**
   * Persists extracted symbols and call graph edges into SQLite
   * @param {object} db - SQLite database connection
   * @param {string} repositoryId
   * @param {Array<object>} rawParsedFiles - Array of { filePath, symbols: [...] }
   */
  static persistGraph(db, repositoryId, rawParsedFiles) {
    // Delete existing symbols and call graphs for this repo
    db.prepare('DELETE FROM repository_symbols WHERE repository_id = ?').run(repositoryId);
    db.prepare('DELETE FROM symbol_call_graphs WHERE repository_id = ?').run(repositoryId);

    const insertSymbol = db.prepare(`
      INSERT INTO repository_symbols (id, repository_id, file_path, name, kind, start_line, end_line, parameters, documentation, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const insertCall = db.prepare(`
      INSERT INTO symbol_call_graphs (id, repository_id, caller_symbol_id, callee_name, callee_symbol_id, call_site_line, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const symbolsToInsert = [];
    const nameToId = new Map();

    for (const file of rawParsedFiles) {
      for (const sym of file.symbols) {
        const symbolId = `sym_${crypto.randomUUID().replace(/-/g, '')}`;
        sym.id = symbolId;
        sym.filePath = file.filePath;
        nameToId.set(sym.name, symbolId);
        symbolsToInsert.push(sym);
      }
    }

    const executeInserts = () => {
      for (const sym of symbolsToInsert) {
        insertSymbol.run(
          sym.id,
          repositoryId,
          sym.filePath,
          sym.name,
          sym.kind,
          sym.start_line,
          sym.end_line,
          JSON.stringify(sym.parameters || []),
          sym.documentation || null
        );
      }

      for (const sym of symbolsToInsert) {
        if (sym.calls && Array.isArray(sym.calls)) {
          for (const call of sym.calls) {
            const calleeId = nameToId.get(call.name) || null;
            const callId = `call_${crypto.randomUUID().replace(/-/g, '')}`;
            insertCall.run(
              callId,
              repositoryId,
              sym.id,
              call.name,
              calleeId,
              call.line || null
            );
          }
        }
      }
    };

    if (typeof db.transaction === 'function') {
      const tx = db.transaction(executeInserts);
      tx();
    } else {
      executeInserts();
    }

    return { symbolCount: symbolsToInsert.length };
  }

  /**
   * Loads graph directly from the database for a repository
   */
  static fromDatabase(db, repositoryId) {
    const graph = new SymbolCallGraph(repositoryId);
    const symbols = db.prepare(`
      SELECT id, repository_id, file_path, name, kind, start_line, end_line, parameters, documentation
      FROM repository_symbols
      WHERE repository_id = ?
    `).all(repositoryId);

    const calls = db.prepare(`
      SELECT id, caller_symbol_id, callee_name, callee_symbol_id, call_site_line
      FROM symbol_call_graphs
      WHERE repository_id = ?
    `).all(repositoryId);

    const callsByCaller = new Map();
    for (const c of calls) {
      if (!callsByCaller.has(c.caller_symbol_id)) callsByCaller.set(c.caller_symbol_id, []);
      callsByCaller.get(c.caller_symbol_id).push({
        name: c.callee_name,
        calleeId: c.callee_symbol_id,
        line: c.call_site_line
      });
    }

    const hydratedSymbols = symbols.map(s => ({
      ...s,
      parameters: JSON.parse(s.parameters || '[]'),
      calls: callsByCaller.get(s.id) || []
    }));

    graph.loadSymbols(hydratedSymbols);
    return graph;
  }
}

module.exports = {
  SymbolCallGraph
};
