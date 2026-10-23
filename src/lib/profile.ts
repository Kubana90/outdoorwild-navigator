// Generates a BRouter routing profile (.brf) for a given activity and
// "wildness" level. The profile is uploaded to the BRouter server as a
// custom profile, so all tuning happens here in plain numbers.

export type Activity = 'mtb' | 'gravel' | 'hiking' | 'trailrun'

export interface ProfileOptions {
  activity: Activity
  /** 0 = gentle forest roads, 100 = as remote as possible */
  wildness: number
  /** MTB: highest allowed mtb:scale (0..6). Hiking: highest SAC level (1..6). */
  maxDifficulty: number
  /**
   * Baden-Württemberg forest law (LWaldG § 37): cycling only on ways wider
   * than 2 m. OSM rarely tags width, so narrow paths without an explicit
   * bicycle permission or signed bike route are avoided (not forbidden,
   * so the router can still connect through and the app warns).
   */
  twoMetreRule?: boolean
}

type Category =
  | 'majorRoad'
  | 'minorRoad'
  | 'cycleway'
  | 'trackPaved'
  | 'trackUnpaved'
  | 'trackRough'
  | 'path'
  | 'footway'
  | 'steps'

/** Cost factor per category at wildness 0 and at wildness 100. */
const COSTS: Record<Activity, Record<Category, [number, number]>> = {
  mtb: {
    majorRoad: [1.6, 12],
    minorRoad: [1.2, 5],
    cycleway: [1.0, 3.5],
    trackPaved: [1.1, 3],
    trackUnpaved: [1.3, 1.25],
    trackRough: [2.0, 1.1],
    path: [2.5, 1.0],
    footway: [4, 2.5],
    steps: [30, 30],
  },
  gravel: {
    majorRoad: [1.5, 10],
    minorRoad: [1.1, 4],
    cycleway: [1.0, 3],
    trackPaved: [1.0, 2.5],
    trackUnpaved: [1.2, 1.0],
    trackRough: [3, 2],
    path: [4, 2.5],
    footway: [6, 5],
    steps: [10000, 10000],
  },
  hiking: {
    majorRoad: [3, 15],
    minorRoad: [1.4, 5],
    cycleway: [1.5, 4],
    trackPaved: [1.2, 3],
    trackUnpaved: [1.1, 1.4],
    trackRough: [1.1, 1.1],
    path: [1.2, 1.0],
    footway: [1.2, 1.4],
    steps: [1.5, 1.5],
  },
  trailrun: {
    majorRoad: [3, 15],
    minorRoad: [1.3, 5],
    cycleway: [1.3, 4],
    trackPaved: [1.1, 3],
    trackUnpaved: [1.0, 1.3],
    trackRough: [1.2, 1.2],
    path: [1.1, 1.0],
    footway: [1.2, 1.4],
    steps: [2, 2],
  },
}

const MTB_SCALES = [['0-', '0', '0+'], ['1-', '1', '1+'], ['2-', '2', '2+'], ['3'], ['4'], ['5'], ['6']]
const SAC_SCALES = [
  'hiking',
  'mountain_hiking',
  'demanding_mountain_hiking',
  'alpine_hiking',
  'demanding_alpine_hiking',
  'difficult_alpine_hiking',
]

export const isBikeActivity = (a: Activity) => a === 'mtb' || a === 'gravel'

const num = (n: number) => (Math.round(n * 1000) / 1000).toString()

export function categoryCost(activity: Activity, category: Category, wildness: number): number {
  const [low, high] = COSTS[activity][category]
  const w = Math.min(1, Math.max(0, wildness / 100))
  return Math.max(1, low + (high - low) * w)
}

/** Tag values above the allowed difficulty, as a BRouter "a|b|c" list (or null). */
export function forbiddenDifficulty(activity: Activity, maxDifficulty: number): string | null {
  if (activity === 'mtb' || activity === 'gravel') {
    const max = activity === 'gravel' ? Math.min(maxDifficulty, 1) : maxDifficulty
    const above = MTB_SCALES.slice(max + 1).flat()
    return above.length ? `mtb:scale=${above.join('|')}` : null
  }
  const above = SAC_SCALES.slice(Math.max(1, maxDifficulty))
  return above.length ? `sac_scale=${above.join('|')}` : null
}

