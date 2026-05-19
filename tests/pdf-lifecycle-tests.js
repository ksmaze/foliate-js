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
        this.style = {
            setProperty(name, value) {
                this[name] = value
            },
        }
        this.classList = {
            add() {},
            remove() {},
        }
    }

    append(...children) {
        this.children.push(...children)
    }

    replaceChildren(...children) {
        this.children = children
    }

    getContext() {
        return {}
    }

    toBlob(callback) {
        callback(new Blob())
    }
}

globalThis.document = {
    createElement: tagName => new FakeNode(tagName),
    createElementNS: (_, tagName) => new FakeNode(tagName),
    querySelectorAll: () => [],
}

const { makePDF } = await import('../pdf.js')

const makeDocument = () => {
    const nodes = new Map([
        ['#canvas', new FakeNode('div')],
        ['.textLayer', new FakeNode('div')],
        ['.annotationLayer', new FakeNode('div')],
    ])
    return {
        documentElement: new FakeNode('html'),
        adoptNode: node => node,
        querySelector: selector => nodes.get(selector),
    }
}

const setPDFDocument = page => {
    globalThis.pdfjsLib.getDocument = () => ({
        promise: Promise.resolve({
            numPages: 1,
            getMetadata: async () => ({}),
            getOutline: async () => null,
            getPage: async () => page,
            getDestination: async () => [],
            getPageIndex: async () => 0,
            destroy: () => Promise.resolve(),
        }),
    })
}

globalThis.pdfjsLib.TextLayer = class {
    async render() {}
}
globalThis.pdfjsLib.AnnotationLayer = class {
    async render() {}
}

setPDFDocument({
    getViewport: () => ({ width: 100, height: 200 }),
})

test('pdf book destroy revokes cached page urls', async () => {
    setPDFDocument({
        getViewport: () => ({ width: 100, height: 200 }),
    })

    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'sample.pdf', {
        type: 'application/pdf',
    })

    const book = await makePDF(file)
    await book.sections[0].load()
    assert.equal(createdUrls.length, 1)

    await book.destroy()
    assert.deepEqual(revokedUrls, createdUrls)
})

test('pdf page onZoom cancels stale render tasks', async () => {
    const renderTasks = []
    let cleanupCount = 0
    const page = {
        getViewport: () => ({ width: 100, height: 200 }),
        render: () => {
            let resolve
            let reject
            const task = {
                promise: new Promise((res, rej) => {
                    resolve = res
                    reject = rej
                }),
                cancel() {
                    task.cancelled = true
                    const error = new Error('cancelled')
                    error.name = 'RenderingCancelledException'
                    reject(error)
                },
                resolve,
            }
            task.resolve = resolve
            renderTasks.push(task)
            return task
        },
        streamTextContent: async () => ({}),
        getAnnotations: async () => [],
        cleanup: () => {
            cleanupCount += 1
        },
    }
    setPDFDocument(page)

    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'sample.pdf', {
        type: 'application/pdf',
    })
    const book = await makePDF(file)
    const section = await book.sections[0].load()
    const doc = makeDocument()

    const firstRender = section.onZoom({ doc, scale: 1 })
    await new Promise(resolve => setTimeout(resolve, 0))
    const secondRender = section.onZoom({ doc, scale: 1 })
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.equal(renderTasks[0].cancelled, true)
    renderTasks[1].resolve()
    await Promise.all([firstRender, secondRender])
    assert.equal(cleanupCount, 2)
})
