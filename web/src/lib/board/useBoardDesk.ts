import { useCallback, useEffect, useState } from 'react'
import { getJson } from '../api/api'
import type { ApiOfficerDesk } from '../api/api'

/**
 * Today's board, read once for both board sub-pages of the roles desk.
 *
 * Shared because both stay mounted: a seat set on OFFICER BOARD has to show on HANDOVER,
 * and a handover has to show on OFFICER BOARD, without either keeping its own stale copy.
 * `setDesk` takes the handover's answer, which is the new desk already.
 */
export function useBoardDesk() {
  const [desk, setDesk] = useState<ApiOfficerDesk | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    getJson<ApiOfficerDesk>('/officer/terms', controller.signal)
      .then((answer) => {
        setDesk(answer)
        setFailed(false)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })

    return () => {
      controller.abort()
    }
  }, [attempt])

  const reload = useCallback(() => {
    setAttempt((count) => count + 1)
  }, [])

  return { desk, failed, reload, setDesk }
}
