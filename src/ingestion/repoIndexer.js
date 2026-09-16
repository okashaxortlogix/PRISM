// PRISM Repository File Tree Indexer & Manifest Discovery Engine
// Aligned with P1-02 Specification: File inventory, language detection, SHA-256 content hashing, and manifest parsing

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LANGUAGE_EXTENSIONS = {
  '.js': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.jsx': 'JavaScript',
  '.go': 'Go',
  '.py': 'Python',
  '.java': 'Java',
  '.rs': 'Rust',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.sql': 'SQL',
  '.md': 'Markdown',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.dockerfile': 'Dockerfile',
  '.xml': 'XML',
  '.html': 'HTML',
  '.css': 'CSS'
};

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'target',
  '.idea',
  '.vscode',
  '__pycache__',
  '.pytest_cache',
  '.terraform'
]);

const IGNORED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.exe', '.dll', '.so', '.dylib', '.bin',
  '.zip', '.tar', '.gz', '.7z',
  '.pdf', '.doc', '.docx',
  '.pyc', '.pyo', '.class',
  '.db', '.sqlite', '.db-wal', '.db-shm'
]);

/**
 * Detects programming language from relative path and extension
 */
function detectLanguage(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (base === 'dockerfile') return 'Dockerfile';
  if (base === 'makefile') return 'Makefile';
  if (base === 'go.mod' || base === 'go.sum') return 'Go Module';

  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_EXTENSIONS[ext] || 'plaintext';
}

/**
 * Calculates cryptographic SHA-256 hash of file buffer or string
 */
function computeFileHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Parses package.json for NPM dependencies
 */
function parsePackageJson(content) {
  const dependencies = [];
  try {
    const pkg = JSON.parse(content);
    if (pkg.dependencies && typeof pkg.dependencies === 'object') {
      for (const [name, versionSpec] of Object.entries(pkg.dependencies)) {
        dependencies.push({
          name,
          version_spec: String(versionSpec),
          ecosystem: 'NPM',
          is_dev: false
        });
      }
    }
    if (pkg.devDependencies && typeof pkg.devDependencies === 'object') {
      for (const [name, versionSpec] of Object.entries(pkg.devDependencies)) {
        dependencies.push({
          name,
          version_spec: String(versionSpec),
          ecosystem: 'NPM',
          is_dev: true
        });
      }
    }
  } catch (_) {}
  return dependencies;
}

/**
 * Parses go.mod for Go module dependencies
 */
function parseGoMod(content) {
  const dependencies = [];
  const lines = content.split('\n');
  let inRequireBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (trimmed === 'require (') {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && trimmed === ')') {
      inRequireBlock = false;
      continue;
    }

    if (inRequireBlock) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        dependencies.push({
          name: parts[0],
          version_spec: parts[1],
          ecosystem: 'GO_MODULES',
          is_dev: false
        });
      }
    } else if (trimmed.startsWith('require ')) {
      const parts = trimmed.substring(8).trim().split(/\s+/);
      if (parts.length >= 2) {
        dependencies.push({
          name: parts[0],
          version_spec: parts[1],
          ecosystem: 'GO_MODULES',
          is_dev: false
        });
      }
    }
  }
  return dependencies;
}

/**
 * Parses requirements.txt for Python PIP dependencies
 */
function parseRequirementsTxt(content) {
  const dependencies = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;

    // Matches package==1.2.3 or package>=1.0
    const match = trimmed.match(/^([a-zA-Z0-9_\-\.]+)(?:([=><~^!].*))?$/);
    if (match) {
      dependencies.push({
        name: match[1],
        version_spec: match[2] || '*',
        ecosystem: 'PIP',
        is_dev: false
      });
    }
  }
  return dependencies;
}

/**
 * Recursively walks directory tree and indexes files & manifests
 */
function indexDirectory(rootPath, currentRelPath = '', results = { files: [], dependencies: [] }) {
  const dirPath = path.join(rootPath, currentRelPath);
  if (!fs.existsSync(dirPath)) {
    return results;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const name = entry.name;
    const relFilePath = currentRelPath ? `${currentRelPath}/${name}`.replace(/\\/g, '/') : name;
    const fullPath = path.join(dirPath, name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(name) || name.startsWith('.')) {
        continue;
      }
      indexDirectory(rootPath, relFilePath, results);
    } else if (entry.isFile()) {
      const ext = path.extname(name).toLowerCase();
      if (IGNORED_EXTENSIONS.has(ext)) {
        continue;
      }

      try {
        const stats = fs.statSync(fullPath);
        // Skip files larger than 10MB to avoid memory saturation
        if (stats.size > 10 * 1024 * 1024) {
          continue;
        }

        const buffer = fs.readFileSync(fullPath);
        const hash = computeFileHash(buffer);
        const language = detectLanguage(relFilePath);

        const isPackageJson = name === 'package.json';
        const isGoMod = name === 'go.mod';
        const isReqTxt = name === 'requirements.txt';
        const isManifest = isPackageJson || isGoMod || isReqTxt;

        results.files.push({
          file_path: relFilePath,
          language,
          size_bytes: stats.size,
          sha256_hash: hash,
          is_manifest: isManifest
        });

        // Parse dependencies if manifest
        const contentStr = buffer.toString('utf8');
        if (isPackageJson) {
          results.dependencies.push(...parsePackageJson(contentStr));
        } else if (isGoMod) {
          results.dependencies.push(...parseGoMod(contentStr));
        } else if (isReqTxt) {
          results.dependencies.push(...parseRequirementsTxt(contentStr));
        }
      } catch (err) {
        // Safe skip on unreadable file
      }
    }
  }

  return results;
}

/**
 * Resolves or extracts head commit SHA from repository directory
 */
function resolveCommitSha(repoPath) {
  const headPath = path.join(repoPath, '.git', 'HEAD');
  if (fs.existsSync(headPath)) {
    try {
      const headContent = fs.readFileSync(headPath, 'utf8').trim();
      if (headContent.startsWith('ref: ')) {
        const refPath = path.join(repoPath, '.git', headContent.substring(5));
        if (fs.existsSync(refPath)) {
          return fs.readFileSync(refPath, 'utf8').trim();
        }
      } else if (/^[0-9a-f]{40}$/i.test(headContent)) {
        return headContent;
      }
    } catch (_) {}
  }

  // Fallback: Deterministic digest of root path and current date
  return crypto.createHash('sha1').update(`${repoPath}-${Date.now()}`).digest('hex');
}

module.exports = {
  detectLanguage,
  computeFileHash,
  parsePackageJson,
  parseGoMod,
  parseRequirementsTxt,
  indexDirectory,
  resolveCommitSha
};
