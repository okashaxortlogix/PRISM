// PRISM Repository Ingestion Asynchronous Job Handler
// Coordinates cloning, file tree indexing, dependency manifest discovery, and evidence generation

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { getDatabase } = require('../../db/database');
const { validateRepositoryUrl } = require('../../ingestion/gitValidator');
const { indexDirectory, resolveCommitSha } = require('../../ingestion/repoIndexer');
const { SymbolCallGraph } = require('../../ingestion/symbolGraph');
const { JobError, ERROR_CODES } = require('../jobErrors');

async function handleRepoIngestionJob(job, { queue, checkCancellation }) {
  const db = getDatabase();
  const repoId = job.payload && job.payload.repository_id;

  if (!repoId) {
    throw new JobError(ERROR_CODES.VALIDATION_ERROR, 'Job payload is missing repository_id', { isRetryable: false });
  }

  // Retrieve repository with tenant isolation via parent project
  const repo = db.prepare(`
    SELECT r.*, p.organization_id 
    FROM repositories r
    JOIN projects p ON r.project_id = p.id
    WHERE r.id = ? AND p.organization_id = ?
  `).get(repoId, job.organization_id);

  if (!repo) {
    throw new JobError(ERROR_CODES.VALIDATION_ERROR, `Repository ${repoId} not found in organization ${job.organization_id}`, { isRetryable: false });
  }

  // Checkpoint 1: Validate repository source
  queue.checkpoint(job.id, 'VALIDATING_SOURCE', 15, { url: repo.url, provider: repo.provider });
  if (checkCancellation()) throw new JobError(ERROR_CODES.CANCELLED, 'Ingestion cancelled by user');

  const platformRoot = path.resolve(__dirname, '../../../');
  const workspaceRoot = path.resolve(platformRoot, '../');
  const validated = validateRepositoryUrl(repo.url, {
    allowLocalFixtures: true,
    fixtureRoot: workspaceRoot
  });

  // Mark repository status as INGESTING
  db.prepare("UPDATE repositories SET status = 'INGESTING' WHERE id = ?").run(repo.id);

  // Checkpoint 2: Locate source directory
  queue.checkpoint(job.id, 'FETCHING_FILES', 40, { sourceType: validated.type });
  if (checkCancellation()) throw new JobError(ERROR_CODES.CANCELLED, 'Ingestion cancelled by user');

  const candidateRoots = [
    path.resolve(__dirname, '../../'),
    path.resolve(__dirname, '../../../'),
    path.resolve(__dirname, '../../../../'),
    process.cwd()
  ];

  let sourceDirectory = null;
  if (validated.type === 'LOCAL_FIXTURE') {
    if (path.isAbsolute(validated.path)) {
      sourceDirectory = validated.path;
    } else {
      for (const r of candidateRoots) {
        const candidate = path.join(r, validated.path);
        if (fs.existsSync(candidate)) {
          sourceDirectory = candidate;
          break;
        }
      }
      if (!sourceDirectory) {
        sourceDirectory = path.join(process.cwd(), validated.path);
      }
    }
  } else {
    // For remote git URLs, check if local checkout or cache exists; if not, use process.cwd()
    const repoSlug = repo.url.split('/').pop().replace('.git', '');
    for (const r of candidateRoots) {
      const candidate = path.join(r, repoSlug);
      if (fs.existsSync(candidate)) {
        sourceDirectory = candidate;
        break;
      }
    }
    if (!sourceDirectory) {
      for (const r of candidateRoots) {
        if (fs.existsSync(path.join(r, 'package.json'))) {
          sourceDirectory = r;
          break;
        }
      }
      if (!sourceDirectory) {
        sourceDirectory = process.cwd();
      }
    }
  }

  // Checkpoint 3: Index file tree & manifests
  queue.checkpoint(job.id, 'INDEXING_TREE', 65, { sourcePath: sourceDirectory });
  if (checkCancellation()) throw new JobError(ERROR_CODES.CANCELLED, 'Ingestion cancelled by user');

  const indexResults = indexDirectory(sourceDirectory);
  const commitSha = resolveCommitSha(sourceDirectory);

  // Checkpoint 4: Persist files and dependencies transactionally
  queue.checkpoint(job.id, 'PERSISTING_RECORDS', 85, {
    filesDiscovered: indexResults.files.length,
    dependenciesDiscovered: indexResults.dependencies.length
  });
  if (checkCancellation()) throw new JobError(ERROR_CODES.CANCELLED, 'Ingestion cancelled by user');

  const now = new Date().toISOString();

  // Clear previous files/deps if re-indexing
  db.exec('BEGIN TRANSACTION;');
  try {
    db.prepare('DELETE FROM repository_files WHERE repository_id = ?').run(repo.id);
    db.prepare('DELETE FROM repository_dependencies WHERE repository_id = ?').run(repo.id);

    const insertFile = db.prepare(`
      INSERT INTO repository_files (id, repository_id, file_path, language, size_bytes, sha256_hash, is_manifest, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const file of indexResults.files) {
      const fileId = `rf_${crypto.randomUUID().substring(0, 8)}`;
      insertFile.run(
        fileId,
        repo.id,
        file.file_path,
        file.language,
        file.size_bytes,
        file.sha256_hash,
        file.is_manifest ? 1 : 0,
        now
      );
    }

    const insertDep = db.prepare(`
      INSERT INTO repository_dependencies (id, repository_id, name, version_spec, ecosystem, is_dev, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const dep of indexResults.dependencies) {
      const depId = `rd_${crypto.randomUUID().substring(0, 8)}`;
      insertDep.run(
        depId,
        repo.id,
        dep.name,
        dep.version_spec,
        dep.ecosystem,
        dep.is_dev ? 1 : 0,
        now
      );
    }

    // Persist AST symbols and caller-callee call graph
    if (indexResults.symbols && indexResults.symbols.length > 0) {
      SymbolCallGraph.persistGraph(db, repo.id, indexResults.symbols);
    }

    // Update repository record
    db.prepare(`
      UPDATE repositories
      SET status = 'INDEXED',
          commit_sha = ?,
          file_count = ?,
          dependency_count = ?,
          last_ingested_at = ?
      WHERE id = ?
    `).run(commitSha, indexResults.files.length, indexResults.dependencies.length, now, repo.id);

    // If an investigation is associated with this project, synthesize an immutable evidence item
    const activeInv = db.prepare('SELECT id FROM investigations WHERE project_id = ? ORDER BY started_at DESC LIMIT 1').get(repo.project_id);
    if (activeInv) {
      const eviId = `evi_repo_${crypto.randomUUID().substring(0, 8)}`;
      db.prepare(`
        INSERT INTO evidence (id, investigation_id, type, source, source_ref, title, content, metadata, observed_at, collected_at, reliability, provenance, hash)
        VALUES (?, ?, 'REPOSITORY_CODE', 'GIT_INGESTION', ?, ?, ?, ?, ?, ?, 1.0, ?, ?)
      `).run(
        eviId,
        activeInv.id,
        repo.url,
        `Repository Code Index: ${repo.url}`,
        `Indexed ${indexResults.files.length} files and ${indexResults.dependencies.length} dependencies at commit ${commitSha.substring(0, 8)}.`,
        JSON.stringify({ fileCount: indexResults.files.length, dependencyCount: indexResults.dependencies.length, commitSha }),
        now,
        now,
        `Ingested by PRISM Background Worker at ${now}`,
        crypto.createHash('sha256').update(`${repo.id}:${commitSha}:${indexResults.files.length}`).digest('hex')
      );
    }

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    db.prepare("UPDATE repositories SET status = 'FAILED' WHERE id = ?").run(repo.id);
    throw err;
  }

  // Checkpoint 5: Completed
  queue.checkpoint(job.id, 'COMPLETED', 100, {
    status: 'INDEXED',
    fileCount: indexResults.files.length,
    dependencyCount: indexResults.dependencies.length,
    commitSha
  });

  return {
    repositoryId: repo.id,
    url: repo.url,
    status: 'INDEXED',
    fileCount: indexResults.files.length,
    dependencyCount: indexResults.dependencies.length,
    commitSha,
    ingestedAt: now
  };
}

module.exports = {
  handleRepoIngestionJob
};
