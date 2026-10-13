import add from '../../assets/orca/toolbar_open.svg'
import arrange from '../../assets/orca/toolbar_arrange.svg'
import orient from '../../assets/orca/toolbar_orient.svg'
import copy from '../../assets/orca/instance_add.svg'
import remove from '../../assets/orca/instance_remove.svg'
import move from '../../assets/orca/toolbar_move.svg'
import rotate from '../../assets/orca/toolbar_rotate.svg'
import scale from '../../assets/orca/toolbar_scale.svg'
import flat from '../../assets/orca/toolbar_flatten.svg'
import home from '../../assets/orca/monitor_axis_home_icon.svg'
import reset from '../../assets/orca/toolbar_reset.svg'
import locked from '../../assets/orca/lock_closed.svg'
import unlocked from '../../assets/orca/lock_open.svg'

const ICONS = { add, arrange, orient, copy, remove, move, rotate, scale, flat, home, reset, locked, unlocked }

/** Original Orca artwork, tinted by the control's theme color rather than Orca's palette. */
export function OrcaIcon({ name, className = 'size-7' }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{ maskImage: `url("${ICONS[name]}")`, maskMode: 'alpha', maskSize: 'contain', maskPosition: 'center', maskRepeat: 'no-repeat' }}
    />
  )
}
