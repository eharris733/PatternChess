//! `data/book/work.sqlite` — the builder's working database. Stages write
//! into it incrementally; `emit` turns it into D1 SQL.

use std::path::Path;

use anyhow::Result;
use hashbrown::HashMap;
use rusqlite::{Connection, params};

use crate::{
    Tier,
    ingest::{PosAgg, decode_uci},
};

/// Moves seen fewer times than this are dropped from a position's list (they
/// still count toward the position's totals).
pub const MIN_STORED_MOVE_GAMES: u32 = 2;

pub fn open(path: &Path) -> Result<Connection> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let conn = Connection::open(path)?;
    // Stages may overlap (e.g. `vet` while a long `fill` runs): wait for the
    // writer instead of failing with SQLITE_BUSY.
    conn.busy_timeout(std::time::Duration::from_secs(600))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         CREATE TABLE IF NOT EXISTS raw_positions (
           tier INTEGER NOT NULL,
           epd TEXT NOT NULL,
           w INTEGER NOT NULL, d INTEGER NOT NULL, b INTEGER NOT NULL,
           -- [[uci, w, d, b, titled], ...] most-played first
           moves TEXT NOT NULL,
           PRIMARY KEY (tier, epd)
         ) WITHOUT ROWID;",
    )?;
    Ok(conn)
}

/// Replace one tier's rows. Returns the bytes of move JSON written.
pub fn write_raw(path: &Path, tier: Tier, positions: &HashMap<u64, PosAgg>) -> Result<u64> {
    let mut conn = open(path)?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM raw_positions WHERE tier = ?1", params![tier.id()])?;
    let mut bytes = 0u64;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO raw_positions (tier, epd, w, d, b, moves) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;
        for p in positions.values() {
            let Some(epd) = &p.epd else { continue };
            let mut moves: Vec<_> =
                p.moves.iter().filter(|m| m.wdb.total() >= MIN_STORED_MOVE_GAMES).collect();
            moves.sort_by_key(|m| std::cmp::Reverse(m.wdb.total()));
            let json = serde_json::to_string(
                &moves
                    .iter()
                    .map(|m| {
                        serde_json::json!([
                            decode_uci(m.mv).to_string(),
                            m.wdb.w,
                            m.wdb.d,
                            m.wdb.b,
                            m.titled
                        ])
                    })
                    .collect::<Vec<_>>(),
            )?;
            bytes += json.len() as u64;
            stmt.execute(params![tier.id(), epd.as_ref(), p.wdb.w, p.wdb.d, p.wdb.b, json])?;
        }
    }
    tx.commit()?;
    Ok(bytes)
}
