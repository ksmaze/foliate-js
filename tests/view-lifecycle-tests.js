import assert from 'node:assert/strict'
import test from 'node:test'

class FakeNode extends EventTarget {
    constructor(tagName = 'div') {
        super()
        this.tagName = tagName.toUpperCase()
        this.children = []
        this.style = {}
        this.adoptedStyleSheets = []
    }

    append(...children) {
        this.children.push(...children)
    }

    appendChild(child) {
        this.children.push(child)
        return child
    }

    setAttribute(name, value) {
        this[name] = String(value)
    }

    remove() {}
}

class FakeHTMLElement extends FakeNode {
    attachShadow() {
        return new FakeNode('shadow-root')
    }
}

globalThis.HTMLElement = FakeHTMLElement
globalThis.NodeFilter = {
    SHOW_ELEMENT: 1,
    SHOW_TEXT: 4,
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3,
}
globalThis.customElements = { define() {} }
globalThis.document = {
    createElement: tagName => new FakeNode(tagName),
    createElementNS: (_, tagName) => new FakeNode(tagName),
}

const { View } = await import('../view.js')

test('foliate view close destroys the active book and clears references', () => {
    const view = new View()
    let rendererDestroyed = false
    let rendererRemoved = false
    let bookDestroyed = false

    view.renderer = {
        destroy() {
            rendererDestroyed = true
        },
        remove() {
            rendererRemoved = true
        },
    }
    view.book = {
        destroy() {
            bookDestroyed = true
        },
    }

    view.close()

    assert.equal(rendererDestroyed, true)
    assert.equal(rendererRemoved, true)
    assert.equal(bookDestroyed, true)
    assert.equal(view.book, null)
    assert.equal(view.renderer, null)
})

test('foliate view ignores late renderer events after close', async () => {
    let renderer
    class FakeRenderer extends FakeNode {
        open() {}
        destroy() {}
    }
    globalThis.document.createElement = tagName => {
        if (tagName === 'foliate-fxl') {
            renderer = new FakeRenderer(tagName)
            return renderer
        }
        return new FakeNode(tagName)
    }

    const view = new View()
    await view.open({
        rendition: { layout: 'pre-paginated' },
        metadata: {},
        sections: [{ id: 0, size: 1 }],
    })

    view.close()

    assert.doesNotThrow(() => {
        renderer.dispatchEvent(new CustomEvent('load', {
            detail: {
                doc: {
                    documentElement: {},
                    addEventListener() {},
                },
                index: 0,
            },
        }))
    })
})
