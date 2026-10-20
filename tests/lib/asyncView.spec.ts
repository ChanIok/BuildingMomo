import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineAsyncComponent } from 'vue'
import { defineAsyncView } from '@/lib/asyncView'

vi.mock('vue', () => ({ defineAsyncComponent: vi.fn(() => ({})) }))

function getOptions() {
  const options = vi.mocked(defineAsyncComponent).mock.calls[0]![0]
  if (typeof options === 'function') throw new Error('Expected async component options')
  return options
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('async view configuration', () => {
  it('delegates loading to Vue without adding a loading placeholder', () => {
    const loader = vi.fn().mockResolvedValue({})
    const notifyFailure = vi.fn()
    defineAsyncView(loader, notifyFailure)

    expect(defineAsyncComponent).toHaveBeenCalledOnce()
    expect(getOptions()).toEqual({ loader, onError: expect.any(Function) })
    expect(loader).not.toHaveBeenCalled()
    expect(notifyFailure).not.toHaveBeenCalled()
  })

  it("forwards Vue's retry callback to the notifier without automatically retrying", () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const notifyFailure = vi.fn()
    const retry = vi.fn()
    const fail = vi.fn()
    defineAsyncView(vi.fn().mockResolvedValue({}), notifyFailure)

    getOptions().onError!(new Error('chunk unavailable'), retry, fail, 1)
    expect(notifyFailure).toHaveBeenCalledExactlyOnceWith(retry)
    expect(retry).not.toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()

    notifyFailure.mock.calls[0]![0]()
    expect(retry).toHaveBeenCalledOnce()
  })
})
