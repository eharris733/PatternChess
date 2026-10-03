//! Engine evals for book positions: `evals` (Lichess eval DB, CC0), `fill`
//! (native Stockfish for the gaps) and the winning-chances port used by `vet`.
//!
//! Convention (same as the app): a position's `cp` is from its side to move.

use std::{
    collections::VecDeque,
    fs::File,
    io::{BufRead, BufReader, BufWriter, Write},
    path::Path,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::Instant,
};

use anyhow::{Context, Result, bail};
use hashbrown::HashSet;
use rusqlite::{Connection, params};
use shakmaty::{CastlingMode, Chess, Position, fen::Fen, uci::UciMove};

use crate::ingest::epd_string;

/// Moves need this many games before `fill` spends engine time on them
/// (mirrors MIN_MOVE_GAMES in src/chess/openingDeviation.ts).
pub const FILL_MIN_MOVE_GAMES: i64 = 3;
/// Positions need this many games before `fill` evaluates the position itself
/// (MIN_POSITION_GAMES in the app — below it theory has already ended).
pub const FILL_MIN_POSITION_GAMES: i64 = 10;
pub const MATE_CP: i64 = 10_000;

/// Lichess winning-chances model (src/chess/winningChances.ts `winPercent`).
pub fn win_percent(cp: i64) -> f64 {
    50.0 + 50.0 * (2.0 / (1.0 + (-0.00368208 * cp as f64).exp()) - 1.0)
}

pub fn ensure_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS evals (
           epd TEXT PRIMARY KEY,
           cp INTEGER NOT NULL,      -- side-to-move perspective
           depth INTEGER NOT NULL,
           source TEXT NOT NULL      -- 'lichess' | 'stockfish'
         ) WITHOUT ROWID;",
    )?;
    Ok(())
}

pub fn position_from_epd(epd: &str) -> Result<Chess> {
    let fen: Fen = format!("{epd} 0 1").parse().with_context(|| format!("bad epd {epd}"))?;
    Ok(fen.into_position(CastlingMode::Standard)?)
}

pub fn child_epd(pos: &Chess, uci: &str) -> Option<String> {
    let m = uci.parse::<UciMove>().ok()?.to_move(pos).ok()?;
    let mut child = pos.clone();
    child.play_unchecked(m);
    Some(epd_string(&child))
}

/// Every EPD whose eval `vet` can use: stored positions and the children of
/// their stored moves.
fn wanted_epds(conn: &Connection) -> Result<HashSet<String>> {
    let mut wanted = HashSet::new();
    let mut stmt = conn.prepare("SELECT epd, moves FROM raw_positions")?;
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let epd: String = r.get(0)?;
        let moves: String = r.get(1)?;
        let pos = position_from_epd(&epd)?;
        for m in serde_json::from_str::<Vec<serde_json::Value>>(&moves)? {
            if let Some(c) = m[0].as_str().and_then(|u| child_epd(&pos, u)) {
                wanted.insert(c);
            }
        }
        wanted.insert(epd);
    }
    Ok(wanted)
}

/// Lichess eval DB lines put the FEN first: {"fen":"<epd>","evals":[...]}.
fn line_epd(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("{\"fen\":\"")?;
    Some(&rest[..rest.find('"')?])
}

/// Normalize to chess.js's EPD (en passant only when legally capturable).
fn normalize(epd: &str) -> Option<String> {
    if epd.rsplit(' ').next() == Some("-") {
        return Some(epd.to_owned());
    }
    position_from_epd(epd).ok().map(|p| epd_string(&p))
}

/// `evals`: stream the Lichess eval DB and keep the deepest eval of every
/// wanted position. Lichess evals are white-perspective; stored side-to-move.
pub fn import_lichess_evals(db: &Path, evals_file: &Path) -> Result<()> {
    let conn = crate::store::open(db)?;
    ensure_tables(&conn)?;
    let wanted = wanted_epds(&conn)?;
    eprintln!("looking for {} positions in {}", wanted.len(), evals_file.display());

    let reader = BufReader::with_capacity(1 << 22, zstd::Decoder::new(File::open(evals_file)?)?);
    let started = Instant::now();
    let mut found = 0u64;
    let mut batch: Vec<(String, i64, i64)> = Vec::new();
    let flush = |conn: &Connection, batch: &mut Vec<(String, i64, i64)>| -> Result<()> {
        let tx = conn.unchecked_transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO evals (epd, cp, depth, source) VALUES (?1, ?2, ?3, 'lichess')
                 ON CONFLICT(epd) DO UPDATE SET cp = excluded.cp, depth = excluded.depth, source = 'lichess'
                 WHERE excluded.depth > evals.depth",
            )?;
            for (epd, cp, depth) in batch.drain(..) {
                stmt.execute(params![epd, cp, depth])?;
            }
        }
        tx.commit()?;
        Ok(())
    };

    for (i, line) in reader.lines().enumerate() {
        let line = line?;
        if i % 20_000_000 == 0 && i > 0 {
            eprintln!("  {}M lines, {} found ({:.0}s)", i / 1_000_000, found, started.elapsed().as_secs_f64());
        }
        let Some(raw) = line_epd(&line) else { continue };
        let Some(epd) = normalize(raw) else { continue };
        if !wanted.contains(&epd) {
            continue;
        }
        let v: serde_json::Value = serde_json::from_str(&line)?;
        let Some((cp_white, depth)) = deepest_eval(&v) else { continue };
        let stm_white = epd.split(' ').nth(1) == Some("w");
        let cp = if stm_white { cp_white } else { -cp_white };
        batch.push((epd, cp, depth));
        found += 1;
        if batch.len() >= 50_000 {
            flush(&conn, &mut batch)?;
        }
    }
    flush(&conn, &mut batch)?;
    eprintln!(
        "found {found} of {} wanted positions ({:.0}s)",
        wanted.len(),
        started.elapsed().as_secs_f64()
    );
    Ok(())
}

