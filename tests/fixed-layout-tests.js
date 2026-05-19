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

const delayedIframeLoads = new Map()
const createdIframes = []

class FakeIframe extends FakeNode {
    constructor() {
        super('iframe')
        this.contentDocument = createDocument()
        this.srcAssignments = []
        createdIframes.push(this)
    }

    set src(value) {
        this.srcAssignments.push(value)
        this._src = value
        const delayedLoad = delayedIframeLoads.get(value)
        if (delayedLoad) {
            delayedLoad.then(() => this.dispatchEvent(new Event('load')))
            return
        }
        queueMicrotask(() => this.dispatchEvent(new Event('load')))
    }

    get src() {
        return this._src
    }

    set srcdoc(value) {
        this._srcdoc = value
        queueMicrotask(() => this.dispatchEvent(new Event('load')))
    }

    get srcdoc() {
        return this._srcdoc
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

const makeAsyncRenderBook = onZoom => ({
    dir: 'ltr',
    rendition: { layout: 'pre-paginated' },
    sections: [{
        id: 0,
        load: async () => ({
            src: 'page-0.html',
            onZoom,
        }),
        size: 1000,
    }],
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

test('fixed layout waits for async page render before relocating', async () => {
    const renderer = new FixedLayout()
    const events = []
    let finishRender
    const renderDone = new Promise(resolve => {
        finishRender = resolve
    })

    renderer.addEventListener('relocate', () => {
        events.push('relocate')
    })
    renderer.open(makeAsyncRenderBook(async () => {
        events.push('render-start')
        await renderDone
        events.push('render-done')
    }))

    const goTo = renderer.goTo({ index: 0 })
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.deepEqual(events, ['render-start'])
    finishRender()
    await goTo

    assert.deepEqual(events, ['render-start', 'render-done', 'relocate'])
})

test('fixed layout loads inline srcdoc frames without iframe URL navigation', async () => {
    createdIframes.length = 0
    const renderer = new FixedLayout()
    const srcdoc = '<!DOCTYPE html><meta name="viewport" content="width=100 height=200">'

    renderer.open({
        dir: 'ltr',
        rendition: { layout: 'pre-paginated' },
        sections: [{
            id: 0,
            load: async () => ({ srcdoc, onZoom: async () => {} }),
            size: 1000,
        }],
    })

    await renderer.goTo({ index: 0 })

    const iframe = createdIframes.at(-1)
    assert.equal(iframe.srcdoc, srcdoc)
    assert.deepEqual(iframe.srcAssignments, [])
    assert.equal(renderer.getContents()[0]?.index, 0)
})

test('fixed layout clears inline srcdoc frames without about:blank URL navigation', async () => {
    createdIframes.length = 0
    const renderer = new FixedLayout()
    const makeSection = index => ({
        id: index,
        load: async () => ({
            srcdoc: '<!DOCTYPE html><meta name="viewport" content="width=100 height=200">',
            onZoom: async () => {},
        }),
        size: 1000,
    })

    renderer.open({
        dir: 'ltr',
        rendition: { layout: 'pre-paginated' },
        sections: [makeSection(0), makeSection(1)],
    })

    await renderer.goTo({ index: 0 })
    const firstIframe = createdIframes.at(-1)
    await renderer.goTo({ index: 1 })

    assert.equal(firstIframe.srcdoc, '')
    assert.deepEqual(createdIframes.flatMap(iframe => iframe.srcAssignments), [])
})

test('fixed layout does not rerender a PDF frame when scale is unchanged', async () => {
    const renderer = new FixedLayout()
    let renders = 0

    renderer.open(makeAsyncRenderBook(async () => {
        renders += 1
    }))

    await renderer.goTo({ index: 0 })
    assert.equal(renders, 1)

    renderer.attributeChangedCallback('zoom', null, 'fit-page')
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.equal(renders, 1)
})

test('fixed layout suppresses stale relocate after superseded async page render', async () => {
    const renderer = new FixedLayout()
    const relocated = []
    let finishFirstRender
    const firstRenderDone = new Promise(resolve => {
        finishFirstRender = resolve
    })
    const book = {
        dir: 'ltr',
        rendition: { layout: 'pre-paginated' },
        sections: [
            {
                id: 0,
                load: async () => ({
                    src: 'page-0.html',
                    onZoom: async () => firstRenderDone,
                }),
                size: 1000,
            },
            {
                id: 1,
                load: async () => ({
                    src: 'page-1.html',
                    onZoom: async () => {},
                }),
                size: 1000,
            },
        ],
    }

    renderer.addEventListener('relocate', event => {
        relocated.push(event.detail.index)
    })
    renderer.open(book)

    const firstNavigation = renderer.goTo({ index: 0 })
    await new Promise(resolve => setTimeout(resolve, 0))

    await renderer.goTo({ index: 1 })
    finishFirstRender()
    await firstNavigation

    assert.deepEqual(relocated, [1])
})

test('fixed layout ignores a stale navigation whose section load resolves late', async () => {
    const renderer = new FixedLayout()
    const relocated = []
    let resolveFirstLoad
    const firstLoad = new Promise(resolve => {
        resolveFirstLoad = resolve
    })
    const book = {
        dir: 'ltr',
        rendition: { layout: 'pre-paginated' },
        sections: [
            {
                id: 0,
                load: async () => firstLoad,
                size: 1000,
            },
            {
                id: 1,
                load: async () => 'page-1.html',
                size: 1000,
            },
        ],
    }

    renderer.addEventListener('relocate', event => {
        relocated.push(event.detail.index)
    })
    renderer.open(book)

    const firstNavigation = renderer.goTo({ index: 0 })
    await new Promise(resolve => setTimeout(resolve, 0))

    await renderer.goTo({ index: 1 })
    assert.equal(renderer.getContents()[0]?.index, 1)

    resolveFirstLoad('page-0.html')
    await firstNavigation

    assert.equal(renderer.getContents()[0]?.index, 1)
    assert.deepEqual(relocated, [1])
})

test('fixed layout ignores a stale iframe load after newer navigation', async () => {
    const renderer = new FixedLayout()
    const relocated = []
    const overlayIndexes = []
    let resolveStaleFrameLoad
    delayedIframeLoads.set('page-0.html', new Promise(resolve => {
        resolveStaleFrameLoad = resolve
    }))

    renderer.addEventListener('relocate', event => {
        relocated.push(event.detail.index)
    })
    renderer.addEventListener('create-overlayer', event => {
        overlayIndexes.push(event.detail.index)
        event.detail.attach({
            element: new FakeNode('svg'),
            redraw() {},
        })
    })
    renderer.open(makeBook(2))

    const firstNavigation = renderer.goTo({ index: 0 })
    await new Promise(resolve => setTimeout(resolve, 0))

    await renderer.goTo({ index: 1 })
    assert.equal(renderer.getContents()[0]?.index, 1)

    resolveStaleFrameLoad()
    await firstNavigation
    delayedIframeLoads.clear()

    assert.equal(renderer.getContents()[0]?.index, 1)
    assert.deepEqual(overlayIndexes, [1])
    assert.deepEqual(relocated, [1])
})
