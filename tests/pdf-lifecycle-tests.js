import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.devicePixelRatio = 1
globalThis.DOMMatrix = class {}
globalThis.ImageData = class {}
globalThis.Path2D = class {}
globalThis.fetch = async () => ({ ok: true, text: async () => '' })

const createdUrls = []
const revokedUrls = []
globalThis.URL.createObjectURL = () => {
    const url = `blob:pdf-${createdUrls.length}`
    createdUrls.push(url)
    return url
}
globalThis.URL.revokeObjectURL = url => revokedUrls.push(url)

class FakeNode extends EventTarget {
    constructor(tagName = 'div') {
        super()
        this.tagName = tagName.toUpperCase()
        this.children = []
        this.style = {}
    }

    append(...children) {
        this.children.push(...children)
    }
}

globalThis.document = {
    createElement: tagName => new FakeNode(tagName),
    createElementNS: (_, tagName) => new FakeNode(tagName),
}

const { makePDF } = await import('../pdf.js')

globalThis.pdfjsLib.getDocument = () => ({
    promise: Promise.resolve({
        numPages: 1,
        getMetadata: async () => ({}),
        getOutline: async () => null,
        getPage: async () => ({
            getViewport: () => ({ width: 100, height: 200 }),
        }),
        getDestination: async () => [],
        getPageIndex: async () => 0,
        destroy: () => Promise.resolve(),
    }),
})

test('pdf book destroy revokes cached page urls', async () => {
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'sample.pdf', {
        type: 'application/pdf',
    })

    const book = await makePDF(file)
    await book.sections[0].load()
    assert.equal(createdUrls.length, 1)

    await book.destroy()
    assert.deepEqual(revokedUrls, createdUrls)
})
