// PRISM Authentication & Authorization Middleware
// Enforces server-side identity, valid session token, organization tenancy, and RBAC
const { validateSession } = require('./sessionService');
const { recordSecurityAudit } = require('./auditService');

const ROLE_HIERARCHY = {
  VIEWER: 1,
  MEMBER: 2,
  ADMIN: 3,
  OWNER: 4
};

/**
 * Extracts session token from Authorization Bearer header or Cookie
 */
function extractToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  // Fallback to cookie
  const cookieHeader = req.headers['cookie'];
  if (cookieHeader) {
    const match = cookieHeader.match(/prism_session=([^;]+)/);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Centralized authentication middleware
 */
function authenticate(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required: Missing or invalid session token.'
      }
    });
  }

  const sessionContext = validateSession(token);
  if (!sessionContext) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Session is invalid, expired, or revoked.'
      }
    });
  }

  // Check if caller requests to act within another organization they belong to
  const requestedOrgId = req.headers['x-organization-id'];
  let activeOrg = sessionContext.organization;
  let activeRole = sessionContext.role;

  if (requestedOrgId && requestedOrgId !== activeOrg.id) {
    const validMembership = sessionContext.memberships.find(m => m.organization_id === requestedOrgId);
    if (!validMembership) {
      recordSecurityAudit({
        organizationId: activeOrg.id,
        actorId: sessionContext.user.id,
        eventType: 'AUTHORIZATION_DENIED',
        targetType: 'ORGANIZATION',
        targetId: requestedOrgId,
        metadata: { reason: 'User attempted to access non-member organization via header' }
      });
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied: You are not an active member of the requested organization.'
        }
      });
    }

    activeOrg = {
      id: validMembership.organization_id,
      name: validMembership.organization_name,
      slug: validMembership.organization_slug
    };
    activeRole = validMembership.role;
  }

  // Attach verified context
  req.user = sessionContext.user;
  req.organization = activeOrg;
  req.role = activeRole;
  req.memberships = sessionContext.memberships;
  req.sessionId = sessionContext.sessionId;

  // Normalized security context
  req.authContext = {
    userId: sessionContext.user.id,
    orgId: activeOrg.id,
    role: activeRole
  };

  next();
}

/**
 * RBAC Role Gate
 * @param {string[]} allowedRoles Array of minimum roles e.g. ['ADMIN', 'OWNER'] or minimum single role string
 */
function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    if (!req.user || !req.role) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required.' }
      });
    }

    const userLevel = ROLE_HIERARCHY[req.role] || 0;
    const requiredLevel = Math.min(...roles.map(r => ROLE_HIERARCHY[r] || 99));

    if (userLevel < requiredLevel) {
      recordSecurityAudit({
        organizationId: req.organization.id,
        actorId: req.user.id,
        eventType: 'AUTHORIZATION_DENIED',
        targetType: 'ENDPOINT',
        targetId: req.path,
        metadata: { requiredRoles: roles, userRole: req.role }
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `Forbidden: Insufficient privileges. Required role: [${roles.join(', ')}], current role: ${req.role}`
        }
      });
    }

    next();
  };
}

module.exports = {
  authenticate,
  requireRole,
  ROLE_HIERARCHY
};
