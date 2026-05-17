import { Overlayer } from '../overlayer.js'

const marker = Overlayer.noteMarker([{ right: 160, top: 32 }])
const hitArea = marker.children[0]
const bookmark = marker.children[1]

console.assert(marker.querySelector('text') === null,
    'note marker should not render a text label')
console.assert(hitArea?.tagName?.toLowerCase() === 'rect',
    'note marker should include a transparent hit area')
console.assert(hitArea?.getAttribute('fill') === 'transparent',
    'note marker hit area should be invisible')
console.assert(hitArea?.getAttribute('x') === '143.5',
    'note marker hit area should start well before the visible bookmark')
console.assert(hitArea?.getAttribute('y') === '9',
    'note marker hit area should start above the visible bookmark')
console.assert(hitArea?.getAttribute('width') === '33',
    'note marker hit area should remain finger-friendly')
console.assert(hitArea?.getAttribute('height') === '36',
    'note marker hit area should be tall enough for touch')
console.assert(bookmark?.tagName?.toLowerCase() === 'path',
    'note marker should render a bookmark path')
console.assert(bookmark?.getAttribute('fill') === '#2563eb',
    'note marker should keep the reader note color')
console.assert(bookmark?.getAttribute('opacity') === '0.42',
    'note marker should be semi-transparent')
console.assert(bookmark?.getAttribute('d') === 'M 155.5 21 L 164.5 21 L 164.5 33 L 160 30 L 155.5 33 Z',
    'note marker should be a 9x12 bookmark at the selected text end')

const overlayer = new Overlayer()
const fakeRange = {
    getClientRects: () => [{ left: 100, top: 32, right: 160, bottom: 52 }],
}
overlayer.add('note:note-1', fakeRange, (rects, options) => {
    const element = Overlayer.noteMarker(rects, options)
    element.getBoundingClientRect = () => ({
        left: 155.5,
        top: 21,
        right: 164.5,
        bottom: 33,
    })
    return element
}, { color: '#2563eb', hitElementOnly: true })
const [hitValue] = overlayer.hitTest({ x: 145, y: 15 })
console.assert(hitValue === 'note:note-1',
    'note marker hit test should use the explicit transparent hit area, not only the visible bookmark bounds')
