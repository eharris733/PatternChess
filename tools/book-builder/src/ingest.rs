//! `ingest`: stream PGNs, filter, replay the first MAX_PLY plies and
//! aggregate per position (keyed by Zobrist hash, EPD kept once a position
//! reaches the store floor).

use std::{
    collections::hash_map::DefaultHasher,
    fs::File,
    hash::{Hash, Hasher},
    io::{BufReader, Read},
    ops::ControlFlow,
    path::Path,
};

use anyhow::{Context, Result};
use hashbrown::{HashMap, HashSet};
use pgn_reader::{RawTag, Reader, SanPlus, Visitor};
use shakmaty::{
    CastlingMode, Chess, Color, EnPassantMode, KnownOutcome, Outcome, Position,
    fen::Epd, uci::UciMove, zobrist::Zobrist64,
};

use crate::Tier;

pub const MAX_PLY: usize = 40;
pub const OTB_MIN_ELO: u32 = 2200;
/// Estimated minutes per player below which an OTB game counts as blitz.
const OTB_MIN_MINUTES: f64 = 10.0;

#[derive(Default, Clone, Copy)]
pub struct Wdb {
    pub w: u32,
    pub d: u32,
    pub b: u32,
}

impl Wdb {
    pub fn total(&self) -> u32 {
        self.w + self.d + self.b
    }
    fn add(&mut self, r: GameResult) {
        match r {
            GameResult::White => self.w += 1,
            GameResult::Draw => self.d += 1,
            GameResult::Black => self.b += 1,
        }
    }
}

pub struct MoveAgg {
    /// Standard UCI (e1g1 castling), from `encode_uci`.
    pub mv: u16,
    pub wdb: Wdb,
    /// Games where the side playing this move was titled (OTB only).
    pub titled: u32,
}

#[derive(Default)]
pub struct PosAgg {
    pub wdb: Wdb,
    pub epd: Option<Box<str>>,
    pub moves: Vec<MoveAgg>,
}

#[derive(Clone, Copy)]
enum GameResult {
    White,
    Draw,
    Black,
}

#[derive(Default, Debug)]
pub struct IngestStats {
    pub games_read: u64,
    pub kept: u64,
    pub rej_variant: u64,
    pub rej_elo: u64,
    pub rej_speed: u64,
    pub rej_result: u64,
    pub rej_illegal: u64,
    pub rej_duplicate: u64,
    pub rej_short: u64,
}

/// Two passes over the same files: `Count` tallies games per position (a
/// compact u64 → u32 map, so singleton positions from millions of games fit
/// in memory), then `Aggregate` builds full stats only for positions that
/// reached the store floor.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Pass {
    Count,
    Aggregate,
}

pub struct Aggregator {
    pub tier: Tier,
    pub store_floor: u32,
    pub pass: Pass,
    pub counts: HashMap<u64, u32>,
    pub positions: HashMap<u64, PosAgg>,
    seen: HashSet<u64>,
    pub stats: IngestStats,
}

impl Aggregator {
    pub fn new(tier: Tier, store_floor: u32) -> Self {
        Aggregator {
            tier,
            store_floor,
            pass: Pass::Count,
            counts: HashMap::new(),
            positions: HashMap::new(),
            seen: HashSet::new(),
            stats: IngestStats::default(),
        }
    }

    /// Switch to the aggregate pass: drop counts below the floor and reset
    /// dedup so the second pass makes identical keep/skip decisions.
    pub fn begin_aggregate(&mut self) {
        let floor = self.store_floor;
        self.counts.retain(|_, c| *c >= floor);
        self.counts.shrink_to_fit();
        self.positions = HashMap::with_capacity(self.counts.len());
        self.seen.clear();
        self.stats = IngestStats::default();
        self.pass = Pass::Aggregate;
    }

    pub fn ingest_path(&mut self, path: &Path) -> Result<()> {
        let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
        let name = path.to_string_lossy();
        if name.ends_with(".zst") {
            self.ingest_reader(zstd::Decoder::new(file)?)
        } else if name.ends_with(".zip") {
            let mut archive = zip::ZipArchive::new(BufReader::new(file))?;
            for i in 0..archive.len() {
                let entry = archive.by_index(i)?;
                if entry.name().ends_with(".pgn") {
                    self.ingest_reader(entry)?;
                }
            }
            Ok(())
        } else {
            self.ingest_reader(file)
        }
    }