fn deepest_eval(v: &serde_json::Value) -> Option<(i64, i64)> {
    let best = v["evals"]
        .as_array()?
        .iter()
        .max_by_key(|e| e["depth"].as_i64().unwrap_or(0))?;
    let depth = best["depth"].as_i64()?;
    let pv = best["pvs"].as_array()?.first()?;
    let cp = if let Some(cp) = pv["cp"].as_i64() {
        cp
    } else {
        let mate = pv["mate"].as_i64()?;
        mate.signum() * (MATE_CP - mate.abs())
    };
    Some((cp, depth))
}

/// `fill`: native Stockfish on book positions (≥ FILL_MIN_POSITION_GAMES) and
/// children of book moves (≥ FILL_MIN_MOVE_GAMES) that the eval DB lacks.
/// Incremental — rerunning only evaluates positions still missing.
pub fn fill_with_stockfish(
    db: &Path,
    stockfish: &str,
    workers: usize,
    depth: u32,
    movetime_ms: u64,
    limit: Option<usize>,
    min_move_games: i64,
    parents: bool,
) -> Result<()> {
    let conn = crate::store::open(db)?;
    ensure_tables(&conn)?;
    let have: HashSet<String> = conn
        .prepare("SELECT epd FROM evals")?
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<_, _>>()?;

    let mut todo: HashSet<String> = HashSet::new();
    let mut parents_missing = 0usize;
    let mut buckets = [0usize; 4];
    {
        let mut stmt = conn.prepare("SELECT epd, w + d + b, moves FROM raw_positions")?;
        let mut rows = stmt.query([])?;
        while let Some(r) = rows.next()? {
            let epd: String = r.get(0)?;
            let total: i64 = r.get(1)?;
            let moves: String = r.get(2)?;
            // Below the position floor theory has already ended: the walk
            // never consults `sound` there, so its moves aren't worth engine time.
            if total < FILL_MIN_POSITION_GAMES {
                continue;
            }
            if parents && !have.contains(&epd) {
                todo.insert(epd.clone());
                parents_missing += 1;
            }
            let pos = position_from_epd(&epd)?;
            for m in serde_json::from_str::<Vec<serde_json::Value>>(&moves)? {
                let games = m[1].as_i64().unwrap_or(0) + m[2].as_i64().unwrap_or(0) + m[3].as_i64().unwrap_or(0);
                if games < min_move_games.max(FILL_MIN_MOVE_GAMES) {
                    continue;
                }
                if let Some(c) = m[0].as_str().and_then(|u| child_epd(&pos, u)) {
                    if !have.contains(&c) && !position_from_epd(&c)?.is_game_over() && todo.insert(c) {
                        let b = match games { 3..=9 => 0, 10..=19 => 1, 20..=99 => 2, _ => 3 };
                        buckets[b] += 1;
                    }
                }
            }
        }
    }
    let mut todo: Vec<String> = todo.into_iter().collect();
    todo.sort();
    eprintln!(
        "fill: {} positions missing evals in total ({parents_missing} book positions, {} after-move positions)",
        todo.len(),
        todo.len() - parents_missing
    );
    eprintln!(
        "  after-move gaps by move games: 3-9 {}, 10-19 {}, 20-99 {}, 100+ {}",
        buckets[0], buckets[1], buckets[2], buckets[3]
    );
    if let Some(n) = limit {
        todo.truncate(n);
    }
    let total = todo.len();
    eprintln!(
        "fill: {total} positions missing evals; {workers} × stockfish (depth {depth}, ≤{movetime_ms} ms)"
    );
    if total == 0 {
        return Ok(());
    }

    let queue = Arc::new(Mutex::new(VecDeque::from(todo)));
    let (tx, rx) = std::sync::mpsc::channel::<(String, i64, i64)>();
    let mut handles = Vec::new();
    for _ in 0..workers {
        let queue = Arc::clone(&queue);
        let tx = tx.clone();
        let stockfish = stockfish.to_owned();
        handles.push(std::thread::spawn(move || -> Result<()> {
            let mut engine = Uci::spawn(&stockfish)?;
            loop {
                let Some(epd) = queue.lock().unwrap().pop_front() else { break };
                let (cp, d) = engine.eval(&format!("{epd} 0 1"), depth, movetime_ms)?;
                tx.send((epd, cp, d)).ok();
            }
            Ok(())
        }));
    }
    drop(tx);

    let started = Instant::now();
    let mut done = 0usize;
    let mut depth_sum = 0i64;
    let mut stmt = conn.prepare(
        "INSERT INTO evals (epd, cp, depth, source) VALUES (?1, ?2, ?3, 'stockfish')
         ON CONFLICT(epd) DO UPDATE SET cp = excluded.cp, depth = excluded.depth, source = 'stockfish'
         WHERE excluded.depth > evals.depth",
    )?;
    for (epd, cp, d) in rx {
        stmt.execute(params![epd, cp, d])?;
        done += 1;
        depth_sum += d;
        if done % 500 == 0 || done == total {
            let rate = done as f64 / started.elapsed().as_secs_f64();
            eprintln!(
                "  {done}/{total}  avg depth {:.1}  {:.1}/s  eta {:.0} min",
                depth_sum as f64 / done as f64,
                rate,
                (total - done) as f64 / rate / 60.0
            );
        }
    }
    for h in handles {
        h.join().map_err(|_| anyhow::anyhow!("stockfish worker panicked"))??;
    }
    Ok(())
}

