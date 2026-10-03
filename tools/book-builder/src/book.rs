//! `vet` (engine-check every book move) and `emit` (D1 SQL).

use std::{fs, io::Write, path::Path};

use anyhow::Result;
use hashbrown::HashMap;
use rusqlite::params;
use sha1::{Digest, Sha1};
use shakmaty::{san::San, uci::UciMove};

use crate::engine::{self, child_epd, position_from_epd, win_percent};

/// A book move is `sound` when it loses at most this many winning-chance
/// points against the best available option. Looser than the 5% training
/// accept bar on purpose (user decision 2026-09-26) so established gambits
/// like the King's Gambit (~5% by the engine) still count as theory.
pub const SOUND_MAX_LOSS_PCT: f64 = 8.0;

/// `vet`: join raw_positions with evals into `book`. Per move:
/// `cp` = eval after the move from the mover's perspective (null if unknown);
/// `sound` = within SOUND_MAX_LOSS_PCT of the best of the position's own eval
/// and every evaluated move (null when the move itself has no eval).
pub fn vet(db: &Path) -> Result<()> {
    let mut conn = crate::store::open(db)?;
    engine::ensure_tables(&conn)?;
    let evals: HashMap<String, (i64, i64)> = conn
        .prepare("SELECT epd, cp, depth FROM evals")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?))))?
        .collect::<Result<_, _>>()?;
    eprintln!("vet: {} evals loaded", evals.len());

    let tx = conn.transaction()?;
    tx.execute_batch(
        "DROP TABLE IF EXISTS book;
         CREATE TABLE book (
           tier INTEGER NOT NULL,
           epd TEXT NOT NULL,
           w INTEGER NOT NULL, d INTEGER NOT NULL, b INTEGER NOT NULL,
           cp INTEGER, depth INTEGER,       -- side-to-move eval of the position
           -- [[uci, san, w, d, b, titled, cp|null, 1|0|null], ...]
           moves TEXT NOT NULL,
           PRIMARY KEY (tier, epd)
         ) WITHOUT ROWID;",
    )?;
    let (mut n_moves, mut n_eval, mut n_unsound) = (0u64, 0u64, 0u64);
    {
        let mut read = tx.prepare("SELECT tier, epd, w, d, b, moves FROM raw_positions")?;
        let mut write = tx.prepare(
            "INSERT INTO book (tier, epd, w, d, b, cp, depth, moves) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )?;
        let mut rows = read.query([])?;
        while let Some(r) = rows.next()? {
            let (tier, epd): (i64, String) = (r.get(0)?, r.get(1)?);
            let (w, d, b): (i64, i64, i64) = (r.get(2)?, r.get(3)?, r.get(4)?);
            let raw: Vec<serde_json::Value> = serde_json::from_str(&r.get::<_, String>(5)?)?;
            let pos = position_from_epd(&epd)?;
            let own = evals.get(&epd).copied();

            let mut moves = Vec::with_capacity(raw.len());
            for m in &raw {
                let uci = m[0].as_str().unwrap_or_default();
                let Some(mv) = uci.parse::<UciMove>().ok().and_then(|u| u.to_move(&pos).ok()) else { continue };
                let san = San::from_move(&pos, mv).to_string();
                let child = child_epd(&pos, uci);
                let mut after = pos.clone();
                shakmaty::Position::play_unchecked(&mut after, mv);
                let cp = if shakmaty::Position::is_checkmate(&after) {
                    Some(engine::MATE_CP)
                } else if shakmaty::Position::is_stalemate(&after) {
                    Some(0)
                } else {
                    child.and_then(|c| evals.get(&c)).map(|(cp, _)| -cp)
                };
                moves.push((uci.to_owned(), san, m, cp));
            }
            let best = moves
                .iter()
                .filter_map(|(_, _, _, cp)| *cp)
                .chain(own.map(|(cp, _)| cp))
                .max();
            let json: Vec<serde_json::Value> = moves
                .iter()
                .map(|(uci, san, m, cp)| {
                    n_moves += 1;
                    let sound = match (best, cp) {
                        (Some(best), Some(cp)) => {
                            n_eval += 1;
                            let ok = win_percent(best) - win_percent(*cp) <= SOUND_MAX_LOSS_PCT;
                            if !ok {
                                n_unsound += 1;
                            }
                            serde_json::json!(ok as u8)
                        }
                        _ => serde_json::Value::Null,
                    };
                    serde_json::json!([uci, san, m[1], m[2], m[3], m[4], cp, sound])
                })
                .collect();
            write.execute(params![
                tier,
                epd,
                w,
                d,
                b,
                own.map(|e| e.0),
                own.map(|e| e.1),
                serde_json::to_string(&json)?
            ])?;
        }
    }
    tx.commit()?;
    eprintln!("vet: {n_moves} moves, {n_eval} with evals, {n_unsound} unsound");
    Ok(())
}

/// The first 53 bits of SHA-1(epd) — the D1 key. 53 bits so it survives JS
/// number precision (D1 returns INTEGER as a JS number); `bookKey` in
/// src/chess/bookFormat.ts computes the same with Web Crypto.
pub fn epd_key(epd: &str) -> i64 {
    let digest = Sha1::digest(epd.as_bytes());
    (u64::from_be_bytes(digest[..8].try_into().unwrap()) >> 11) as i64
}