    fn ingest_reader<R: Read>(&mut self, r: R) -> Result<()> {
        let mut reader = Reader::new(BufReader::with_capacity(1 << 20, r));
        let mut visitor = GameVisitor { tier: self.tier };
        while let Some(out) = reader.read_game(&mut visitor)? {
            self.stats.games_read += 1;
            match out {
                Err(rej) => match rej {
                    Reject::Variant => self.stats.rej_variant += 1,
                    Reject::Elo => self.stats.rej_elo += 1,
                    Reject::Speed => self.stats.rej_speed += 1,
                    Reject::Result => self.stats.rej_result += 1,
                    Reject::Illegal => self.stats.rej_illegal += 1,
                    Reject::Short => self.stats.rej_short += 1,
                },
                Ok(game) => {
                    if !self.seen.insert(game.dedup) {
                        self.stats.rej_duplicate += 1;
                        continue;
                    }
                    self.stats.kept += 1;
                    match self.pass {
                        Pass::Count => {
                            for ply in &game.plies {
                                *self.counts.entry(ply.key).or_default() += 1;
                            }
                        }
                        Pass::Aggregate => self.add_game(game),
                    }
                }
            }
            if self.stats.games_read % 1_000_000 == 0 {
                eprintln!(
                    "  {} games read, {} kept, {} counted, {} aggregated",
                    self.stats.games_read,
                    self.stats.kept,
                    self.counts.len(),
                    self.positions.len()
                );
            }
        }
        Ok(())
    }

    fn add_game(&mut self, game: Game) {
        for ply in &game.plies {
            if !self.counts.contains_key(&ply.key) {
                continue;
            }
            let entry = self.positions.entry(ply.key).or_default();
            entry.wdb.add(game.result);
            if entry.epd.is_none() {
                entry.epd = Some(epd_string(&ply.pos).into_boxed_str());
            }
            if let Some(mv) = ply.mv {
                let titled = ply.mover_titled as u32;
                match entry.moves.iter_mut().find(|m| m.mv == mv) {
                    Some(m) => {
                        m.wdb.add(game.result);
                        m.titled += titled;
                    }
                    None => {
                        let mut wdb = Wdb::default();
                        wdb.add(game.result);
                        entry.moves.push(MoveAgg { mv, wdb, titled });
                    }
                }
            }
        }
    }
}

/// 6 bits from, 6 bits to, 3 bits promotion role (0 = none).
pub fn encode_uci(u: &UciMove) -> Option<u16> {
    match u {
        UciMove::Normal { from, to, promotion } => Some(
            u16::from(*from) | (u16::from(*to) << 6) | ((promotion.map_or(0, |r| r as u16)) << 12),
        ),
        _ => None,
    }
}

pub fn decode_uci(v: u16) -> UciMove {
    use shakmaty::{Role, Square};
    let from = Square::new((v & 63) as u32);
    let to = Square::new(((v >> 6) & 63) as u32);
    let promotion = match v >> 12 {
        0 => None,
        r => Role::try_from(r as u32).ok(),
    };
    UciMove::Normal { from, to, promotion }
}

pub fn epd_string(pos: &Chess) -> String {
    Epd::from_position(pos, EnPassantMode::Legal).to_string()
}

struct Ply {
    key: u64,
    /// Position before `mv` (EPD is only rendered for stored positions).
    pos: Chess,
    /// None for the final position (game ended before MAX_PLY).
    mv: Option<u16>,
    mover_titled: bool,
}

struct Game {
    dedup: u64,
    result: GameResult,
    plies: Vec<Ply>,
}

enum Reject {
    Variant,
    Elo,
    Speed,
    Result,
    Illegal,
    Short,
}

#[derive(Default)]
struct Tags {
    white_elo: u32,
    black_elo: u32,
    white_titled: bool,
    black_titled: bool,
    result: Option<GameResult>,
    non_standard: bool,
    blitz: bool,
    dedup: DefaultHasher,
}

struct Movetext {
    tags: Tags,
    pos: Chess,
    plies: Vec<Ply>,
    illegal: bool,
    total_plies: usize,
}

struct GameVisitor {
    tier: Tier,
}

impl Visitor for GameVisitor {
    type Tags = Tags;
    type Movetext = Movetext;
    type Output = Result<Game, Reject>;

    fn begin_tags(&mut self) -> ControlFlow<Self::Output, Self::Tags> {
        ControlFlow::Continue(Tags::default())
    }

