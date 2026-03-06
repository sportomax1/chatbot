export const config = { runtime: 'edge' };

// ============================================================
//  SUPABASE CRUD API — query any table in your Supabase DB
// ============================================================

const _ts = () => new Date().toISOString();
const log = {
  info:  (...a) => console.log(  `[${_ts()}] ℹ️  INFO `, ...a),
  ok:    (...a) => console.log(  `[${_ts()}] ✅  OK   `, ...a),
  warn:  (...a) => console.warn( `[${_ts()}] ⚠️  WARN `, ...a),
  error: (...a) => console.error(`[${_ts()}] ❌  ERROR`, ...a),
  debug: (...a) => console.log(  `[${_ts()}] 🐛  DEBUG`, ...a),
};

export default async function handler(req) {
  const rid = crypto.randomUUID().slice(0, 8);
  log.info(`[${rid}] ── SUPABASE CRUD REQUEST ──`);

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      log.error(`[${rid}] Missing Supabase credentials`);
      return new Response(JSON.stringify({
        ok: false,
        error: 'Supabase credentials not configured (SUPABASE_URL, SUPABASE_ANON_KEY)',
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const { action, table, query, data, id, limit = 50, offset = 0 } = body;

    log.debug(`[${rid}] Action: ${action}  Table: ${table}`);

    // ── LIST ALL TABLES ──
    if (action === 'LIST_TABLES') {
      log.info(`[${rid}] Listing tables`);
      
      // Check for SUPABASE_TABLES environment variable (comma-separated list)
      const tablesEnv = process.env.SUPABASE_TABLES;
      
      if (tablesEnv) {
        const tables = tablesEnv.split(',').map(t => t.trim()).filter(Boolean);
        log.ok(`[${rid}] Found ${tables.length} tables from SUPABASE_TABLES env`);
        return new Response(JSON.stringify({ ok: true, tables }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Try REST API as fallback (may not work with anon key)
      try {
        const url = `${supabaseUrl}/rest/v1/information_schema.tables?select=table_name&table_schema=eq.public&order=table_name.asc`;
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Accept': 'application/json',
            'apikey': supabaseKey,
          },
        });
        
        if (res.ok) {
          const tables = await res.json();
          const tableNames = Array.isArray(tables) ? tables.map(t => t.table_name).filter(Boolean) : [];
          log.ok(`[${rid}] Found ${tableNames.length} tables via REST API`);
          return new Response(JSON.stringify({ ok: true, tables: tableNames }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (err) {
        log.debug(`[${rid}] REST API query failed: ${err.message}`);
      }
      
      // Fallback: return instructions
      log.warn(`[${rid}] Table discovery failed - set SUPABASE_TABLES env var`);
      return new Response(JSON.stringify({
        ok: true,
        tables: [],
        message: 'Set SUPABASE_TABLES env var (comma-separated) or enter table name manually'
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ── SEARCH / READ ──
    if (action === 'READ' || action === 'SEARCH') {
      if (!table) throw new Error('table required');
      
      // Sanitize table name (alphanumeric, underscore, hyphen only)
      if (!/^[a-zA-Z0-9_-]+$/.test(table)) {
        log.error(`[${rid}] Invalid table name: ${table}`);
        return new Response(JSON.stringify({ ok: false, error: `Invalid table name: "${table}"` }), { 
          status: 400, 
          headers: { 'Content-Type': 'application/json' } 
        });
      }
      
      // Build query string
      let queryStr = `${supabaseUrl}/rest/v1/${table}?select=*`;
      
      // Add WHERE clause if provided
      if (query) {
        Object.keys(query).forEach(key => {
          const val = query[key];
          if (typeof val === 'string') {
            queryStr += `&${key}=ilike.*${encodeURIComponent(val)}*`;  // case-insensitive contains
          } else {
            queryStr += `&${key}=eq.${encodeURIComponent(val)}`;
          }
        });
      }
      
      // Add limit/offset for pagination
      queryStr += `&limit=${limit}&offset=${offset}`;
      
      log.info(`[${rid}] READ ${table} with query:`, query);
      const res = await fetch(queryStr, {
        headers: { 
          'Authorization': `Bearer ${supabaseKey}`, 
          'Accept': 'application/json',
          'apikey': supabaseKey,
        },
      });
      
      if (!res.ok) {
        const err = await res.text();
        log.error(`[${rid}] Query failed (${res.status}):`, err.slice(0, 200));
        const errMsg = err.includes('relation') ? `Table "${table}" not found. Check table name.` : err;
        return new Response(JSON.stringify({ ok: false, error: errMsg }), { 
          status: res.status || 400, 
          headers: { 'Content-Type': 'application/json' } 
        });
      }
      
      try {
        const rows = await res.json();
        log.ok(`[${rid}] Found ${rows.length} rows in ${table}`);
        return new Response(JSON.stringify({ ok: true, rows, count: rows.length }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (parseErr) {
        log.error(`[${rid}] Parse error:`, parseErr.message);
        return new Response(JSON.stringify({ ok: false, error: 'Response parse error' }), { 
          status: 400, 
          headers: { 'Content-Type': 'application/json' } 
        });
      }
    }

    // ── CREATE ──
    if (action === 'CREATE') {
      if (!table || !data) throw new Error('table and data required');
      
      log.info(`[${rid}] CREATE in ${table}:`, JSON.stringify(data).slice(0, 200));
      const res = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(data),
      });
      
      if (!res.ok) {
        const err = await res.text();
        log.error(`[${rid}] Create failed:`, err);
        return new Response(JSON.stringify({ ok: false, error: err }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      
      const created = await res.json();
      log.ok(`[${rid}] Created ${created.length} row(s)`);
      return new Response(JSON.stringify({ ok: true, rows: created }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ── UPDATE ──
    if (action === 'UPDATE') {
      if (!table || !id || !data) throw new Error('table, id, and data required');
      
      log.info(`[${rid}] UPDATE ${table} id=${id}:`, JSON.stringify(data).slice(0, 200));
      const res = await fetch(`${supabaseUrl}/rest/v1/${table}?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(data),
      });
      
      if (!res.ok) {
        const err = await res.text();
        log.error(`[${rid}] Update failed:`, err);
        return new Response(JSON.stringify({ ok: false, error: err }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      
      const updated = await res.json();
      log.ok(`[${rid}] Updated ${updated.length} row(s)`);
      return new Response(JSON.stringify({ ok: true, rows: updated }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ── DELETE ──
    if (action === 'DELETE') {
      if (!table || !id) throw new Error('table and id required');
      
      log.info(`[${rid}] DELETE from ${table} id=${id}`);
      const res = await fetch(`${supabaseUrl}/rest/v1/${table}?id=eq.${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'return=representation',
        },
      });
      
      if (!res.ok) {
        const err = await res.text();
        log.error(`[${rid}] Delete failed:`, err);
        return new Response(JSON.stringify({ ok: false, error: err }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      
      const deleted = await res.json();
      log.ok(`[${rid}] Deleted ${deleted.length} row(s)`);
      return new Response(JSON.stringify({ ok: true, rows: deleted }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ ok: false, error: 'Unknown action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    log.error(`[${rid}] Exception:`, err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
