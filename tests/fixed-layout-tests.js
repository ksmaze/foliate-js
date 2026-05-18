import assert from 'node:assert/strict'
import test from 'node:test'

const createStyleDeclaration = () => ({})

class FakeNode extends EventTarget {
    constructor(tagName = 'div') {
        super()
        this.tagName = tagName.toUpperCase()
        this.children = []
        this.parentNode = null
        this.style = createStyleDeclaration()
        this.attributes = new Map()
    }

    append(...children) {
        for (const child of children) this.appendChild(child)
    }

    appendChild(child) {
        this.children.push(child)
        child.parentNode = this
        return child
    }

    removeChild(child) {
        this.children = this.children.filter(item => item !== child)
        child.parentNode = null
        return child
    }

    replaceChildren(...children) {
        for (const child of this.children) child.parentNode = null
        this.children = []
        this.append(...children)
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value))
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null
    }

    getBoundingClientRect() {
        return { width: 400, height: 600 }
    }

    querySelectorAll(selector) {
        if (selector !== 'iframe') return []
        const results = []
        const walk = node => {
            if (node.tagName === 'IFRAME') results.push(node)
            for (const child of node.children ?? []) walk(child)
        }
        walk(this)
        return results
    }
}

class FakeHTMLElement extends FakeNode {
    attachShadow() {
        this.shadowRoot = new FakeNode('shadow-root')
        this.shadowRoot.adoptedStyleSheets = []
        return this.shadowRoot
    }
}

class FakeIframe extends FakeNode {
    constructor() {
        super('iframe')
        this.contentDocument = createDocument()
    }

    set src(value) {
        this._src = value
        queueMicrotask(() => this.dispatchEvent(new Event('load')))
    }

    get src() {
        return this._src
    }
}

const createDocument = () => {
    const doc = {
        documentElement: new FakeNode('html'),
        body: new FakeNode('body'),
        querySelector(selector) {
            if (selector === 'meta[name="viewport"]') {
                return { getAttribute: () => 'width=100 height=200' }
            }
            return null
        },
    }
    doc.defaultView = { document: doc }
    return doc
}

globalThis.HTMLElement = FakeHTMLElement
globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
}
globalThis.CSSStyleSheet = class {
    replaceSync() {}
}
globalThis.customElements = { define() {} }
globalThis.document = {
    createElement(tagName) {
        return tagName === 'iframe'
            ? new FakeIframe()
            : new FakeNode(tagName)
    },
}

const { FixedLayout } = await import('../fixed-layout.js')

const makeBook = length => ({
    dir: 'ltr',
    rendition: { layout: 'pre-paginated' },
    sections: Array.from({ length }, (_, index) => ({
        id: index,
        load: async () => `page-${index}.html`,
        size: 1000,
    })),
})

test('fixed layout exposes overlay-aware contents for loaded frames', async () => {
    const renderer = new FixedLayout()
    const attachedOverlayers = []

    renderer.addEventListener('create-overlayer', event => {
        const overlayer = {
            id: `overlayer-${event.detail.index}`,
            element: new FakeNode('svg'),
            redraw() {},
        }
        attachedOverlayers.push(overlayer)
        event.detail.attach(overlayer)
    })

    renderer.open(makeBook(2))
    await renderer.goTo({ index: 0 })

    const contents = renderer.getContents()
    assert.equal(attachedOverlayers.length, 1)
    assert.equal(contents.length, 1)
    assert.equal(contents[0].index, 0)
    assert.equal(contents[0].overlayer, attachedOverlayers[0])
    assert.ok(contents[0].doc)
})

test('fixed layout section jumps move between PDF pages', async () => {
    const renderer = new FixedLayout()
    const relocated = []
    renderer.addEventListener('relocate', event => {
        relocated.push(event.detail.index)
    })

    renderer.open(makeBook(3))
    await renderer.goTo({ index: 1 })
    assert.equal(renderer.index, 1)

    await renderer.nextSection()
    assert.equal(renderer.index, 2)
    assert.equal(relocated.at(-1), 2)

    await renderer.prevSection()
    assert.equal(renderer.index, 1)
    assert.equal(relocated.at(-1), 1)
})