    fn tag(&mut self, tags: &mut Tags, name: &[u8], value: RawTag<'_>) -> ControlFlow<Self::Output> {
        let v = value.decode_utf8_lossy();
        match name {
            b"WhiteElo" => tags.white_elo = v.trim().parse().unwrap_or(0),
            b"BlackElo" => tags.black_elo = v.trim().parse().unwrap_or(0),
            b"WhiteTitle" => tags.white_titled = is_title(&v),
            b"BlackTitle" => tags.black_titled = is_title(&v),
            b"Result" => {
                tags.result = match v.as_ref() {
                    "1-0" => Some(GameResult::White),
                    "0-1" => Some(GameResult::Black),
                    "1/2-1/2" => Some(GameResult::Draw),
                    _ => None,
                }
            }
            b"Variant" => tags.non_standard |= !v.eq_ignore_ascii_case("standard"),
            b"SetUp" | b"FEN" => tags.non_standard = true,
            b"TimeControl" => tags.blitz |= is_blitz_tc(&v),
            b"Event" => {
                let e = v.to_ascii_lowercase();
                tags.blitz |= e.contains("blitz") || e.contains("bullet") || e.contains("armageddon");
                e.hash(&mut tags.dedup);
            }
            b"White" | b"Black" | b"Date" | b"Round" => v.hash(&mut tags.dedup),
            _ => {}
        }
        ControlFlow::Continue(())
    }

    fn begin_movetext(&mut self, tags: Tags) -> ControlFlow<Self::Output, Self::Movetext> {
        if tags.non_standard {
            return ControlFlow::Break(Err(Reject::Variant));
        }
        if tags.result.is_none() {
            return ControlFlow::Break(Err(Reject::Result));
        }
        if self.tier == Tier::Otb {
            if tags.white_elo < OTB_MIN_ELO || tags.black_elo < OTB_MIN_ELO {
                return ControlFlow::Break(Err(Reject::Elo));
            }
            if tags.blitz {
                return ControlFlow::Break(Err(Reject::Speed));
            }
        }
        ControlFlow::Continue(Movetext {
            tags,
            pos: Chess::default(),
            plies: Vec::with_capacity(MAX_PLY + 1),
            illegal: false,
            total_plies: 0,
        })
    }

    fn san(&mut self, mt: &mut Movetext, san_plus: SanPlus) -> ControlFlow<Self::Output> {
        mt.total_plies += 1;
        san_plus.san.to_string().hash(&mut mt.tags.dedup);
        if mt.illegal || mt.plies.len() >= MAX_PLY {
            return ControlFlow::Continue(());
        }
        match san_plus.san.to_move(&mt.pos) {
            Ok(m) => {
                let uci = m.to_uci(CastlingMode::Standard);
                let mover_titled = match mt.pos.turn() {
                    Color::White => mt.tags.white_titled,
                    Color::Black => mt.tags.black_titled,
                };
                mt.plies.push(Ply {
                    key: mt.pos.zobrist_hash::<Zobrist64>(EnPassantMode::Legal).0,
                    pos: mt.pos.clone(),
                    mv: encode_uci(&uci),
                    mover_titled,
                });
                mt.pos.play_unchecked(m);
            }
            Err(_) => mt.illegal = true,
        }
        ControlFlow::Continue(())
    }

    fn outcome(&mut self, mt: &mut Movetext, outcome: Outcome) -> ControlFlow<Self::Output> {
        // Fall back to the movetext result when the tag was "*".
        if mt.tags.result.is_none() {
            if let Outcome::Known(k) = outcome {
                mt.tags.result = Some(match k {
                    KnownOutcome::Decisive { winner: Color::White } => GameResult::White,
                    KnownOutcome::Decisive { winner: Color::Black } => GameResult::Black,
                    KnownOutcome::Draw => GameResult::Draw,
                });
            }
        }
        ControlFlow::Continue(())
    }

    fn end_game(&mut self, mut mt: Movetext) -> Self::Output {
        if mt.illegal {
            return Err(Reject::Illegal);
        }
        // Aborted / forfeited games teach nothing about theory.
        if mt.total_plies < 8 {
            return Err(Reject::Short);
        }
        if mt.plies.len() < MAX_PLY {
            // The final position was reached too; record it without a move.
            mt.plies.push(Ply {
                key: mt.pos.zobrist_hash::<Zobrist64>(EnPassantMode::Legal).0,
                pos: mt.pos.clone(),
                mv: None,
                mover_titled: false,
            });
        }
        Ok(Game {
            dedup: mt.tags.dedup.finish(),
            result: mt.tags.result.ok_or(Reject::Result)?,
            plies: mt.plies,
        })
    }
}

