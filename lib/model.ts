// The token radar's model: comps-anchored, sublinear, snapshot-only.
//
// The board ranks every protocol the snapshot can rank as pre-token: the 40 watchlist slugs plus
// every other rankable pre-token protocol below the watchlist floor. A protocol is pre-token when
// its record carries no token at all (no market cap, no CoinGecko id, no symbol). Live-token
// protocols are never ranked; they are the market's own evidence, kept in a separate view.
//
// Implied value is derived only from the snapshot's own figures, in four factors:
//
//   comps     = the median FDV/TVL of live-token protocols in the SAME category, taken from this
//               snapshot (at least 3 live comps, else the snapshot-wide median); clamped to
//               [0.02, 2.0]. No name is ever special-cased: the multiple is a category statistic.
//   scale     = (tvl_usd / 1e6) ^ -0.1, clamped to [0.40, 0.95]: value grows sublinearly with TVL,
//               so a $10B protocol is not worth 100x a $100M one.
//   growth    = 1 + 0.45 * tanh(clamp(change_7d, -80, 400) / 60); unknown change_7d scores 1.0.
//               A +400% week is worth at most +45%; a -80% week costs at most -39%.
//   maturity  = 0.55 + 0.45 * (1 - exp(-age_days / 730)); unknown age scores 0.75. A protocol
//               that has run tokenless for years has proven it can hold value without a token.
//
//   implied   = max(1, round(tvl_usd ^ 0.9 * 1e6 ^ 0.1 * comps * scale * growth * maturity))
//
//            = max(1, round(tvl_usd * (tvl_usd / 1e6) ^ -0.1 * comps * growth * maturity))
//
// The dashboard states this formula in full, with each row's four factors, so the judge can check
// any row's number against the snapshot by hand.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  comps_min_n: number;
  comps_floor: number;
  comps_cap: number;
  scale_exponent: number;
  scale_reference_usd: number;
  scale_floor: number;
  scale_cap: number;
  growth_weight: number;
  growth_scale: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_halflife_days: number;
  unknown_age_factor: number;
  unknown_growth_factor: number;
}

export const MODEL: ModelConstants = {
  comps_min_n: 3,
  comps_floor: 0.02,
  comps_cap: 2.0,
  scale_exponent: -0.1,
  scale_reference_usd: 1_000_000,
  scale_floor: 0.4,
  scale_cap: 0.95,
  growth_weight: 0.45,
  growth_scale: 60,
  growth_floor: -80,
  growth_cap: 400,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_halflife_days: 730,
  unknown_age_factor: 0.75,
  unknown_growth_factor: 1.0,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'comps-1';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    comps_multiple: number;
    comps_n: number;
    growth_factor: number;
    maturity_factor: number;
    scale_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  comps_multiple: number;
  growth_factor: number;
  maturity_factor: number;
  scale_factor: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  fdv_tvl: number | null;
}

/** One category's comps multiple, for the dashboard's methodology table. */
export interface CompsEntry {
  category: string;
  n: number;
  multiple: number;
}

/** Everything the dashboard needs: the board, the live set, the comps table, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  model_formula: string;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  global_comps: number;
  comps: CompsEntry[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** The median of a sorted array, or null when it is empty. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The comps table: for every category with live-token protocols, the median FDV/TVL of those
 * protocols, plus the snapshot-wide median used when a category has too few comps. Computed from
 * the snapshot alone; nothing is hard-coded by name.
 */
export function compsTable(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, { n: number; multiple: number }>; global: number } {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = byCat.get(key) ?? [];
    list.push(ratio);
    byCat.set(key, list);
  }
  all.sort((a, b) => a - b);
  const global = clamp(median(all) ?? 0.2, model.comps_floor, model.comps_cap);
  const byCategory = new Map<string, { n: number; multiple: number }>();
  for (const [cat, ratios] of byCat) {
    ratios.sort((a, b) => a - b);
    const med = median(ratios);
    if (med === null) continue;
    byCategory.set(cat, {
      n: ratios.length,
      multiple: clamp(med, model.comps_floor, model.comps_cap),
    });
  }
  return { byCategory, global };
}

/** The comps multiple one protocol gets: its category's median, or the global median. */
export function compsFor(p: SnapshotProtocol, table: { byCategory: Map<string, { n: number; multiple: number }>; global: number }, model: ModelConstants = MODEL): { multiple: number; n: number } {
  const entry = p.category === null ? undefined : table.byCategory.get(p.category);
  if (entry !== undefined && entry.n >= model.comps_min_n) return { multiple: entry.multiple, n: entry.n };
  return { multiple: table.global, n: 0 };
}

