import { useState } from 'react'

type CraftTab = 'labs' | 'factory'

// ── Mineral colors ────────────────────────────────────────
const MINERAL_COLOR: Record<string, string> = {
  H: '#7ed6df', O: '#dfe6e9', U: '#4bcffa', L: '#78e08f',
  K: '#f8a5c2', Z: '#f9ca24', X: '#ff5e57', G: '#c3c3c3',
  OH: '#b8d0d5',
}

function mineralColor(r: string): string {
  const base = r.replace(/^X/, '').replace(/2?O2?|2?H2?/, '')[0]
  if (r in MINERAL_COLOR) return MINERAL_COLOR[r]
  if (base && base in MINERAL_COLOR) return MINERAL_COLOR[base]
  return '#888'
}

function MChip({ r }: { r: string }) {
  return (
    <span className="craft-chip" style={{ borderColor: mineralColor(r), color: mineralColor(r) }}>
      {r}
    </span>
  )
}

// ── Lab reaction chains ───────────────────────────────────
type BoostRow = {
  category: string
  part: string
  effect: string
  rows: { compound: string; ingredients: string[]; mult: string; tier: number }[]
}

const BOOST_CHAINS: BoostRow[] = [
  {
    category: 'Harvest', part: 'work', effect: 'harvest speed',
    rows: [
      { tier: 1, compound: 'UO',    ingredients: ['U', 'O'],       mult: '×3' },
      { tier: 2, compound: 'UHO2',  ingredients: ['UO', 'OH'],     mult: '×5' },
      { tier: 3, compound: 'XUHO2', ingredients: ['UHO2', 'X'],    mult: '×7' },
    ],
  },
  {
    category: 'Build/Repair', part: 'work', effect: 'build & repair speed',
    rows: [
      { tier: 1, compound: 'LH',    ingredients: ['L', 'H'],       mult: '×1.5' },
      { tier: 2, compound: 'LH2O',  ingredients: ['LH', 'OH'],     mult: '×1.8' },
      { tier: 3, compound: 'XLH2O', ingredients: ['LH2O', 'X'],   mult: '×2' },
    ],
  },
  {
    category: 'Dismantle', part: 'work', effect: 'dismantle dmg',
    rows: [
      { tier: 1, compound: 'ZH',    ingredients: ['Z', 'H'],       mult: '×2' },
      { tier: 2, compound: 'ZH2O',  ingredients: ['ZH', 'OH'],     mult: '×3' },
      { tier: 3, compound: 'XZH2O', ingredients: ['ZH2O', 'X'],   mult: '×4' },
    ],
  },
  {
    category: 'Upgrade', part: 'work', effect: 'upgradeController speed',
    rows: [
      { tier: 1, compound: 'GH',    ingredients: ['G', 'H'],       mult: '×1.5' },
      { tier: 2, compound: 'GH2O',  ingredients: ['GH', 'OH'],     mult: '×1.8' },
      { tier: 3, compound: 'XGH2O', ingredients: ['GH2O', 'X'],   mult: '×2' },
    ],
  },
  {
    category: 'Attack', part: 'attack', effect: 'attack dmg',
    rows: [
      { tier: 1, compound: 'UH',    ingredients: ['U', 'H'],       mult: '×2' },
      { tier: 2, compound: 'UH2O',  ingredients: ['UH', 'OH'],     mult: '×3' },
      { tier: 3, compound: 'XUH2O', ingredients: ['UH2O', 'X'],   mult: '×4' },
    ],
  },
  {
    category: 'Ranged', part: 'ranged_attack', effect: 'rangedAttack & rangedMassAttack',
    rows: [
      { tier: 1, compound: 'KO',    ingredients: ['K', 'O'],       mult: '×2' },
      { tier: 2, compound: 'KHO2',  ingredients: ['KO', 'OH'],     mult: '×3' },
      { tier: 3, compound: 'XKHO2', ingredients: ['KHO2', 'X'],   mult: '×4' },
    ],
  },
  {
    category: 'Heal', part: 'heal', effect: 'heal & rangedHeal',
    rows: [
      { tier: 1, compound: 'LO',    ingredients: ['L', 'O'],       mult: '×2' },
      { tier: 2, compound: 'LHO2',  ingredients: ['LO', 'OH'],     mult: '×3' },
      { tier: 3, compound: 'XLHO2', ingredients: ['LHO2', 'X'],   mult: '×4' },
    ],
  },
  {
    category: 'Carry', part: 'carry', effect: 'carry capacity',
    rows: [
      { tier: 1, compound: 'KH',    ingredients: ['K', 'H'],       mult: '×2' },
      { tier: 2, compound: 'KH2O',  ingredients: ['KH', 'OH'],     mult: '×3' },
      { tier: 3, compound: 'XKH2O', ingredients: ['KH2O', 'X'],   mult: '×4' },
    ],
  },
  {
    category: 'Move', part: 'move', effect: 'fatigue ÷',
    rows: [
      { tier: 1, compound: 'ZO',    ingredients: ['Z', 'O'],       mult: '×2' },
      { tier: 2, compound: 'ZHO2',  ingredients: ['ZO', 'OH'],     mult: '×3' },
      { tier: 3, compound: 'XZHO2', ingredients: ['ZHO2', 'X'],   mult: '×4' },
    ],
  },
  {
    category: 'Tough', part: 'tough', effect: 'dmg multiplier',
    rows: [
      { tier: 1, compound: 'GO',    ingredients: ['G', 'O'],       mult: '×0.7' },
      { tier: 2, compound: 'GHO2',  ingredients: ['GO', 'OH'],     mult: '×0.5' },
      { tier: 3, compound: 'XGHO2', ingredients: ['GHO2', 'X'],   mult: '×0.3' },
    ],
  },
]

