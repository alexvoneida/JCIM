import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)

// jsdom lacks the browser APIs the find bar uses. Main-process tests run without a DOM.
if (typeof Element !== 'undefined') {
  Element.prototype.checkVisibility = () => true
  Element.prototype.scrollIntoView = () => {}
  globalThis.Highlight = class {} as unknown as typeof Highlight
  Object.defineProperty(CSS, 'highlights', { value: new Map() })
}
