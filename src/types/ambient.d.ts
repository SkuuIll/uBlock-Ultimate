// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let vAPI: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let browser: any | undefined

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let uBlockDashboard: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let CodeMirrorEditor: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let diff_match_patch: any

interface Element {
  value: string
  checked: boolean
  style: CSSStyleDeclaration
  dataset: DOMStringMap
  options?: HTMLCollection
}

interface Event {
  button: number
  clipboardData: DataTransfer | null
  ctrlKey: boolean
  metaKey: boolean
}

interface EventTarget {
  closest(_selectors: string): Element | null
  value?: string
  checked?: boolean
}

interface Node {
  children: HTMLCollection
  classList: DOMTokenList
}

interface Document {
  caretPositionFromPoint(_x: number, _y: number): { offsetNode: Node; offset: number } | null
}