// ── Factory commodities ───────────────────────────────────
type CommodityEntry = {
  output: string
  amount: number
  cooldown: number
  level?: number
  components: { resource: string; amount: number }[]
}

const FACTORY_RECIPES: CommodityEntry[] = [
  // Compress
  { output: 'utrium_bar', amount: 100, cooldown: 20, components: [{ resource: 'U', amount: 500 }, { resource: 'energy', amount: 200 }] },
  { output: 'lemergium_bar', amount: 100, cooldown: 20, components: [{ resource: 'L', amount: 500 }, { resource: 'energy', amount: 200 }] },
  { output: 'zynthium_bar', amount: 100, cooldown: 20, components: [{ resource: 'Z', amount: 500 }, { resource: 'energy', amount: 200 }] },
  { output: 'keanium_bar', amount: 100, cooldown: 20, components: [{ resource: 'K', amount: 500 }, { resource: 'energy', amount: 200 }] },
  { output: 'ghodium_melt', amount: 100, cooldown: 20, components: [{ resource: 'G', amount: 500 }, { resource: 'energy', amount: 200 }] },
  { output: 'oxidant', amount: 100, cooldown: 20, components: [{ resource: 'O', amount: 500 }, { resource: 'energy', amount: 200 }] },
  { output: 'reductant', amount: 100, cooldown: 20, components: [{ resource: 'H', amount: 500 }, { resource: 'energy', amount: 200 }] },
  { output: 'purifier', amount: 100, cooldown: 20, components: [{ resource: 'X', amount: 500 }, { resource: 'energy', amount: 200 }] },
  { output: 'battery', amount: 50, cooldown: 10, components: [{ resource: 'energy', amount: 600 }] },
  // Tier 0 intermediates
  { output: 'composite', level: 1, amount: 20, cooldown: 50, components: [{ resource: 'utrium_bar', amount: 20 }, { resource: 'zynthium_bar', amount: 20 }, { resource: 'energy', amount: 20 }] },
  { output: 'crystal', level: 2, amount: 6, cooldown: 21, components: [{ resource: 'lemergium_bar', amount: 6 }, { resource: 'keanium_bar', amount: 6 }, { resource: 'purifier', amount: 6 }, { resource: 'energy', amount: 45 }] },
  { output: 'liquid', level: 3, amount: 12, cooldown: 60, components: [{ resource: 'oxidant', amount: 12 }, { resource: 'reductant', amount: 12 }, { resource: 'ghodium_melt', amount: 12 }, { resource: 'energy', amount: 90 }] },
  // Electronics
  { output: 'wire', amount: 20, cooldown: 8, components: [{ resource: 'utrium_bar', amount: 20 }, { resource: 'silicon', amount: 100 }, { resource: 'energy', amount: 40 }] },
  { output: 'switch', level: 1, amount: 5, cooldown: 70, components: [{ resource: 'wire', amount: 40 }, { resource: 'oxidant', amount: 95 }, { resource: 'utrium_bar', amount: 35 }, { resource: 'energy', amount: 20 }] },
  { output: 'transistor', level: 2, amount: 1, cooldown: 59, components: [{ resource: 'switch', amount: 4 }, { resource: 'wire', amount: 15 }, { resource: 'reductant', amount: 85 }, { resource: 'energy', amount: 8 }] },
  // Biomass
  { output: 'biomass', amount: 40, cooldown: 8, components: [{ resource: 'mist', amount: 100 }, { resource: 'energy', amount: 25 }] },
  { output: 'cell', level: 1, amount: 2, cooldown: 80, components: [{ resource: 'biomass', amount: 20 }, { resource: 'oxidant', amount: 36 }, { resource: 'lemergium_bar', amount: 16 }, { resource: 'energy', amount: 8 }] },
  // Metals
  { output: 'alloy', amount: 40, cooldown: 8, components: [{ resource: 'zynthium_bar', amount: 20 }, { resource: 'metal', amount: 100 }, { resource: 'energy', amount: 40 }] },
  { output: 'condensate', level: 1, amount: 4, cooldown: 110, components: [{ resource: 'keanium_bar', amount: 15 }, { resource: 'reductant', amount: 54 }, { resource: 'alloy', amount: 12 }, { resource: 'energy', amount: 14 }] },
  // Spore
  { output: 'phlegm', amount: 100, cooldown: 8, components: [{ resource: 'lemergium_bar', amount: 20 }, { resource: 'mist', amount: 100 }, { resource: 'energy', amount: 30 }] },
  { output: 'tissue', level: 1, amount: 2, cooldown: 164, components: [{ resource: 'phlegm', amount: 10 }, { resource: 'oxidant', amount: 10 }, { resource: 'lemergium_bar', amount: 2 }, { resource: 'energy', amount: 12 }] },
]

