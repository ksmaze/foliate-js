const parseViewport = str => str
    ?.split(/[,;\s]/) // NOTE: technically, only the comma is valid
    ?.filter(x => x)
    ?.map(x => x.split('=').map(x => x.trim()))

const getViewport = (doc, viewport) => {
    // use `viewBox` for SVG
    if (doc.documentElement.localName === 'svg') {
        const [, , width, height] = doc.documentElement
            .getAttribute('viewBox')?.split(/\s/) ?? []
        return { width, height }
    }

    // get `viewport` `meta` element
    const meta = parseViewport(doc.querySelector('meta[name="viewport"]')
        ?.getAttribute('content'))
    if (meta) return Object.fromEntries(meta)

    // fallback to book's viewport
    if (typeof viewport === 'string') return parseViewport(viewport)
    if (viewport?.width && viewport.height) return viewport

    // if no viewport (possibly with image directly in spine), get image size
    const img = doc.querySelector('img')
    if (img) return { width: img.naturalWidth, height: img.naturalHeight }

    // just show *something*, i guess...
    console.warn(new Error('Missing viewport properties'))
    return { width: 1000, height: 2000 }
}

export class FixedLayout extends HTMLElement {
    static observedAttributes = ['zoom']
    #root = this.attachShadow({ mode: 'closed' })
    #observer = new ResizeObserver(() => {
        this.#render().catch(e => console.warn(e))
    })
    #spreads
    #index = -1
    #navigationGeneration = 0
    defaultViewport
    spread
    #portrait = false
    #left
    #right
    #center
    #side
    #zoom
    constructor() {
        super()

        const sheet = new CSSStyleSheet()
        this.#root.adoptedStyleSheets = [sheet]
        sheet.replaceSync(`:host {
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: auto;
        }`)

        this.#observer.observe(this)
    }
    attributeChangedCallback(name, _, value) {
        switch (name) {
            case 'zoom':
                this.#zoom = value !== 'fit-width' && value !== 'fit-page'
                    ? parseFloat(value) : value
                this.#render().catch(e => console.warn(e))
                break
        }
    }
    async #createFrame({ index, src: srcOption }, isCurrent = () => true) {
        const srcOptionIsString = typeof srcOption === 'string'
        const src = srcOptionIsString ? srcOption : srcOption?.src
        const srcdoc = srcOptionIsString ? null : srcOption?.srcdoc
        const onZoom = srcOptionIsString ? null : srcOption?.onZoom
        const element = document.createElement('div')
        element.setAttribute('dir', 'ltr')
        Object.assign(element.style, {
            position: 'relative',
        })
        const iframe = document.createElement('iframe')
        element.append(iframe)
        Object.assign(iframe.style, {
            border: '0',
            display: 'none',
            overflow: 'hidden',
        })
        // `allow-scripts` is needed for events because of WebKit bug
        // https://bugs.webkit.org/show_bug.cgi?id=218086
        iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
        iframe.setAttribute('scrolling', 'no')
        iframe.setAttribute('part', 'filter')
        this.#root.append(element)
        if (!src && srcdoc == null) return { blank: true, element, iframe }
        return new Promise(resolve => {
            iframe.addEventListener('load', () => {
                const doc = iframe.contentDocument
                this.dispatchEvent(new CustomEvent('load', { detail: { doc, index } }))
                const { width, height } = getViewport(doc, this.defaultViewport)
                const frame = {
                    element, iframe,
                    width: parseFloat(width),
                    height: parseFloat(height),
                    onZoom,
                    index,
                    usesSrcdoc: srcdoc != null,
                }
                if (isCurrent()) {
                    this.dispatchEvent(new CustomEvent('create-overlayer', {
                        detail: {
                            doc, index,
                            attach: overlayer => {
                                frame.overlayer = overlayer
                                element.append(overlayer.element)
                            },
                        },
                    }))
                }
                resolve(frame)
            }, { once: true })
            if (srcdoc != null) iframe.srcdoc = srcdoc
            else iframe.src = src
        })
    }
    #renderFrame(frame, scale) {
        const { onZoom, iframe, blank } = frame
        if (!onZoom || blank || !iframe?.contentDocument) return null
        if (frame.renderedScale === scale) return null
        if (frame.renderScale === scale && frame.renderPromise)
            return frame.renderPromise

        const version = (frame.renderVersion ?? 0) + 1
        const doc = iframe.contentDocument
        frame.renderVersion = version
        frame.renderScale = scale
        const renderPromise = Promise.resolve()
            .then(() => {
                if (frame.renderVersion !== version || iframe.contentDocument !== doc)
                    return
                return onZoom({ doc, scale })
            })
            .then(() => {
                if (frame.renderVersion === version && iframe.contentDocument === doc)
                    frame.renderedScale = scale
            })
            .catch(e => {
                if (frame.renderVersion === version)
                    console.warn(e)
            })
            .finally(() => {
                if (frame.renderVersion === version)
                    frame.renderPromise = null
            })
        frame.renderPromise = renderPromise
        return renderPromise
    }
    async #render(side = this.#side) {
        if (!side) return
        const left = this.#left ?? {}
        const right = this.#center ?? this.#right ?? {}
        const target = side === 'left' ? left : right
        const { width, height } = this.getBoundingClientRect()
        const portrait = this.spread !== 'both' && this.spread !== 'portrait'
            && height > width
        this.#portrait = portrait
        const blankWidth = left.width ?? right.width ?? 0
        const blankHeight = left.height ?? right.height ?? 0

        const scale = typeof this.#zoom === 'number' && !isNaN(this.#zoom)
            ? this.#zoom
            : (this.#zoom === 'fit-width'
                ? (portrait || this.#center
                    ? width / (target.width ?? blankWidth)
                    : width / ((left.width ?? blankWidth) + (right.width ?? blankWidth)))
                : (portrait || this.#center
                    ? Math.min(
                        width / (target.width ?? blankWidth),
                        height / (target.height ?? blankHeight))
                    : Math.min(
                        width / ((left.width ?? blankWidth) + (right.width ?? blankWidth)),
                        height / Math.max(
                            left.height ?? blankHeight,
                            right.height ?? blankHeight)))
            ) || 1

        const renderPromises = []
        const transformedFrames = []
        const transform = frame => {
            let { element, iframe, width, height, blank, onZoom } = frame
            if (!iframe) return
            const iframeScale = onZoom ? scale : 1
            Object.assign(iframe.style, {
                width: `${width * iframeScale}px`,
                height: `${height * iframeScale}px`,
                transform: onZoom ? 'none' : `scale(${scale})`,
                transformOrigin: 'top left',
                display: blank ? 'none' : 'block',
            })
            Object.assign(element.style, {
                width: `${(width ?? blankWidth) * scale}px`,
                height: `${(height ?? blankHeight) * scale}px`,
                overflow: 'hidden',
                display: 'block',
                flexShrink: '0',
                marginBlock: 'auto',
            })
            if (frame.overlayer) {
                Object.assign(frame.overlayer.element.style, {
                    width: `${width * iframeScale}px`,
                    height: `${height * iframeScale}px`,
                    transform: onZoom ? 'none' : `scale(${scale})`,
                    transformOrigin: 'top left',
                })
                transformedFrames.push(frame)
            }
            const renderPromise = this.#renderFrame(frame, scale)
            if (renderPromise) renderPromises.push(renderPromise)
            if (portrait && frame !== target) {
                element.style.display = 'none'
            }
        }
        if (this.#center) {
            transform(this.#center)
        } else {
            transform(left)
            transform(right)
        }
        await Promise.all(renderPromises)
        for (const frame of transformedFrames)
            frame.overlayer?.redraw()
    }
    #destroyFrame(frame) {
        if (!frame) return
        frame.renderVersion = (frame.renderVersion ?? 0) + 1
        frame.renderPromise = null
        frame.iframe?.contentDocument?.__pdfCancelRender?.()
        try {
            if (frame.iframe && !frame.blank) {
                if (frame.usesSrcdoc) frame.iframe.srcdoc = ''
                else frame.iframe.src = 'about:blank'
            }
        } catch {}
        frame.element?.remove?.()
    }
    #isNavigationCurrent(generation) {
        return generation === this.#navigationGeneration
    }
    async #showSpread({ left, right, center, side }, isCurrent = () => true) {
        if (!isCurrent()) return false
        this.#destroyFrame(this.#left)
        this.#destroyFrame(this.#right)
        this.#destroyFrame(this.#center)
        this.#root.replaceChildren()
        this.#left = null
        this.#right = null
        this.#center = null
        if (center) {
            const frame = await this.#createFrame(center, isCurrent)
            if (!isCurrent()) {
                this.#destroyFrame(frame)
                return false
            }
            this.#center = frame
            this.#side = 'center'
            await this.#render()
            if (!isCurrent()) return false
        } else {
            const leftFrame = await this.#createFrame(left, isCurrent)
            if (!isCurrent()) {
                this.#destroyFrame(leftFrame)
                return false
            }
            const rightFrame = await this.#createFrame(right, isCurrent)
            if (!isCurrent()) {
                this.#destroyFrame(leftFrame)
                this.#destroyFrame(rightFrame)
                return false
            }
            this.#left = leftFrame
            this.#right = rightFrame
            this.#side = this.#left.blank ? 'right'
                : this.#right.blank ? 'left' : side
            await this.#render()
            if (!isCurrent()) return false
        }
        return true
    }
    async #goLeft() {
        if (this.#center || this.#left?.blank) return
        if (this.#portrait && this.#left?.element?.style?.display === 'none') {
            const generation = ++this.#navigationGeneration
            this.#side = 'left'
            await this.#render()
            if (!this.#isNavigationCurrent(generation)) return
            this.#reportLocation('page')
            return true
        }
    }
    async #goRight() {
        if (this.#center || this.#right?.blank) return
        if (this.#portrait && this.#right?.element?.style?.display === 'none') {
            const generation = ++this.#navigationGeneration
            this.#side = 'right'
            await this.#render()
            if (!this.#isNavigationCurrent(generation)) return
            this.#reportLocation('page')
            return true
        }
    }
    open(book) {
        this.book = book
        const { rendition } = book
        this.spread = rendition?.spread
        this.defaultViewport = rendition?.viewport

        const rtl = book.dir === 'rtl'
        const ltr = !rtl
        this.rtl = rtl

        if (rendition?.spread === 'none')
            this.#spreads = book.sections.map(section => ({ center: section }))
        else this.#spreads = book.sections.reduce((arr, section, i) => {
            const last = arr[arr.length - 1]
            const { pageSpread } = section
            const newSpread = () => {
                const spread = {}
                arr.push(spread)
                return spread
            }
            if (pageSpread === 'center') {
                const spread = last.left || last.right ? newSpread() : last
                spread.center = section
            }
            else if (pageSpread === 'left') {
                const spread = last.center || last.left || ltr && i ? newSpread() : last
                spread.left = section
            }
            else if (pageSpread === 'right') {
                const spread = last.center || last.right || rtl && i ? newSpread() : last
                spread.right = section
            }
            else if (ltr) {
                if (last.center || last.right) newSpread().left = section
                else if (last.left || !i) last.right = section
                else last.left = section
            }
            else {
                if (last.center || last.left) newSpread().right = section
                else if (last.right || !i) last.left = section
                else last.right = section
            }
            return arr
        }, [{}])
    }
    get index() {
        const spread = this.#spreads[this.#index]
        const section = spread?.center ?? (this.#side === 'left'
            ? spread.left ?? spread.right : spread.right ?? spread.left)
        return this.book.sections.indexOf(section)
    }
    #reportLocation(reason) {
        this.dispatchEvent(new CustomEvent('relocate', { detail:
            { reason, range: null, index: this.index, fraction: 0, size: 1 } }))
    }
    getSpreadOf(section) {
        const spreads = this.#spreads
        for (let index = 0; index < spreads.length; index++) {
            const { left, right, center } = spreads[index]
            if (left === section) return { index, side: 'left' }
            if (right === section) return { index, side: 'right' }
            if (center === section) return { index, side: 'center' }
        }
    }
    async goToSpread(index, side, reason) {
        if (index < 0 || index > this.#spreads.length - 1) return
        const generation = ++this.#navigationGeneration
        const isCurrent = () => this.#isNavigationCurrent(generation)
        if (index === this.#index) {
            this.#side = side
            await this.#render()
            if (!isCurrent()) return
            this.#reportLocation(reason)
            return
        }
        const spread = this.#spreads[index]
        let didShow = false
        if (spread.center) {
            const index = this.book.sections.indexOf(spread.center)
            const src = await spread.center?.load?.()
            if (!isCurrent()) return
            didShow = await this.#showSpread({ center: { index, src } }, isCurrent)
        } else {
            const indexL = this.book.sections.indexOf(spread.left)
            const indexR = this.book.sections.indexOf(spread.right)
            const srcL = await spread.left?.load?.()
            if (!isCurrent()) return
            const srcR = await spread.right?.load?.()
            if (!isCurrent()) return
            const left = { index: indexL, src: srcL }
            const right = { index: indexR, src: srcR }
            didShow = await this.#showSpread({ left, right, side }, isCurrent)
        }
        if (!didShow || !isCurrent()) return
        this.#index = index
        this.#reportLocation(reason)
    }
    async select(target) {
        await this.goTo(target)
        // TODO
    }
    async goTo(target) {
        const { book } = this
        const resolved = await target
        const section = book.sections[resolved.index]
        if (!section) return
        const { index, side } = this.getSpreadOf(section)
        await this.goToSpread(index, side)
    }
    #canGoToIndex(index) {
        return index >= 0 && index <= this.book.sections.length - 1
    }
    #adjacentIndex(dir) {
        for (let index = this.index + dir; this.#canGoToIndex(index); index += dir)
            if (this.book.sections[index]?.linear !== 'no') return index
    }
    async next() {
        const s = await (this.rtl ? this.#goLeft() : this.#goRight())
        if (!s) return this.goToSpread(this.#index + 1, this.rtl ? 'right' : 'left', 'page')
    }
    async prev() {
        const s = await (this.rtl ? this.#goRight() : this.#goLeft())
        if (!s) return this.goToSpread(this.#index - 1, this.rtl ? 'left' : 'right', 'page')
    }
    prevSection() {
        return this.goTo({ index: this.#adjacentIndex(-1) })
    }
    nextSection() {
        return this.goTo({ index: this.#adjacentIndex(1) })
    }
    firstSection() {
        const index = this.book.sections.findIndex(section => section.linear !== 'no')
        return this.goTo({ index })
    }
    lastSection() {
        const index = this.book.sections.findLastIndex(section => section.linear !== 'no')
        return this.goTo({ index })
    }
    getContents() {
        return [this.#left, this.#right, this.#center]
            .filter(frame => frame?.iframe?.contentDocument && !frame.blank)
            .map(frame => ({
                doc: frame.iframe.contentDocument,
                index: frame.index,
                overlayer: frame.overlayer,
            }))
    }
    destroy() {
        this.#destroyFrame(this.#left)
        this.#destroyFrame(this.#right)
        this.#destroyFrame(this.#center)
        this.#observer.unobserve(this)
    }
}

customElements.define('foliate-fxl', FixedLayout)
