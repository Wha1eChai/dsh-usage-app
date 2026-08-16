// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageHeaderAction, type UsageHeaderActionProps } from '../src/client/UsageHeaderAction.js'

function props(openUsage: UsageHeaderActionProps['openUsage']): UsageHeaderActionProps {
  return {
    sessionId: 'session-1',
    openUsage,
    t: key => key === 'header' ? 'Usage' : key === 'headerAria' ? 'Open Usage app' : key,
  } as UsageHeaderActionProps
}

describe('UsageHeaderAction', () => {
  afterEach(cleanup)

  it('deep-links into the Usage App without rendering the panel', () => {
    const openUsage = vi.fn()
    render(<UsageHeaderAction {...props(openUsage)} />)

    const button = screen.getByRole('button', { name: 'Open Usage app' })
    expect(button.textContent).toBe('Usage')
    expect(screen.queryByRole('list')).toBeNull()
    fireEvent.click(button)
    expect(openUsage).toHaveBeenCalledOnce()
  })
})
