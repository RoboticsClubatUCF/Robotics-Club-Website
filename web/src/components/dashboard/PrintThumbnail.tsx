import { useState } from 'react'
import { apiBaseUrl } from '../../lib/api/api'

/** The part on a queue card. A picture that won't load takes its space with it. */
export function PrintThumbnail({
  id,
  version,
  fileName,
}: {
  id: string
  version: number
  fileName: string
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  if (state === 'failed') return null

  return (
    <img
      src={`${apiBaseUrl}/api/officer/print/${id}/thumbnail?v=${version}`}
      alt={`Preview of ${fileName}`}
      width={256}
      height={256}
      loading="lazy"
      decoding="async"
      onLoad={() => {
        setState('ready')
      }}
      onError={() => {
        setState('failed')
      }}
      className={`border-rule size-24 shrink-0 border object-contain p-1 ${
        state === 'ready' ? 'bg-sink' : 'bg-hatch'
      }`}
    />
  )
}
