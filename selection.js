export const hasActiveTextSelection = doc => {
    const selection = doc?.getSelection?.()
    if (!selection?.rangeCount) return false

    for (let i = 0; i < selection.rangeCount; i++) {
        try {
            if (!selection.getRangeAt(i)?.collapsed) return true
        } catch {}
    }
    return false
}

export const shouldAutoTurnPageForPointerSelection =
    ({ isPointerSelecting, pointerType, selectionType }) =>
        Boolean(isPointerSelecting && pointerType === 'mouse' && selectionType === 'Range')
