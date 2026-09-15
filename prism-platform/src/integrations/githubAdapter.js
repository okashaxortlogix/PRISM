// PRISM GitHub Integration Adapter
// Ingests GitHub webhooks, commit events, and pull requests into normalized evidence

function parseGitHubWebhook(event, payload, investigationId) {
  if (event === 'push') {
    const commit = payload.head_commit || (payload.commits && payload.commits[0]);
    if (!commit) throw new Error('No commit found in push payload');

    return {
      investigation_id: investigationId,
      type: 'REPOSITORY_CODE',
      source: payload.repository?.full_name || 'github',
      source_ref: `commit/${commit.id.substring(0, 8)}`,
      title: `Git Commit: ${commit.message.split('\n')[0]}`,
      content: JSON.stringify({
        commit_id: commit.id,
        author: commit.author?.name || 'unknown',
        added: commit.added,
        removed: commit.removed,
        modified: commit.modified,
        url: commit.url
      }, null, 2),
      reliability: 0.98,
      provenance: { provider: 'github', event: 'push', delivery_id: payload.delivery_id || 'manual' }
    };
  }

  if (event === 'pull_request') {
    const pr = payload.pull_request;
    return {
      investigation_id: investigationId,
      type: 'REPOSITORY_CODE',
      source: payload.repository?.full_name || 'github',
      source_ref: `pr/${pr.number}`,
      title: `Pull Request #${pr.number}: ${pr.title}`,
      content: JSON.stringify({
        pr_number: pr.number,
        state: pr.state,
        user: pr.user?.login,
        diff_url: pr.diff_url,
        head_sha: pr.head?.sha
      }, null, 2),
      reliability: 0.98,
      provenance: { provider: 'github', event: 'pull_request' }
    };
  }

  throw new Error(`Unsupported GitHub event: ${event}`);
}

module.exports = { parseGitHubWebhook };