export function generateProfile(opts: ProfileOptions): string {
  const { activity, wildness } = opts
  const bike = isBikeActivity(activity)
  const w = Math.min(1, Math.max(0, wildness / 100))
  const c = (cat: Category) => num(categoryCost(activity, cat, wildness))
  const tooHard = forbiddenDifficulty(activity, opts.maxDifficulty) ?? 'false'

  const access = bike
    ? `assign accessok =
  if bicycle=no|private|dismount|use_sidepath then false
  else if vehicle=no|private then ( bicycle=yes|permissive|designated )
  else if access=private|no then ( bicycle=yes|permissive|designated )
  else true`
    : `assign accessok =
  if foot=no|private|use_sidepath then false
  else if access=private|no then ( foot=yes|permissive|designated )
  else true`

  const narrowRule =
    bike && opts.twoMetreRule
      ? `assign bikepermit = or bicycle=yes|designated|permissive|mtb
  or route_bicycle_icn=yes or route_bicycle_ncn=yes or route_bicycle_rcn=yes or route_bicycle_lcn=yes route_bicycle_=yes
assign narrowforbidden = and highway=path|footway|bridleway and not ispaved not bikepermit
assign waycost = if narrowforbidden then max basecost 40 else basecost`
      : 'assign waycost = basecost'

  const nodeAccess = bike
    ? `assign initialcost =
  if bicycle=no|private then 1000000
  else if ( and access=private|no not bicycle=yes|permissive|designated ) then 1000000
  else if or highway=traffic_signals and highway=crossing crossing=traffic_signals then 20
  else 0`
    : `assign initialcost =
  if foot=no|private then 1000000
  else if ( and access=private|no not foot=yes|permissive|designated ) then 1000000
  else 0`

  const elevation = bike
    ? `assign downhillcost = 60
assign downhillcutoff = 1.5
assign uphillcost = ${num(10 + 30 * w)}
assign uphillcutoff = 1.5
assign totalMass = 90
assign maxSpeed = 45
assign S_C_x = 0.225
assign C_r = ${activity === 'mtb' ? '0.02' : '0.012'}
assign bikerPower = 100`
    : `assign downhillcost = 7
assign downhillcutoff = 3
assign uphillcost = 7
assign uphillcutoff = 3`

  return `# OutdoorWild Navigator profile: ${activity}, wildness ${Math.round(wildness)}
---context:global
assign ${bike ? 'validForBikes' : 'validForFoot'} = true
assign turnInstructionMode = 1
assign turnInstructionCatchingRange = ${bike ? 40 : 20}
assign turnInstructionRoundabouts = true
assign considerTurnRestrictions = ${bike ? 'true' : 'false'}
assign processUnusedTags = true
${elevation}
assign forestweight = ${num(1.2 * w)}
assign townweight = ${num(1.8 * w)}

---context:way
${access}
assign ispaved = or surface=paved|asphalt|concrete|paving_stones|sett smoothness=excellent|good
assign isunpaved = surface=unpaved|compacted|fine_gravel|gravel|pebblestone|ground|dirt|earth|grass|mud|sand|rock|clay|grass_paver
assign toohard = ${tooHard}
assign no_forest_penalty =
  switch estimated_forest_class= 1
  switch estimated_forest_class=1 0.5
  switch estimated_forest_class=2 0.4
  switch estimated_forest_class=3 0.25
  switch estimated_forest_class=4 0.15
  switch estimated_forest_class=5 0.1 0
assign town_penalty =
  switch estimated_town_class= 0
  switch estimated_town_class=1 0.5
  switch estimated_town_class=2 0.9
  switch estimated_town_class=3 1.2
  switch estimated_town_class=4 1.3
  switch estimated_town_class=5 1.4 1.6
assign basecost =
  if highway=motorway|motorway_link|trunk|trunk_link then ${bike ? c('majorRoad') : 10000}
  else if highway=primary|primary_link|secondary|secondary_link|tertiary|tertiary_link then ${c('majorRoad')}
  else if highway=unclassified|residential|living_street|service|pedestrian then ${c('minorRoad')}
  else if highway=cycleway then ${c('cycleway')}
  else if highway=steps then ${c('steps')}
  else if highway=track then
  (
    if tracktype=grade1 then ${c('trackPaved')}
    else if tracktype=grade4|grade5 then ${c('trackRough')}
    else if ispaved then ${c('trackPaved')}
    else ${c('trackUnpaved')}
  )
  else if highway=path|bridleway then ( if ispaved then ${c('cycleway')} else ${c('path')} )
  else if highway=footway then ${c('footway')}
  else if highway=road then 2
  else 10000
${narrowRule}
assign costfactor =
  if ( and highway= not route=ferry ) then 10000
  else if route=ferry then 10000
  else if highway=proposed|abandoned|construction|platform then 10000
  else if not accessok then 10000
  else if toohard then 10000
  else if greater waycost 9999 then 10000
  else add waycost add multiply forestweight no_forest_penalty multiply townweight town_penalty
assign turncost = if junction=roundabout then 0 else ${bike ? 60 : 0}
assign initialcost = 0
assign priorityclassifier =
  if      ( highway=motorway                          ) then  30
  else if ( highway=motorway_link                     ) then  29
  else if ( highway=trunk                             ) then  28
  else if ( highway=trunk_link                        ) then  27
  else if ( highway=primary                           ) then  26
  else if ( highway=primary_link                      ) then  25
  else if ( highway=secondary                         ) then  24
  else if ( highway=secondary_link                    ) then  23
  else if ( highway=tertiary                          ) then  22
  else if ( highway=tertiary_link                     ) then  21
  else if ( highway=unclassified                      ) then  20
  else if ( highway=residential|living_street         ) then  6
  else if ( highway=service                           ) then  6
  else if ( highway=cycleway                          ) then  6
  else if ( highway=track                             ) then if tracktype=grade1 then 6 else 4
  else if ( highway=bridleway|road|path|footway       ) then  4
  else if ( highway=steps                             ) then  2
  else if ( highway=pedestrian                        ) then  2
  else 0
assign isroundabout = junction=roundabout
assign islinktype = highway=motorway_link|trunk_link|primary_link|secondary_link|tertiary_link
assign isgoodforcars = if greater priorityclassifier 6 then true
  else if highway=residential|living_street|service then true
  else if ( and highway=track tracktype=grade1 ) then true
  else false
assign classifiermask add multiply isroundabout 4
  add multiply islinktype 8
  multiply isgoodforcars 16

---context:node
${nodeAccess}
`
}
