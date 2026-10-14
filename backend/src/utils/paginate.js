function paginate(req, { defaultLimit = 25, maxLimit = 200 } = {}) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

async function paged(query, countQuery, { page, limit, skip }) {
  const [items, total] = await Promise.all([query.skip(skip).limit(limit), countQuery]);
  return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
}

const escapeRegex = (s = '') => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { paginate, paged, escapeRegex };