struct Uci {
    stdin: BufWriter<std::process::ChildStdin>,
    stdout: BufReader<std::process::ChildStdout>,
    _child: std::process::Child,
}

impl Uci {
    fn spawn(path: &str) -> Result<Uci> {
        let mut child = Command::new(path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .with_context(|| format!("spawn {path}"))?;
        let mut uci = Uci {
            stdin: BufWriter::new(child.stdin.take().unwrap()),
            stdout: BufReader::new(child.stdout.take().unwrap()),
            _child: child,
        };
        uci.send("uci")?;
        uci.wait_for("uciok")?;
        uci.send("setoption name Threads value 1")?;
        uci.send("setoption name Hash value 128")?;
        uci.send("isready")?;
        uci.wait_for("readyok")?;
        Ok(uci)
    }

    fn send(&mut self, cmd: &str) -> Result<()> {
        writeln!(self.stdin, "{cmd}")?;
        self.stdin.flush()?;
        Ok(())
    }

    fn wait_for(&mut self, token: &str) -> Result<()> {
        let mut line = String::new();
        loop {
            line.clear();
            if self.stdout.read_line(&mut line)? == 0 {
                bail!("stockfish exited");
            }
            if line.starts_with(token) {
                return Ok(());
            }
        }
    }

    /// Side-to-move cp and the depth reached.
    fn eval(&mut self, fen: &str, depth: u32, movetime_ms: u64) -> Result<(i64, i64)> {
        self.send("ucinewgame")?;
        self.send(&format!("position fen {fen}"))?;
        self.send(&format!("go depth {depth} movetime {movetime_ms}"))?;
        let mut line = String::new();
        let (mut cp, mut reached) = (0i64, 0i64);
        loop {
            line.clear();
            if self.stdout.read_line(&mut line)? == 0 {
                bail!("stockfish exited");
            }
            if line.starts_with("bestmove") {
                return Ok((cp, reached));
            }
            if !line.starts_with("info") || line.contains(" bound") {
                continue;
            }
            let toks: Vec<&str> = line.split_whitespace().collect();
            let get = |k: &str| toks.iter().position(|t| *t == k).and_then(|i| toks.get(i + 1));
            if let (Some(d), Some(kind), Some(val)) = (get("depth"), get("score"), toks
                .iter()
                .position(|t| *t == "score")
                .and_then(|i| toks.get(i + 2)))
            {
                let v: i64 = val.parse().unwrap_or(0);
                cp = if *kind == "mate" { v.signum() * (MATE_CP - v.abs()) } else { v };
                reached = d.parse().unwrap_or(reached);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn win_percent_matches_app() {
        // Values from src/chess/winningChances.ts winPercent().
        assert!((win_percent(0) - 50.0).abs() < 1e-9);
        assert!((win_percent(100) - 59.1).abs() < 0.1);
        assert!((win_percent(-300) - 24.9).abs() < 0.1);
    }

    #[test]
    fn eval_line_parsing() {
        let line = r#"{"fen":"rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3","evals":[{"pvs":[{"cp":30,"line":"c7c5"}],"knodes":1,"depth":20},{"pvs":[{"mate":-3,"line":"x"}],"knodes":1,"depth":40}]}"#;
        assert_eq!(
            normalize(line_epd(line).unwrap()).unwrap(),
            "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -"
        );
        let v: serde_json::Value = serde_json::from_str(line).unwrap();
        assert_eq!(deepest_eval(&v), Some((-(MATE_CP - 3), 40)));
    }
}
