/**
 * SIM-Market Enterprise - Safe Database Access Service
 * Menyediakan abstraksi query aman, error handling terpusat, dan integrasi RPC
 */

import { getSupabaseClient } from '../config/supabase.js';

export async function panggilDatabaseAman(payload) {
    try {
        const client = getSupabaseClient();
        if (!client) {
            throw new Error("Klien Supabase belum diinisialisasi atau tidak tersedia.");
        }

        // Aksi Khusus: RPC (Remote Procedure Call / Stored Procedure)
        if (payload.aksi === 'RPC') {
            const { data, error } = await client.rpc(payload.fungsi, payload.params || {});
            return { data, error };
        }

        // Aksi Khusus: AUTH
        if (payload.aksi === 'AUTH_LOGIN') {
            const { data, error } = await client.auth.signInWithPassword({
                email: payload.email,
                password: payload.password
            });
            return { data, error };
        }

        let query;

        if (payload.aksi === 'SELECT') {
            const fetchAll = payload.fetchAll === true;
            const pageSize = Number.isSafeInteger(payload.pageSize) && payload.pageSize > 0
                ? Math.min(payload.pageSize, 1000)
                : 500;
            const rows = [];
            let offset = 0;

            while (true) {
                query = client.from(payload.tabel).select(
                    payload.kolom || '*',
                    fetchAll ? { count: 'exact' } : undefined
                );

                if (payload.filterKolom && payload.filterNilai !== undefined) {
                    query = query.eq(payload.filterKolom, payload.filterNilai);
                }
                if (payload.orderBy) {
                    const orderClauses = Array.isArray(payload.orderBy)
                        ? payload.orderBy
                        : [{ column: payload.orderBy, ascending: payload.ascending ?? true }];
                    for (const clause of orderClauses) {
                        if (clause?.column) {
                            query = query.order(clause.column, { ascending: clause.ascending ?? true });
                        }
                    }
                }
                if (fetchAll) {
                    query = query.range(offset, offset + pageSize - 1);
                } else if (payload.limit) {
                    query = query.limit(payload.limit);
                }
                if (payload.single) query = query.single();

                const result = await query;
                if (!fetchAll) return { data: result.data, error: result.error };
                if (result.error) return { data: null, error: result.error };
                if (!Array.isArray(result.data)) {
                    return { data: null, error: new Error('Respons SELECT berhalaman tidak valid.') };
                }

                rows.push(...result.data);
                if (result.data.length === 0) break;
                if (Number.isFinite(result.count) && rows.length >= result.count) break;
                if (!Number.isFinite(result.count) && result.data.length < pageSize) break;
                offset += result.data.length;
            }

            return { data: rows, error: null };
        } else if (payload.aksi === 'INSERT') {
            query = client.from(payload.tabel).insert(payload.data).select();
        } else if (payload.aksi === 'UPDATE') {
            query = client.from(payload.tabel).update(payload.data).eq(payload.filterKolom, payload.filterNilai).select();
        } else if (payload.aksi === 'DELETE') {
            query = client.from(payload.tabel).delete().eq(payload.filterKolom, payload.filterNilai);
        }

        // Optional compare-and-set predicates for updates such as stock restock.
        for (const filter of payload.aksi === 'UPDATE' ? payload.filters || [] : []) {
            if (filter?.kolom && filter.nilai !== undefined) {
                query = query.eq(filter.kolom, filter.nilai);
            }
        }

        const { data, error } = await query;
        return { data, error };
    } catch (err) {
        console.error(`[DB ERROR - ${payload.tabel || payload.fungsi || payload.aksi}]:`, err);
        return { data: null, error: err };
    }
}
