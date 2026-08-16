// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { BalanceCard } from '../src/balances.js'
import { UsageAccountPane, type UsageAccountPaneProps } from '../src/client/UsageAccountPane.js'
import { en } from '../src/client/locales.js'
import { formatResetAt } from '../src/client/usage-view.js'
import type { SubscriptionCard } from '../src/subscriptions.js'

const t: UsageAccountPaneProps['t'] = key => en[key]

const RESET_AT = new Date(2026, 7, 23, 15, 0, 0).toISOString()

const DEEPSEEK: BalanceCard = {
  id: 'deepseek',
  displayName: 'DeepSeek',
  status: 'ok',
  remaining: 3,
  currency: 'CNY',
  granted: 10,
  toppedUp: 5,
  used: 12,
  limit: 20,
}

const ZAI_BALANCE: BalanceCard = { id: 'zai', displayName: 'Z.ai', status: 'ok' }

const GO: SubscriptionCard = {
  id: 'opencode-go',
  displayName: 'OpenCode Go',
  status: 'ok',
  plan: 'Go',
  windows: [
    { kind: 'session', usedPercent: 10, remainingPercent: 90 },
    { kind: 'weekly', usedPercent: 20, remainingPercent: 80, resetsAt: RESET_AT },
  ],
}

const ZAI_SUB: SubscriptionCard = {
  id: 'zai',
  displayName: 'Z.ai',
  status: 'ok',
  plan: 'GLM',
  windows: [
    { kind: 'monthly', usedPercent: 30, remainingPercent: 70 },
    { kind: 'billing', usedPercent: 50, remainingPercent: 50 },
  ],
}

afterEach(cleanup)

describe('UsageAccountPane', () => {
  it('shows one balance card and switches with displayName pills', () => {
    render(<UsageAccountPane balances={[DEEPSEEK, ZAI_BALANCE]} subscriptions={[]} t={t} />)
    expect(document.querySelectorAll('[data-provider]')).toHaveLength(1)
    expect(document.querySelector('[data-provider="deepseek"][data-status="ok"]')).toBeTruthy()
    expect(document.querySelector('[data-provider="zai"]')).toBeNull()
    expect(screen.getByText(/Remaining 3 CNY/)).toBeTruthy()
    expect(screen.getByText(/Granted 10/)).toBeTruthy()
    expect(screen.getByText(/Topped up 5/)).toBeTruthy()
    expect(screen.getByText(/Used 12/)).toBeTruthy()
    expect(screen.getByText(/Limit 20/)).toBeTruthy()
    fireEvent.click(screen.getByRole('group', { name: 'Provider balances' }).querySelector('button:nth-of-type(2)')!)
    expect(document.querySelectorAll('[data-provider]')).toHaveLength(1)
    expect(document.querySelector('[data-provider="zai"][data-status="ok"]')).toBeTruthy()
    expect(document.querySelector('[data-provider="deepseek"]')).toBeNull()
    expect(screen.queryByText(/Granted 10/)).toBeNull()
  })

  it('hides missing and unsupported cards and lets an error card be selected', () => {
    render(
      <UsageAccountPane
        balances={[
          DEEPSEEK,
          { id: 'openrouter', displayName: 'OpenRouter', status: 'missing', message: 'OPENROUTER_API_KEY' },
          { id: 'moonshot', displayName: 'Moonshot', status: 'error', message: 'down' },
          { id: 'kimi', displayName: 'Kimi', status: 'unsupported' },
        ]}
        subscriptions={[{ id: 'hidden', displayName: 'Hidden plan', status: 'missing', plan: 'Go', windows: [] }]}
        t={t}
      />,
    )
    expect(document.querySelector('[data-provider="openrouter"]')).toBeNull()
    expect(document.querySelector('[data-provider="kimi"]')).toBeNull()
    expect(screen.queryByText('OpenRouter')).toBeNull()
    expect(screen.queryByText('Kimi')).toBeNull()
    expect(screen.queryByText('Hidden plan')).toBeNull()
    expect(document.querySelector('[data-subscription]')).toBeNull()
    fireEvent.click(screen.getByText('Moonshot'))
    expect(document.querySelector('[data-provider="moonshot"][data-status="error"]')).toBeTruthy()
    expect(document.querySelector('[data-provider="deepseek"]')).toBeNull()
    expect(screen.getByText(/Lookup failed · down/)).toBeTruthy()
  })

  it('shows one subscription card and switches plans with pills', () => {
    render(<UsageAccountPane balances={[]} subscriptions={[GO, ZAI_SUB]} t={t} />)
    expect(document.querySelectorAll('[data-subscription]')).toHaveLength(1)
    expect(document.querySelector('[data-subscription="opencode-go"][data-status="ok"]')).toBeTruthy()
    expect(screen.getByText(/Session 10%/)).toBeTruthy()
    expect(screen.getByText(/Weekly 20%/)).toBeTruthy()
    expect(screen.getByText(new RegExp(formatResetAt(RESET_AT)))).toBeTruthy()
    expect(document.querySelector('[data-subscription="zai"]')).toBeNull()
    expect(screen.queryByText(/Monthly 30%/)).toBeNull()
    fireEvent.click(screen.getByRole('group', { name: 'Subscriptions' }).querySelector('button:nth-of-type(2)')!)
    expect(document.querySelectorAll('[data-subscription]')).toHaveLength(1)
    expect(document.querySelector('[data-subscription="zai"][data-status="ok"]')).toBeTruthy()
    expect(document.querySelector('[data-subscription="opencode-go"]')).toBeNull()
    expect(screen.getByText(/Monthly 30%/)).toBeTruthy()
    expect(screen.getByText(/Billing 50%/)).toBeTruthy()
    expect(screen.queryByText(/Weekly 20%/)).toBeNull()
  })

  it('renders nothing when inputs are empty or all hidden', () => {
    const empty = render(<UsageAccountPane balances={[]} subscriptions={[]} t={t} />)
    expect(empty.container.firstChild).toBeNull()
    empty.unmount()
    const hidden = render(
      <UsageAccountPane
        balances={[
          { id: 'openrouter', displayName: 'OpenRouter', status: 'missing' },
          { id: 'kimi', displayName: 'Kimi', status: 'unsupported' },
        ]}
        subscriptions={[{ id: 'opencode-go', displayName: 'OpenCode Go', status: 'missing', plan: 'Go', windows: [] }]}
        t={t}
      />,
    )
    expect(hidden.container.firstChild).toBeNull()
  })

  it('falls back to the first remaining card when the selected id disappears', () => {
    const view = render(<UsageAccountPane balances={[DEEPSEEK, ZAI_BALANCE]} subscriptions={[GO, ZAI_SUB]} t={t} />)
    fireEvent.click(screen.getByRole('group', { name: 'Provider balances' }).querySelector('button:nth-of-type(2)')!)
    fireEvent.click(screen.getByRole('group', { name: 'Subscriptions' }).querySelector('button:nth-of-type(2)')!)
    expect(document.querySelector('[data-provider="zai"]')).toBeTruthy()
    expect(document.querySelector('[data-subscription="zai"]')).toBeTruthy()
    view.rerender(<UsageAccountPane balances={[DEEPSEEK]} subscriptions={[GO]} t={t} />)
    expect(document.querySelector('[data-provider="deepseek"]')).toBeTruthy()
    expect(document.querySelector('[data-provider="zai"]')).toBeNull()
    expect(document.querySelector('[data-subscription="opencode-go"]')).toBeTruthy()
    expect(document.querySelector('[data-subscription="zai"]')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Provider balances' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Subscriptions' })).toBeNull()
  })
})
