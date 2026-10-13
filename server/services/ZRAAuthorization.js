import { getAuthenticatedUser, supabaseRest } from '../models/SupabaseModel.js';

function bearerToken(req) {
  const value = String(req.headers.authorization || '');
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

export async function authorizeZRARequest(req, businessId, { adminOnly = false } = {}) {
  const user = await getAuthenticatedUser(bearerToken(req));
  if (!user?.id) {
    const error = new Error('Authentication required');
    error.statusCode = 401;
    throw error;
  }

  const rows = await supabaseRest(
    'GET',
    `memberships?select=role,is_active&user_id=eq.${encodeURIComponent(
      user.id
    )}&company_id=eq.${encodeURIComponent(businessId)}&is_active=eq.true&limit=1`
  );
  const membership = Array.isArray(rows) ? rows[0] : null;
  if (!membership) {
    const error = new Error('You do not have access to this business');
    error.statusCode = 403;
    throw error;
  }

  if (adminOnly && !['owner', 'admin', 'manager'].includes(String(membership.role))) {
    const error = new Error('Owner, admin, or manager access is required');
    error.statusCode = 403;
    throw error;
  }

  return { user, membership };
}