const COMMODITY_COLOR: Record<string, string> = {
  composite: '#7fb3f0', crystal: '#f8a5c2', liquid: '#4bcffa',
  wire: '#c3c3c3', switch: '#ffe56d', transistor: '#ff8800',
  biomass: '#78e08f', cell: '#55cc55', alloy: '#aaaaaa',
  condensate: '#88aaff', phlegm: '#ccbb77', tissue: '#dd9988',
  utrium_bar: '#4bcffa', lemergium_bar: '#78e08f', zynthium_bar: '#f9ca24',
  keanium_bar: '#f8a5c2', ghodium_melt: '#c3c3c3',
  oxidant: '#dfe6e9', reductant: '#7ed6df', purifier: '#ff5e57',
  battery: '#ffe56d',
}

function resColor(r: string) {
  if (r in MINERAL_COLOR) return MINERAL_COLOR[r]
  if (r in COMMODITY_COLOR) return COMMODITY_COLOR[r]
  if (r === 'energy') return '#ffe56d'
  return '#888'
}

function ResChip({ r, amt }: { r: string; amt?: number }) {
  return (
    <span className="craft-chip" style={{ borderColor: resColor(r), color: resColor(r) }}>
      {amt != null ? `${amt}` : ''}{amt != null ? ' ' : ''}{r.replace(/_/g, ' ')}
    </span>
  )
}

// ── Component ─────────────────────────────────────────────

export default function CraftPane() {
  const [tab, setTab] = useState<CraftTab>('labs')
  const [filter, setFilter] = useState('')

  const f = filter.toLowerCase()
  const filteredBoosts = f
    ? BOOST_CHAINS.filter((c) => c.category.toLowerCase().includes(f) || c.effect.toLowerCase().includes(f) || c.rows.some((r) => r.compound.toLowerCase().includes(f)))
    : BOOST_CHAINS

  const filteredFactory = f
    ? FACTORY_RECIPES.filter((r) => r.output.toLowerCase().includes(f) || r.components.some((c) => c.resource.toLowerCase().includes(f)))
    : FACTORY_RECIPES

  return (
    <div className="dock-pane craft-pane">
      <div className="pane-header">
        <span className="panel-title">Craft Reference</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`btn-ghost compact ${tab === 'labs' ? 'tab-active' : ''}`} onClick={() => setTab('labs')}>Labs</button>
          <button className={`btn-ghost compact ${tab === 'factory' ? 'tab-active' : ''}`} onClick={() => setTab('factory')}>Factory</button>
        </div>
      </div>

      <div className="mem-toolbar">
        <input
          className="mem-path-input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          style={{ color: 'var(--text-main)' }}
        />
      </div>

      <div className="pane-scroll craft-scroll">
        {tab === 'labs' && (
          <>
            <div className="craft-note">OH = O + H &nbsp;·&nbsp; G = ZK + UL (ZK = Z+K, UL = U+L)</div>
            {filteredBoosts.map((chain) => (
              <div key={chain.category} className="craft-group">
                <div className="craft-group-header">
                  <span className="craft-category">{chain.category}</span>
                  <span className="craft-part muted">{chain.part}</span>
                  <span className="craft-effect muted">{chain.effect}</span>
                </div>
                <div className="craft-rows">
                  {chain.rows.map((row) => (
                    <div key={row.compound} className="craft-row">
                      <span className="craft-tier muted">T{row.tier}</span>
                      <MChip r={row.compound} />
                      <span className="craft-eq muted">=</span>
                      {row.ingredients.map((ing, i) => (
                        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <MChip r={ing} />
                          {i < row.ingredients.length - 1 && <span className="craft-eq muted">+</span>}
                        </span>
                      ))}
                      <span className="craft-mult" style={{ color: mineralColor(row.compound) }}>{row.mult}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {tab === 'factory' && (
          <>
            <div className="craft-note">Factory converts resources into commodities. Level = min factory level required.</div>
            {filteredFactory.map((recipe) => (
              <div key={recipe.output} className="craft-group">
                <div className="craft-factory-row">
                  <ResChip r={recipe.output} />
                  <span className="muted" style={{ fontSize: '0.7rem' }}>×{recipe.amount}</span>
                  {recipe.level != null && (
                    <span className="craft-level">L{recipe.level}</span>
                  )}
                  <span className="craft-cooldown muted">⏱ {recipe.cooldown}t</span>
                  <span className="craft-eq muted">=</span>
                  <div className="craft-ingredients">
                    {recipe.components.map((c, i) => (
                      <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <ResChip r={c.resource} amt={c.amount} />
                        {i < recipe.components.length - 1 && <span className="craft-eq muted">+</span>}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