fn sql_str(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// `emit`: D1 SQL into `out_dir`: schema.sql (creates `book_positions_next`),
/// data-NNN.sql chunks, swap.sql (atomically replaces `book_positions`).
pub fn emit(db: &Path, out_dir: &Path, tiers: &[i64], source_note: &str) -> Result<()> {
    let conn = crate::store::open(db)?;
    fs::create_dir_all(out_dir)?;
    for entry in fs::read_dir(out_dir)? {
        let p = entry?.path();
        if p.extension().is_some_and(|e| e == "sql") {
            fs::remove_file(p)?;
        }
    }
    fs::write(
        out_dir.join("schema.sql"),
        "DROP TABLE IF EXISTS book_positions_next;\n\
         CREATE TABLE book_positions_next (\n  \
           tier INTEGER NOT NULL,\n  key INTEGER NOT NULL,\n  \
           w INTEGER NOT NULL, d INTEGER NOT NULL, b INTEGER NOT NULL,\n  \
           cp INTEGER, depth INTEGER,\n  moves TEXT NOT NULL,\n  \
           PRIMARY KEY (tier, key)\n) WITHOUT ROWID;\n\
         CREATE TABLE IF NOT EXISTS book_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);\n",
    )?;

    const ROWS_PER_INSERT: usize = 50;
    const ROWS_PER_FILE: usize = 200_000;
    let mut stmt = conn.prepare("SELECT tier, epd, w, d, b, cp, depth, moves FROM book ORDER BY tier, epd")?;
    let mut rows = stmt.query([])?;
    let (mut file_no, mut in_file, mut total) = (0usize, 0usize, 0usize);
    // 53-bit keys: a collision among ~3M rows is unlikely but possible; keep
    // the first row (ORDER BY puts OTB first) rather than fail the import.
    let mut used: hashbrown::HashSet<(i64, i64)> = hashbrown::HashSet::new();
    let mut collisions = 0usize;
    let mut out: Option<fs::File> = None;
    let mut values: Vec<String> = Vec::with_capacity(ROWS_PER_INSERT);
    let flush = |out: &mut Option<fs::File>, values: &mut Vec<String>| -> Result<()> {
        if values.is_empty() {
            return Ok(());
        }
        writeln!(
            out.as_mut().unwrap(),
            "INSERT INTO book_positions_next (tier, key, w, d, b, cp, depth, moves) VALUES\n{};",
            values.join(",\n")
        )?;
        values.clear();
        Ok(())
    };
    while let Some(r) = rows.next()? {
        let tier: i64 = r.get(0)?;
        if !tiers.contains(&tier) {
            continue;
        }
        if out.is_none() || in_file >= ROWS_PER_FILE {
            flush(&mut out, &mut values)?;
            file_no += 1;
            in_file = 0;
            out = Some(fs::File::create(out_dir.join(format!("data-{file_no:03}.sql")))?);
        }
        let epd: String = r.get(1)?;
        let key = epd_key(&epd);
        if !used.insert((tier, key)) {
            collisions += 1;
            continue;
        }
        let cp: Option<i64> = r.get(5)?;
        let depth: Option<i64> = r.get(6)?;
        let opt = |v: Option<i64>| v.map_or("NULL".to_owned(), |x| x.to_string());
        values.push(format!(
            "({},{},{},{},{},{},{},{})",
            tier,
            key,
            r.get::<_, i64>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, i64>(4)?,
            opt(cp),
            opt(depth),
            sql_str(&r.get::<_, String>(7)?)
        ));
        in_file += 1;
        total += 1;
        if values.len() >= ROWS_PER_INSERT {
            flush(&mut out, &mut values)?;
        }
    }
    flush(&mut out, &mut values)?;

    let built = std::process::Command::new("date").arg("-u").arg("+%Y-%m-%dT%H:%M:%SZ").output()?;
    let built = String::from_utf8_lossy(&built.stdout).trim().to_owned();
    fs::write(
        out_dir.join("swap.sql"),
        format!(
            "DROP TABLE IF EXISTS book_positions_prev;\n\
             ALTER TABLE book_positions RENAME TO book_positions_prev;\n\
             ALTER TABLE book_positions_next RENAME TO book_positions;\n\
             INSERT OR REPLACE INTO book_meta (k, v) VALUES ('built_at', {}), ('rows', '{}'), ('sources', {});\n",
            sql_str(&built),
            total,
            sql_str(source_note)
        ),
    )?;
    // First import: there's no book_positions yet to rename.
    fs::write(
        out_dir.join("swap-first.sql"),
        format!(
            "ALTER TABLE book_positions_next RENAME TO book_positions;\n\
             INSERT OR REPLACE INTO book_meta (k, v) VALUES ('built_at', {}), ('rows', '{}'), ('sources', {});\n",
            sql_str(&built),
            total,
            sql_str(source_note)
        ),
    )?;
    eprintln!(
        "emit: {total} rows in {file_no} data files → {} ({collisions} key collisions skipped)",
        out_dir.display()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const START_KEY: i64 = 3_614_949_416_266_703;

    #[test]
    fn key_matches_web_crypto() {
        // Same value as bookKey() in src/chess/bookFormat.ts (see bookFormat.test.ts).
        assert_eq!(
            epd_key("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"),
            START_KEY
        );
        assert!(START_KEY < (1i64 << 53));
        assert_ne!(
            epd_key("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"),
            epd_key("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -")
        );
    }
}
