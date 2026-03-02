
const COMMENT_KEY_RE = /^comment_\d+$/;
const MAX_ISSUES = 500;

export interface VerifyIssue {
    path: string;
    type: 'array_length' | 'type_mismatch' | 'keys_added' | 'keys_removed' | 'value_changed';
    severity: 'error' | 'warning';
    message: string;
    origValue?: any;
    transValue?: any;
}

export interface VerifyResult {
    fileName: string;
    issues: VerifyIssue[];
    errorCount: number;
    warningCount: number;
}

function getType(v: any): string {
    if (v === null || v === undefined) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
}

export function verifyJsonIntegrity(orig: any, trans: any, path: string = '$', issues?: VerifyIssue[]): VerifyIssue[] {
    if (!issues) issues = [];
    if (issues.length >= MAX_ISSUES) return issues;

    const origType = getType(orig);
    const transType = getType(trans);

    if (origType === 'null' && transType === 'null') return issues;

    if (origType !== transType) {
        issues.push({
            path,
            type: 'type_mismatch',
            severity: 'error',
            message: `타입 불일치: 원본=${origType}, 번역=${transType}`,
            origValue: origType,
            transValue: transType
        });
        return issues;
    }

    if (origType === 'string') return issues;

    if (origType === 'array') {
        if (orig.length !== trans.length) {
            issues.push({
                path,
                type: 'array_length',
                severity: 'error',
                message: `배열 길이 불일치: 원본=${orig.length}개, 번역=${trans.length}개`,
                origValue: orig.length,
                transValue: trans.length
            });
        }
        const minLen = Math.min(orig.length, trans.length);
        for (let i = 0; i < minLen; i++) {
            if (issues.length >= MAX_ISSUES) break;
            verifyJsonIntegrity(orig[i], trans[i], `${path}[${i}]`, issues);
        }
        return issues;
    }

    if (origType === 'object') {
        const origKeys = Object.keys(orig).filter(k => !COMMENT_KEY_RE.test(k));
        const transKeys = Object.keys(trans).filter(k => !COMMENT_KEY_RE.test(k));
        const origSet = new Set(origKeys);
        const transSet = new Set(transKeys);

        const added = transKeys.filter(k => !origSet.has(k));
        const removed = origKeys.filter(k => !transSet.has(k));

        if (added.length > 0) {
            issues.push({
                path,
                type: 'keys_added',
                severity: 'warning',
                message: `키 추가됨: ${added.slice(0, 10).join(', ')}${added.length > 10 ? ` 외 ${added.length - 10}개` : ''}`,
                transValue: added
            });
        }
        if (removed.length > 0) {
            issues.push({
                path,
                type: 'keys_removed',
                severity: 'error',
                message: `키 제거됨: ${removed.slice(0, 10).join(', ')}${removed.length > 10 ? ` 외 ${removed.length - 10}개` : ''}`,
                origValue: removed
            });
        }

        for (const key of origKeys) {
            if (issues.length >= MAX_ISSUES) break;
            if (transSet.has(key)) {
                verifyJsonIntegrity(orig[key], trans[key], `${path}.${key}`, issues);
            }
        }
        return issues;
    }

    // number, boolean
    if (orig !== trans) {
        issues.push({
            path,
            type: 'value_changed',
            severity: 'warning',
            message: `값 변경: ${JSON.stringify(orig)} → ${JSON.stringify(trans)}`,
            origValue: orig,
            transValue: trans
        });
    }

    return issues;
}

// 원본 구조를 기반으로 번역된 문자열만 오버레이하여 구조 복원
export function repairJson(orig: any, trans: any): any {
    const origType = getType(orig);
    const transType = getType(trans);

    if (origType === 'string' && transType === 'string') {
        return trans;
    }

    if (origType !== transType) {
        return JSON.parse(JSON.stringify(orig));
    }

    if (origType === 'null') return null;

    if (origType === 'array') {
        const result = [];
        for (let i = 0; i < orig.length; i++) {
            if (i < trans.length) {
                result.push(repairJson(orig[i], trans[i]));
            } else {
                result.push(JSON.parse(JSON.stringify(orig[i])));
            }
        }
        return result;
    }

    if (origType === 'object') {
        const result: any = {};
        for (const key of Object.keys(orig)) {
            if (key in trans) {
                result[key] = repairJson(orig[key], trans[key]);
            } else {
                result[key] = JSON.parse(JSON.stringify(orig[key]));
            }
        }
        return result;
    }

    return orig;
}
