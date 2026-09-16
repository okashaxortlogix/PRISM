/**
 * PRISM Abstract Syntax Tree (AST) & Code Entity Parser
 * Supports JavaScript, TypeScript, Python, and Go codebases
 */

/**
 * Extracts symbols (functions, classes, methods, variables) and invocation calls from code
 * @param {string} content - Raw source code
 * @param {string} filePath - Path to file (used for extension detection)
 * @returns {{ symbols: Array<{ name: string, kind: string, start_line: number, end_line: number, parameters: string[], documentation?: string, calls: Array<{ name: string, line: number }> }> }}
 */
function parseCodeEntities(content, filePath) {
  if (!content || typeof content !== 'string') {
    return { symbols: [] };
  }

  const ext = filePath.includes('.') ? filePath.substring(filePath.lastIndexOf('.')).toLowerCase() : '';
  const lines = content.split(/\r?\n/);

  switch (ext) {
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
    case '.ts':
    case '.tsx':
      return parseJavaScriptEntities(lines);
    case '.py':
      return parsePythonEntities(lines);
    case '.go':
      return parseGoEntities(lines);
    default:
      return parseGenericEntities(lines);
  }
}

/**
 * Extracts JS/TS functions, classes, methods, and arrow functions
 */
function parseJavaScriptEntities(lines) {
  const symbols = [];
  const functionRegex = /^(?:export\s+)?(?:async\s+)?function(?:\s+([a-zA-Z0-9_$]+))?\s*\(([^)]*)\)/;
  const arrowRegex = /^(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/;
  const classRegex = /^(?:export\s+)?(?:abstract\s+)?class\s+([a-zA-Z0-9_$]+)(?:\s+extends\s+[a-zA-Z0-9_$]+)?(?:\s+implements\s+[a-zA-Z0-9_$,\s]+)?/;
  const methodRegex = /^\s*(?:(?:public|private|protected|static|async)\s+)*([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*(?::\s*[^\{]+)?\s*\{/;
  const callRegex = /\b([a-zA-Z0-9_$]+)\s*\(/g;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    let match = null;
    let kind = null;
    let name = null;
    let params = [];

    if ((match = trimmed.match(functionRegex))) {
      name = match[1] || `anonymous_${i + 1}`;
      kind = 'FUNCTION';
      params = match[2] ? match[2].split(',').map(p => p.trim().split(':')[0].trim()).filter(Boolean) : [];
    } else if ((match = trimmed.match(arrowRegex))) {
      name = match[1];
      kind = 'FUNCTION';
      params = match[2] ? match[2].split(',').map(p => p.trim().split(':')[0].trim()).filter(Boolean) : [];
    } else if ((match = trimmed.match(classRegex))) {
      name = match[1];
      kind = 'CLASS';
      params = [];
    } else if (rawLine.startsWith(' ') || rawLine.startsWith('\t')) {
      // Possible method inside class or object
      if ((match = rawLine.match(methodRegex)) && !['if', 'for', 'while', 'switch', 'catch'].includes(match[1])) {
        name = match[1];
        kind = 'METHOD';
        params = match[2] ? match[2].split(',').map(p => p.trim().split(':')[0].trim()).filter(Boolean) : [];
      }
    }

    if (name && kind) {
      // Find end line by brace matching or indentation
      const startLine = i + 1;
      let endLine = startLine;
      let openBraces = 0;
      let foundBrace = false;

      for (let j = i; j < lines.length; j++) {
        const line = lines[j];
        for (const ch of line) {
          if (ch === '{') {
            openBraces++;
            foundBrace = true;
          } else if (ch === '}') {
            openBraces--;
          }
        }
        if (foundBrace && openBraces <= 0) {
          endLine = j + 1;
          break;
        }
        if (j === lines.length - 1) {
          endLine = lines.length;
        }
      }

      // Extract calls within symbol range
      const calls = [];
      for (let k = startLine - 1; k < endLine && k < lines.length; k++) {
        const bodyLine = lines[k];
        let callMatch;
        while ((callMatch = callRegex.exec(bodyLine)) !== null) {
          const callee = callMatch[1];
          const reserved = new Set([
            'if', 'for', 'while', 'switch', 'catch', 'function', 'class', 'return',
            'typeof', 'instanceof', 'void', 'delete', 'await', 'import', 'export', name
          ]);
          if (!reserved.has(callee) && !calls.some(c => c.name === callee && c.line === k + 1)) {
            calls.push({ name: callee, line: k + 1 });
          }
        }
      }

      // Check preceding lines for docstring
      let documentation = null;
      if (i > 0) {
        const prev = lines[i - 1].trim();
        if (prev.endsWith('*/') || prev.startsWith('//')) {
          documentation = prev;
        }
      }

      symbols.push({
        name,
        kind,
        start_line: startLine,
        end_line: endLine,
        parameters: params,
        documentation,
        calls
      });
    }
  }

  return { symbols };
}

/**
 * Extracts Python functions and classes
 */
function parsePythonEntities(lines) {
  const symbols = [];
  const defRegex = /^(?:[ \t]*)def\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*(?:->\s*[^:]+)?\s*:/;
  const classRegex = /^(?:[ \t]*)class\s+([a-zA-Z0-9_$]+)(?:\s*\(([^)]*)\))?\s*:/;
  const callRegex = /\b([a-zA-Z0-9_$]+)\s*\(/g;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    let match = null;
    let kind = null;
    let name = null;
    let params = [];

    const baseIndent = rawLine.length - rawLine.trimStart().length;

    if ((match = rawLine.match(defRegex))) {
      name = match[1];
      kind = baseIndent > 0 ? 'METHOD' : 'FUNCTION';
      params = match[2] ? match[2].split(',').map(p => p.trim().split(':')[0].trim()).filter(Boolean) : [];
    } else if ((match = rawLine.match(classRegex))) {
      name = match[1];
      kind = 'CLASS';
      params = match[2] ? match[2].split(',').map(p => p.trim()).filter(Boolean) : [];
    }

    if (name && kind) {
      const startLine = i + 1;
      let endLine = startLine;

      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (!nextLine.trim() || nextLine.trim().startsWith('#')) {
          endLine = j + 1;
          continue;
        }
        const nextIndent = nextLine.length - nextLine.trimStart().length;
        if (nextIndent <= baseIndent) {
          endLine = j;
          break;
        }
        endLine = j + 1;
      }

      const calls = [];
      for (let k = startLine - 1; k < endLine && k < lines.length; k++) {
        const bodyLine = lines[k];
        let callMatch;
        while ((callMatch = callRegex.exec(bodyLine)) !== null) {
          const callee = callMatch[1];
          const reserved = new Set([
            'if', 'for', 'while', 'def', 'class', 'return', 'yield',
            'with', 'try', 'except', 'finally', 'elif', 'else', name
          ]);
          if (!reserved.has(callee) && !calls.some(c => c.name === callee && c.line === k + 1)) {
            calls.push({ name: callee, line: k + 1 });
          }
        }
      }

      symbols.push({
        name,
        kind,
        start_line: startLine,
        end_line: endLine,
        parameters: params,
        documentation: null,
        calls
      });
    }
  }

  return { symbols };
}

/**
 * Extracts Go functions and methods
 */
function parseGoEntities(lines) {
  const symbols = [];
  const funcRegex = /^func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_$]+)\s*\(([^)]*)\)/;
  const structRegex = /^type\s+([a-zA-Z0-9_$]+)\s+struct\s*\{/;
  const callRegex = /\b([a-zA-Z0-9_$]+)\s*\(/g;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    let match = null;
    let kind = null;
    let name = null;
    let params = [];

    if ((match = trimmed.match(funcRegex))) {
      name = match[1];
      const isMethod = /^func\s*\([^)]+\)/.test(trimmed);
      kind = isMethod ? 'METHOD' : 'FUNCTION';
      params = match[2] ? match[2].split(',').map(p => p.trim().split(' ')[0].trim()).filter(Boolean) : [];
    } else if ((match = trimmed.match(structRegex))) {
      name = match[1];
      kind = 'CLASS';
      params = [];
    }

    if (name && kind) {
      const startLine = i + 1;
      let endLine = startLine;
      let openBraces = 0;
      let foundBrace = false;

      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') { openBraces++; foundBrace = true; }
          else if (ch === '}') { openBraces--; }
        }
        if (foundBrace && openBraces <= 0) {
          endLine = j + 1;
          break;
        }
        if (j === lines.length - 1) endLine = lines.length;
      }

      const calls = [];
      for (let k = startLine - 1; k < endLine && k < lines.length; k++) {
        let callMatch;
        while ((callMatch = callRegex.exec(lines[k])) !== null) {
          const callee = callMatch[1];
          const reserved = new Set(['if', 'for', 'switch', 'select', 'func', 'type', 'return', name]);
          if (!reserved.has(callee) && !calls.some(c => c.name === callee && c.line === k + 1)) {
            calls.push({ name: callee, line: k + 1 });
          }
        }
      }

      symbols.push({
        name,
        kind,
        start_line: startLine,
        end_line: endLine,
        parameters: params,
        documentation: null,
        calls
      });
    }
  }

  return { symbols };
}

/**
 * Fallback parser for generic formats
 */
function parseGenericEntities(lines) {
  return { symbols: [] };
}

module.exports = {
  parseCodeEntities
};
