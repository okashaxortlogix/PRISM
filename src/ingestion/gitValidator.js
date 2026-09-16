// PRISM Git URL & Path Security Validator
// Aligned with P1-02 Security Specification: Prevents argument injection, command execution, and path traversal

class GitValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GitValidationError';
    this.code = 'INVALID_GIT_URL';
  }
}

/**
 * Validates a repository URL or local fixture path for security compliance
 */
function validateRepositoryUrl(rawUrl, options = {}) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new GitValidationError('Repository URL must be a non-empty string');
  }

  const url = rawUrl.trim();

  // 1. Argument Injection Protection: Must not start with hyphens or dashes
  if (url.startsWith('-') || url.startsWith('--')) {
    throw new GitValidationError('Repository URL cannot start with command-line flag indicators');
  }

  // 2. Command Injection Protection: Must not contain shell metacharacters
  const dangerousChars = [';', '&', '|', '`', '$', '\n', '\r', '\0', '{', '}', '<', '>'];
  for (const char of dangerousChars) {
    if (url.includes(char)) {
      throw new GitValidationError(`Repository URL contains illegal shell metacharacter: ${char}`);
    }
  }

  // 3. Dangerous Protocols: Disallow file://, gopher://, ftp://, telnet://
  const lower = url.toLowerCase();
  if (lower.startsWith('file:') || lower.startsWith('gopher:') || lower.startsWith('telnet:') || lower.startsWith('ftp:')) {
    throw new GitValidationError('Unsupported or dangerous protocol scheme in repository URL');
  }

  // 4. Remote Git URLs: HTTPS, HTTP, and SSH formats
  const isHttps = lower.startsWith('https://');
  const isHttp = lower.startsWith('http://');
  const isSsh = lower.startsWith('git@') || lower.startsWith('ssh://');

  if (isHttps || isHttp || isSsh) {
    // Valid remote format
    return {
      type: 'REMOTE',
      url,
      provider: detectProvider(url)
    };
  }

  // 5. Local fixture repositories (for testing & offline sandbox environments)
  if (options.allowLocalFixtures) {
    // Reject path traversals
    if (url.includes('..') || url.includes('~') || url.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(url)) {
      // If absolute path, only allow if explicitly inside approved fixtures folder
      if (options.fixtureRoot && url.startsWith(options.fixtureRoot)) {
        return { type: 'LOCAL_FIXTURE', path: url, provider: 'LOCAL' };
      }
      throw new GitValidationError('Path traversal and arbitrary absolute paths are prohibited for local fixtures');
    }

    return {
      type: 'LOCAL_FIXTURE',
      path: url,
      provider: 'LOCAL'
    };
  }

  throw new GitValidationError('Repository URL must be a valid HTTPS, HTTP, or SSH git endpoint');
}

/**
 * Detects git provider from URL
 */
function detectProvider(url) {
  const lower = url.toLowerCase();
  if (lower.includes('github.com')) return 'GITHUB';
  if (lower.includes('gitlab.com')) return 'GITLAB';
  if (lower.includes('bitbucket.org')) return 'BITBUCKET';
  return 'GENERIC_GIT';
}

module.exports = {
  validateRepositoryUrl,
  GitValidationError,
  detectProvider
};
