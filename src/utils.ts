import iconv from 'iconv-lite'

export function decodeEncoding(buffer:Uint8Array, wolfMetadata: { ver: 2 | 3 | -1 }){
    if(wolfMetadata.ver === 2){
        return iconv.decode(Buffer.from(buffer), 'shift_jis')
    }
    else{
        return Buffer.from(buffer).toString('utf-8')
    }
}

export function encodeEncoding(text: string, wolfMetadata: { ver: 2 | 3 | -1 }): Buffer {
    if(wolfMetadata.ver === 2){
        const encoded = iconv.encode(text, 'shift_jis')
        if(iconv.decode(encoded, 'shift_jis') !== text){
            const unrepresentable = [...text].find((character) => {
                const one = iconv.encode(character, 'shift_jis')
                return iconv.decode(one, 'shift_jis') !== character
            })
            const detail = unrepresentable
                ? ` (${unrepresentable} U+${unrepresentable.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`
                : ''
            throw new Error(`Wolf v2 Shift_JIS로 표현할 수 없는 문자가 있습니다${detail}.`)
        }
        return encoded
    }
    if(wolfMetadata.ver === 3){
        return Buffer.from(text, 'utf-8')
    }
    throw new Error('Wolf 데이터 버전을 확인할 수 없어 문자열을 인코딩할 수 없습니다.')
}
