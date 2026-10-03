//! PatternChess opening-book builder. Offline only — never part of `npm run build`.
//!
//! Stages, each incremental into data/book/work.sqlite (override with --db):
//!
//!   ingest --tier otb|elite [--floor 5] [--write] FILE...   PGN → raw_positions (without --write: counts only)
//!   evals FILE                                            Lichess eval DB → evals
//!   fill [--stockfish PATH] [--workers N] [--depth 30] [--movetime 10000] [--limit N]
//!        [--min-move-games 3] [--no-parents]   (tier the budget: deep for popular moves, fast for rare)
//!                                                         native Stockfish for positions still missing evals
//!   vet                                                   raw_positions + evals → book (per-move cp + sound)
//!   emit [--out data/book/d1] [--tiers otb,elite] [--sources TEXT]
//!                                                         book → D1 SQL (schema, data chunks, swap)
//!
//! Inputs come from scripts/book/download.sh; import with scripts/book/import-d1.sh.

mod book;
mod engine;
mod ingest;
mod store;

use std::{path::PathBuf, time::Instant};

use anyhow::{Result, bail};

use ingest::Aggregator;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tier {
    Otb,
    Elite,
}

impl Tier {
    fn parse(s: &str) -> Result<Tier> {
        match s {
            "otb" => Ok(Tier::Otb),
            "elite" => Ok(Tier::Elite),
            _ => bail!("--tier must be otb or elite"),
        }
    }

    /// Stored tier id (the API maps 0 → "otb", 1 → "elite").
    pub fn id(self) -> i64 {
        match self {
            Tier::Otb => 0,
            Tier::Elite => 1,
        }
    }
}

struct Args {
    cmd: String,
    tier: Tier,
    floor: u32,
    db: PathBuf,
    write: bool,
    out: PathBuf,
    tiers: Vec<i64>,
    sources: String,
    stockfish: String,
    workers: usize,
    depth: u32,
    movetime: u64,
    limit: Option<usize>,
    min_move_games: i64,
    parents: bool,
    files: Vec<PathBuf>,
}

fn parse_args() -> Result<Args> {
    let data = concat!(env!("CARGO_MANIFEST_DIR"), "/../../data/book");
    let mut it = std::env::args().skip(1);
    let mut a = Args {
        cmd: it.next().unwrap_or_default(),
        tier: Tier::Otb,
        floor: 5,
        db: PathBuf::from(format!("{data}/work.sqlite")),
        write: false,
        out: PathBuf::from(format!("{data}/d1")),
        tiers: vec![0, 1],
        sources: "Lichess broadcasts (CC BY-SA 4.0), Lichess Elite Database, Lichess evaluations (CC0)".into(),
        stockfish: "stockfish".into(),
        workers: std::thread::available_parallelism().map_or(4, |n| n.get().saturating_sub(2).max(1)),
        depth: 30,
        movetime: 10_000,
        limit: None,
        min_move_games: 3,
        parents: true,
        files: Vec::new(),
    };
    let mut next = |name: &str| it.next().ok_or_else(|| anyhow::anyhow!("{name} needs a value"));
    loop {
        let Ok(arg) = next("") else { break };
        match arg.as_str() {
            "--tier" => a.tier = Tier::parse(&next("--tier")?)?,
            "--floor" => a.floor = next("--floor")?.parse()?,
            "--db" => a.db = PathBuf::from(next("--db")?),
            "--write" => a.write = true,
            "--out" => a.out = PathBuf::from(next("--out")?),
            "--tiers" => {
                a.tiers = next("--tiers")?
                    .split(',')
                    .map(|t| Tier::parse(t.trim()).map(Tier::id))
                    .collect::<Result<_>>()?
            }
            "--sources" => a.sources = next("--sources")?,
            "--stockfish" => a.stockfish = next("--stockfish")?,
            "--workers" => a.workers = next("--workers")?.parse()?,
            "--depth" => a.depth = next("--depth")?.parse()?,
            "--movetime" => a.movetime = next("--movetime")?.parse()?,
            "--limit" => a.limit = Some(next("--limit")?.parse()?),
            "--min-move-games" => a.min_move_games = next("--min-move-games")?.parse()?,
            "--no-parents" => a.parents = false,
            _ => a.files.push(PathBuf::from(arg)),
        }
    }
    Ok(a)
}

fn main() -> Result<()> {
    let args = parse_args()?;
    match args.cmd.as_str() {
        "ingest" => ingest(&args),
        "evals" => match args.files.as_slice() {
            [f] => engine::import_lichess_evals(&args.db, f),
            _ => bail!("usage: book-builder evals lichess_db_eval.jsonl.zst"),
        },
        "fill" => engine::fill_with_stockfish(
            &args.db,
            &args.stockfish,
            args.workers,
            args.depth,
            args.movetime,
            args.limit,
            args.min_move_games,
            args.parents,
        ),
        "vet" => book::vet(&args.db),
        "emit" => book::emit(&args.db, &args.out, &args.tiers, &args.sources),
        _ => bail!("usage: book-builder ingest|evals|fill|vet|emit … (see src/main.rs)"),
    }
}

fn ingest(args: &Args) -> Result<()> {
    let started = Instant::now();
    let mut agg = Aggregator::new(args.tier, args.floor);
    eprintln!("pass 1/2: counting positions");
    for f in &args.files {
        eprintln!("  {}", f.display());
        agg.ingest_path(f)?;
    }
    let distinct = agg.counts.len();
    let mut buckets = [0u64; 6];
    let thresholds = [1u32, 2, 5, 10, 20, 100];
    for c in agg.counts.values() {
        for (i, th) in thresholds.iter().enumerate() {
            if c >= th {
                buckets[i] += 1;
            }
        }
    }
    agg.begin_aggregate();
    eprintln!("pass 2/2: aggregating {} positions at ≥{} games", agg.counts.len(), args.floor);
    for f in &args.files {
        eprintln!("  {}", f.display());
        agg.ingest_path(f)?;
    }

    let s = &agg.stats;
    println!("tier {:?}  ({:.1}s)", args.tier, started.elapsed().as_secs_f64());
    println!(
        "games read {}  kept {}  | rejected: elo {} speed {} variant {} result {} illegal {} short {} duplicate {}",
        s.games_read, s.kept, s.rej_elo, s.rej_speed, s.rej_variant, s.rej_result, s.rej_illegal,
        s.rej_short, s.rej_duplicate
    );
    println!("distinct positions (ply ≤ {}): {distinct}", ingest::MAX_PLY);
    for (i, th) in thresholds.iter().enumerate() {
        println!("positions with ≥{th:>3} games: {}", buckets[i]);
    }
    let stored_moves: usize = agg
        .positions
        .values()
        .map(|p| p.moves.iter().filter(|m| m.wdb.total() >= store::MIN_STORED_MOVE_GAMES).count())
        .sum();
    println!("stored: {} positions, {} moves", agg.positions.len(), stored_moves);

    if args.write {
        let bytes = store::write_raw(&args.db, args.tier, &agg.positions)?;
        println!("wrote {} ({:.1} MB of move JSON)", args.db.display(), bytes as f64 / 1e6);
    }
    Ok(())
}