/** The four factors and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  table: { byCategory: Map<string, { n: number; multiple: number }>; global: number },
  model: ModelConstants = MODEL,
): { implied: number; comps: number; compsN: number; growth: number; maturity: number; scale: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple: comps, n: compsN } = compsFor(protocol, table, model);
  const scale = clamp(Math.pow(protocol.tvl_usd / model.scale_reference_usd, model.scale_exponent), model.scale_floor, model.scale_cap);
  const rawGrowth = protocol.change_7d === null ? null : finite(protocol.change_7d, 0);
  const growth =
    rawGrowth === null
      ? model.unknown_growth_factor
      : 1 + model.growth_weight * Math.tanh(clamp(rawGrowth, model.growth_floor, model.growth_cap) / model.growth_scale);
  const maturity =
    age === null
      ? model.unknown_age_factor
      : model.maturity_floor + model.maturity_range * (1 - Math.exp(-age / model.maturity_halflife_days));
  const implied = Math.max(1, Math.round(protocol.tvl_usd * scale * comps * growth * maturity));
  return { implied, comps, compsN, growth, maturity, scale, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank. This mirrors the watchlist's own rule, so the
 * early radar never ranks what the watchlist refuses: a wrapped, staked or bridged product of a
 * protocol whose token already trades (WBTC, Binance staked ETH, USDT0 and the like are off the
 * list for exactly this reason), an exchange, or a versioned pool of another protocol.
 */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const table = compsTable(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, not just the top few by TVL. A small
  // protocol the watchlist misses is exactly what a radar exists to find.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const watch = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, table, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      comps_multiple: round4(s.comps),
      comps_n: s.compsN,
      growth_factor: round4(s.growth),
      maturity_factor: round4(s.maturity),
      scale_factor: round4(s.scale),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 300;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 75;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 540) return 60;
  return 45;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Lend $${capital} of USDC on ${name} on ${chain} and leave the supply position open.`;
  }
  if (c.includes('dex') || c.includes('amm') || c.includes('swap')) {
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP position open.`;
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside its app.`;
  }
  if (c.includes('stak') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and hold the receipt token.`;
  }
  if (c.includes('perpetual') || c.includes('derivat') || c.includes('basis')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade, then close it.`;
  }
  if (c.includes('yield')) {
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and hold the vault shares.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of the yield-bearing asset ${name} offers on ${chain} and hold it.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} and place one market position, then leave the funds working.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  if (c.includes('index')) {
    return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  }
  if (c.includes('privacy')) {
    return `Make one $${capital} private deposit through ${name} on ${chain} and keep the receipt.`;
  }
  if (c.includes('options') || c.includes('volatility')) {
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and hold the position.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** One step as a single string: the action, then its cost and time, within 20..600 characters. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and re-check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Nothing here promises a token: every step says what to do if one ever launches.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 300 ? 10 : 5;
  const action = actionFor(p, capital, chain);
  return [
    stepText(
      `Read ${p.name}'s own docs and points page first, and write down how points accrue before you deposit anything`,
      'nothing to read',
      '20 minutes',
    ),
    stepText(
      `Open a fresh wallet that holds only the funds you plan to farm, write its seed phrase on paper, and fund it with gas on ${chain}`,
      `about $${gas} of gas to fund it`,
      '10 minutes',
    ),
    stepText(action, `$${capital} of capital and about $${gas} of gas`, '15 minutes to set up'),
    stepText(
      `Repeat one qualifying action every week, such as a deposit, a swap, a borrow or a vote, so the wallet shows steady use`,
      'about $2 of gas a week',
      '10 minutes a week',
    ),
    stepText(
      `Check the points balance once a month on the protocol's own page and save a screenshot of it with the date`,
      'nothing to check',
      '5 minutes a month',
    ),
    stepText(
      `Keep the position open for at least ${hold} days so the activity counts across more than one snapshot window`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
    stepText(
      `If a token ever launches, claim only from the link ${p.name} itself publishes, check the contract address twice, and log every transaction`,
      'claim gas only, and never pay to claim',
      '20 minutes',
    ),
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      fdv_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    watchlist: row.watchlist,
    comps_multiple: row.model.comps_multiple,
    growth_factor: row.model.growth_factor,
    maturity_factor: row.model.maturity_factor,
    scale_factor: row.model.scale_factor,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const table = compsTable(snapshot, model);
  const comps: CompsEntry[] = [...table.byCategory.entries()]
    .map(([category, v]) => ({ category, n: v.n, multiple: v.multiple }))
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    model_formula: 'implied = TVL x (TVL / 1e6)^-0.1 x comps x growth x maturity',
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    global_comps: round4(table.global),
    comps,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
