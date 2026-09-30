// Accept both versioned API bases and legacy host-only configuration.
function normalizeApiBaseUrl(value) {
    const base = value.trim().replace(/\/+$/, '');
    return base.endsWith('/v1') ? base : `${base}/v1`;
}

module.exports = { normalizeApiBaseUrl };
