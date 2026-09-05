import type { RailSegment } from './layout-commits.js'

/** One colour per lane, cycling; token colours so the graph survives the theme. */
export const LANE_COLORS = [
  'var(--status-active)',
  'var(--status-done)',
  'var(--status-attention)',
  'var(--status-idle)',
] as const

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length] as string
}

export const ROW_HEIGHT = 36
export const LANE_WIDTH = 22

const x = (lane: number) => LANE_WIDTH / 2 + lane * LANE_WIDTH

/**
 * One row's slice of the commit graph, as its own `<svg>` so it stays aligned
 * with a row whose height the browser decides (ref chips can wrap).
 *
 * The top half draws the previous row's segments arriving; the bottom half
 * draws this row's segments leaving. A diagonal is split at the row boundary,
 * at the midpoint between its two lanes, so each half is self-contained. The
 * commit's own lane gets a dot, and its straight segment below is drawn only
 * when the layout says the lane `continues` — a root, or a commit whose first
 * parent another lane was already waiting for, ends here. Replaces a
 * monospace rail of `●│×` glyphs — the thing "no git tree" meant.
 */
export function RowGutter({
  lane,
  lanes,
  rails,
  prevRails,
  continues,
}: {
  lane: number
  lanes: number
  rails: RailSegment[]
  prevRails: RailSegment[]
  continues: boolean
}) {
  const w = lanes * LANE_WIDTH
  const h = ROW_HEIGHT
  const mid = h / 2
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      data-lane={lane}
      data-rails={rails.map((r) => `${r.from}-${r.to}`).join(',')}
      data-continues={continues}
      className="shrink-0"
    >
      {prevRails.map((r) =>
        r.from === r.to ? (
          <line
            key={`in-${r.from}`}
            x1={x(r.to)}
            y1={0}
            x2={x(r.to)}
            y2={mid}
            stroke={laneColor(r.to)}
            strokeWidth={2}
          />
        ) : (
          <path
            key={`in-${r.from}-${r.to}`}
            d={`M${x((r.from + r.to) / 2)} 0 C ${x((r.from + r.to) / 2)} ${mid * 0.6}, ${x(r.to)} ${mid * 0.4}, ${x(r.to)} ${mid}`}
            fill="none"
            stroke={laneColor(Math.max(r.from, r.to))}
            strokeWidth={2}
          />
        ),
      )}
      {rails.map((r) => {
        if (r.from === r.to) {
          if (r.from === lane && !continues) return null
          return (
            <line
              key={`out-${r.from}`}
              x1={x(r.from)}
              y1={mid}
              x2={x(r.from)}
              y2={h}
              stroke={laneColor(r.from)}
              strokeWidth={2}
            />
          )
        }
        return (
          <path
            key={`out-${r.from}-${r.to}`}
            d={`M${x(r.from)} ${mid} C ${x(r.from)} ${mid + mid * 0.6}, ${x((r.from + r.to) / 2)} ${h - mid * 0.4}, ${x((r.from + r.to) / 2)} ${h}`}
            fill="none"
            stroke={laneColor(Math.max(r.from, r.to))}
            strokeWidth={2}
          />
        )
      })}
      <circle
        cx={x(lane)}
        cy={mid}
        r={5}
        fill="var(--card)"
        stroke={laneColor(lane)}
        strokeWidth={2.5}
      />
    </svg>
  )
}