fn is_title(v: &str) -> bool {
    let t = v.trim();
    !t.is_empty() && t != "-" && !t.eq_ignore_ascii_case("BOT")
}

/// Best-effort parse of the many free-text broadcast time controls. Returns
/// true only when confident the game is blitz or faster; unknown formats are
/// kept.
pub fn is_blitz_tc(raw: &str) -> bool {
    match estimated_minutes(raw) {
        Some(m) => m < OTB_MIN_MINUTES,
        None => false,
    }
}

/// Estimated minutes per player over 40 moves.
pub fn estimated_minutes(raw: &str) -> Option<f64> {
    let s = raw.trim().to_ascii_lowercase();
    if s.is_empty() || s == "-" || s == "?" {
        return None;
    }
    // "1:30:30" → h:mm(:inc)
    if let Some((h, rest)) = s.split_once(':') {
        let h: f64 = h.trim().parse().ok()?;
        let mut parts = rest.split(':');
        let m: f64 = parts.next()?.trim().parse().ok()?;
        let inc: f64 = parts.next().and_then(|x| x.trim().parse().ok()).unwrap_or(0.0);
        return Some(h * 60.0 + m + inc * 40.0 / 60.0);
    }
    let nums: Vec<f64> = s
        .split(|c: char| !c.is_ascii_digit() && c != '.')
        .filter(|x| !x.is_empty())
        .filter_map(|x| x.parse().ok())
        .collect();
    let base = *nums.first()?;
    // Increment: the number right after the first '+', if any.
    let inc = s
        .split_once('+')
        .and_then(|(_, r)| {
            r.split(|c: char| !c.is_ascii_digit() && c != '.')
                .find(|x| !x.is_empty())
                .and_then(|x| x.parse::<f64>().ok())
        })
        .unwrap_or(0.0);
    let explicit_minutes = s.contains('m') || s.contains('\'');
    // Bare numbers ≥ 180 are seconds (lichess-style "600", "5400+30").
    let base_min = if !explicit_minutes && base >= 180.0 { base / 60.0 } else { base };
    Some(base_min + inc * 40.0 / 60.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_controls() {
        assert!(!is_blitz_tc("90+30"));
        assert!(!is_blitz_tc("15+10"));
        assert!(is_blitz_tc("3+2"));
        assert!(is_blitz_tc("5+3"));
        assert!(!is_blitz_tc("10+5"));
        assert!(!is_blitz_tc("5400+30"));
        assert!(!is_blitz_tc("600"));
        assert!(is_blitz_tc("180+2"));
        assert!(!is_blitz_tc("1:30:30"));
        assert!(!is_blitz_tc("90min/40moves + 30min + 30sec/move"));
        assert!(!is_blitz_tc("60m+30s"));
        assert!(!is_blitz_tc("10'+5"));
        assert!(!is_blitz_tc("unknown"));
    }

    #[test]
    fn uci_roundtrip_and_castling() {
        let pos: Chess = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"
            .parse::<shakmaty::fen::Fen>()
            .unwrap()
            .into_position(CastlingMode::Standard)
            .unwrap();
        let m = "e1g1".parse::<UciMove>().unwrap().to_move(&pos).unwrap();
        let u = m.to_uci(CastlingMode::Standard);
        assert_eq!(u.to_string(), "e1g1");
        assert_eq!(decode_uci(encode_uci(&u).unwrap()).to_string(), "e1g1");
        let p = "a7a8q".parse::<UciMove>().unwrap();
        assert_eq!(decode_uci(encode_uci(&p).unwrap()).to_string(), "a7a8q");
    }
}

#[cfg(test)]
mod parity {
    use super::*;
    use shakmaty::{fen::Fen, san::San};

    /// tests/fixtures/epd-parity.json is generated with chess.js; the client
    /// looks positions up by chess.js's EPD, so ours must match byte for byte.
    #[test]
    fn epd_matches_chess_js() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../tests/fixtures/epd-parity.json");
        let cases: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        for case in cases.as_array().unwrap() {
            let mut pos: Chess = match case.get("startFen").and_then(|f| f.as_str()) {
                Some(f) => f.parse::<Fen>().unwrap().into_position(CastlingMode::Standard).unwrap(),
                None => Chess::default(),
            };
            for m in case["moves"].as_array().unwrap() {
                let san: San = m.as_str().unwrap().parse().unwrap();
                let mv = san.to_move(&pos).unwrap();
                pos.play_unchecked(mv);
            }
            assert_eq!(epd_string(&pos), case["epd"].as_str().unwrap(), "case {}", case["name"]);
        }
    }
}
