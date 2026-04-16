export type BodyPartType =
  | 'move'
  | 'work'
  | 'carry'
  | 'attack'
  | 'ranged_attack'
  | 'heal'
  | 'claim'
  | 'tough'

export type BodyPartInfo = {
  cost: number
  color: string
  label: string
  shortLabel: string
}

export const BODY_PARTS: Record<BodyPartType, BodyPartInfo> = {
  move: { cost: 50, color: '#aab7c5', label: 'Move', shortLabel: 'MV' },
  work: { cost: 100, color: '#fde574', label: 'Work', shortLabel: 'WK' },
  carry: { cost: 50, color: '#777777', label: 'Energy', shortLabel: 'EN' },
  attack: { cost: 80, color: '#f72e41', label: 'Attack', shortLabel: 'AT' },
  ranged_attack: { cost: 150, color: '#7fa7e5', label: 'Ranged Attack', shortLabel: 'RA' },
  heal: { cost: 250, color: '#56cf5e', label: 'Heal', shortLabel: 'HL' },
  claim: { cost: 600, color: '#b99cfb', label: 'Claim', shortLabel: 'CL' },
  tough: { cost: 10, color: '#c7c7c7', label: 'Tough', shortLabel: 'TG' },
}

export const BODY_PART_ORDER: BodyPartType[] = [
  'work',
  'carry',
  'attack',
  'ranged_attack',
  'heal',
  'claim',
  'tough',
  'move',
]

export function countBodyParts(parts: Array<string | { type: string }> | undefined): Record<BodyPartType, number> {
  const counts = {
    move: 0,
    work: 0,
    carry: 0,
    attack: 0,
    ranged_attack: 0,
    heal: 0,
    claim: 0,
    tough: 0,
  } satisfies Record<BodyPartType, number>

  for (const part of parts ?? []) {
    const type = typeof part === 'string' ? part : part.type
    if (type in counts) counts[type as BodyPartType] += 1
  }

  return counts
}
