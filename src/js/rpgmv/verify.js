"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyJsonIntegrity = verifyJsonIntegrity;
exports.repairJson = repairJson;
const COMMENT_KEY_RE = /^comment_\d+$/;
const MAX_ISSUES = 500;
// ── 번역 허용 이벤트 코드 ──
// 모든 문자열 파라미터 번역 가능
const TRANSLATABLE_CODES = new Set([401, 405, 102]);
// 추출 설정에 따라 번역 가능 (스크립트/플러그인/노트)
const EXTENDED_TRANSLATABLE_CODES = new Set([355, 655, 356, 357, 108, 408]);
// 101: param[4]만, 320/324/325: param[1]만, 402: param[1]만
// ── 번역 가능한 직접 문자열 필드 ──
const TRANSLATABLE_FIELDS = new Set([
    'displayName', 'name', 'nickname', 'profile', 'description',
    'message1', 'message2', 'message3', 'message4',
    'currencyUnit', 'gameTitle'
]);
// ── System 파일의 번역 가능한 배열 필드 ──
const TRANSLATABLE_ARRAY_FIELDS = new Set([
    'armorTypes', 'elements', 'equipTypes', 'skillTypes', 'weaponTypes'
]);
// ── System.terms 하위 필드 ──
const TERMS_SUBFIELDS = new Set(['basic', 'commands', 'params', 'messages']);
// ── 제어문자 패턴 ──
const CONTROL_PATTERNS = [
    /\\[CVNPGIcvnpgi]\[\d+\]/g,
    /\\[G${}.|!><^\\]/g
];
// ── 줄밀림 감지용 패턴 ──
const PLACEHOLDER_RE = /^---\s*\d+\s*---$/;
const NAME_BRACKET_FULL_RE = /^【.+】$/;
const NAME_BRACKET_PARTIAL_RE = /【.*】/;
function getType(v) {
    if (v === null || v === undefined)
        return 'null';
    if (Array.isArray(v))
        return 'array';
    return typeof v;
}
function isEventCommand(obj) {
    return typeof obj === 'object' && obj !== null &&
        !Array.isArray(obj) &&
        typeof obj.code === 'number' &&
        typeof obj.indent === 'number' &&
        Array.isArray(obj.parameters);
}
function truncate(s, len = 40) {
    if (s.length <= len)
        return s;
    return s.substring(0, len) + '...';
}
function extractControlChars(str) {
    const chars = [];
    for (const pattern of CONTROL_PATTERNS) {
        const re = new RegExp(pattern.source, pattern.flags);
        const matches = str.match(re);
        if (matches)
            chars.push(...matches);
    }
    return chars.sort();
}
function checkControlChars(orig, trans, path, issues) {
    const origChars = extractControlChars(orig);
    const transChars = extractControlChars(trans);
    if (origChars.length === 0 && transChars.length === 0)
        return;
    const origCounts = new Map();
    for (const c of origChars)
        origCounts.set(c, (origCounts.get(c) || 0) + 1);
    const transCounts = new Map();
    for (const c of transChars)
        transCounts.set(c, (transCounts.get(c) || 0) + 1);
    const mismatches = [];
    for (const [char, count] of origCounts) {
        const tc = transCounts.get(char) || 0;
        if (tc < count)
            mismatches.push(`${char} 누락(원본 ${count}→번역 ${tc})`);
    }
    for (const [char, count] of transCounts) {
        if (!origCounts.has(char))
            mismatches.push(`${char} 추가(번역에만 ${count}개)`);
    }
    if (mismatches.length > 0) {
        issues.push({
            path,
            type: 'control_char_mismatch',
            severity: 'warning',
            message: `제어문자 불일치: ${mismatches.join('; ')}`,
            origValue: orig,
            transValue: trans
        });
    }
}
// warn 정책 문자열에서 플러그인 태그 구조가 보존되었는지 확인
// <TagName ...> 패턴의 태그 이름이 원본과 번역본에서 동일하면 안전한 번역으로 간주
function hasPreservedTagStructure(orig, trans) {
    const tagPattern = /<\/?([A-Za-z_][A-Za-z0-9_]*)/g;
    const origTags = [];
    const transTags = [];
    let m;
    while ((m = tagPattern.exec(orig)) !== null)
        origTags.push(m[1]);
    tagPattern.lastIndex = 0;
    while ((m = tagPattern.exec(trans)) !== null)
        transTags.push(m[1]);
    if (origTags.length === 0)
        return false;
    if (origTags.length !== transTags.length)
        return false;
    return origTags.every((t, i) => t === transTags[i]);
}
function getParamPolicy(code, paramIndex) {
    if (TRANSLATABLE_CODES.has(code))
        return 'allow';
    if (code === 101)
        return paramIndex === 4 ? 'allow' : 'deny';
    if (code === 402)
        return paramIndex === 1 ? 'allow' : 'deny';
    if (code === 320 || code === 324 || code === 325)
        return paramIndex === 1 ? 'allow' : 'deny';
    if (EXTENDED_TRANSLATABLE_CODES.has(code))
        return 'warn';
    return 'deny';
}
// ═══════════════════════════════════════════
// 텍스트 줄밀림(Text Shift) 감지
// 구조가 동일해도 내용물이 밀려서 들어간 경우를 감지
// ═══════════════════════════════════════════
function checkTextShift(origStr, transStr, path, issues) {
    if (origStr === transStr)
        return;
    // 1. 플레이스홀더(--- 101 --- 등) 보존 검사
    if (PLACEHOLDER_RE.test(origStr.trim())) {
        if (!PLACEHOLDER_RE.test(transStr.trim())) {
            issues.push({
                path,
                type: 'text_shift',
                severity: 'error',
                message: `줄밀림 감지: 마커 "${origStr.trim()}"가 대사로 덮어씌워짐 → "${truncate(transStr)}"`,
                origValue: origStr,
                transValue: transStr
            });
            return;
        }
    }
    // 2. 이름 태그 괄호(【】) 보존 검사
    if (NAME_BRACKET_FULL_RE.test(origStr.trim())) {
        if (!NAME_BRACKET_PARTIAL_RE.test(transStr)) {
            issues.push({
                path,
                type: 'text_shift',
                severity: 'error',
                message: `줄밀림 감지: 이름표 "${origStr.trim()}"가 대사로 덮어씌워짐 → "${truncate(transStr)}"`,
                origValue: origStr,
                transValue: transStr
            });
            return;
        }
    }
    // 3. 빈 문자열 보존 검사
    if (origStr === '' && transStr !== '') {
        issues.push({
            path,
            type: 'text_shift',
            severity: 'error',
            message: `줄밀림 감지: 빈 줄이어야 할 위치에 텍스트 밀려옴 → "${truncate(transStr)}"`,
            origValue: origStr,
            transValue: transStr
        });
        return;
    }
    // 4. 특수 기호 전용 줄 보존 검사 (........, ……, ！？！？ 등)
    const origTrimmed = origStr.trim();
    if (origTrimmed.length > 0 && /^[.…!！?？、。·\-~～♪♫★☆♥♡●○■□▲△▼▽\s]+$/.test(origTrimmed)) {
        const transHasLetters = /[a-zA-Z\u3040-\u9FFF\uAC00-\uD7AF]/.test(transStr);
        if (transHasLetters && transStr.trim() !== origTrimmed) {
            issues.push({
                path,
                type: 'text_shift',
                severity: 'warning',
                message: `줄밀림 의심: 기호 전용 줄 "${truncate(origTrimmed)}"에 문자가 포함된 텍스트 → "${truncate(transStr)}"`,
                origValue: origStr,
                transValue: transStr
            });
        }
    }
}
// 필드 이름에 따른 문자열 정책 결정 (null = 부모 정책 상속)
function getFieldPolicy(key, parentObj) {
    if (key === 'note')
        return 'warn';
    if (TRANSLATABLE_FIELDS.has(key)) {
        if (key === 'name') {
            // 데이터 항목(Actor, Item 등)의 name만 번역 허용
            if (parentObj && typeof parentObj.id === 'number' &&
                !parentObj.pages && !parentObj.list) {
                return 'allow';
            }
            // 맵이나 이벤트의 name은 플러그인 참조용일 수 있으므로 warn
            if (parentObj && (parentObj.pages || parentObj.list ||
                parentObj.events || parentObj.autoplayBgm !== undefined)) {
                return 'warn';
            }
            return null;
        }
        return 'allow';
    }
    if (TRANSLATABLE_ARRAY_FIELDS.has(key))
        return 'allow';
    if (TERMS_SUBFIELDS.has(key))
        return 'allow';
    return null;
}
function verifyEventCommand(orig, trans, path, issues) {
    // code는 100% 일치해야 함
    if (orig.code !== trans.code) {
        issues.push({
            path: `${path}.code`,
            type: 'value_changed',
            severity: 'error',
            message: `이벤트 코드 변경: ${orig.code} → ${trans.code}`,
            origValue: orig.code,
            transValue: trans.code
        });
    }
    // indent는 100% 일치해야 함
    if (orig.indent !== trans.indent) {
        issues.push({
            path: `${path}.indent`,
            type: 'value_changed',
            severity: 'error',
            message: `들여쓰기 변경: ${orig.indent} → ${trans.indent}`,
            origValue: orig.indent,
            transValue: trans.indent
        });
    }
    // parameters: 코드별 정책 적용
    const origParams = orig.parameters;
    const transParams = trans.parameters;
    if (Array.isArray(origParams) && Array.isArray(transParams)) {
        if (origParams.length !== transParams.length) {
            issues.push({
                path: `${path}.parameters`,
                type: 'array_length',
                severity: 'error',
                message: `파라미터 길이 불일치: 원본=${origParams.length}개, 번역=${transParams.length}개`,
                origValue: origParams.length,
                transValue: transParams.length
            });
        }
        const code = orig.code;
        const minLen = Math.min(origParams.length, transParams.length);
        for (let i = 0; i < minLen; i++) {
            if (issues.length >= MAX_ISSUES)
                break;
            const policy = getParamPolicy(code, i);
            verifyJsonIntegrity(origParams[i], transParams[i], `${path}.parameters[${i}]`, issues, policy);
            // 번역 허용 코드(401, 405)의 문자열 파라미터에 대해 줄밀림 검사
            if ((code === 401 || code === 405) && policy === 'allow' &&
                typeof origParams[i] === 'string' && typeof transParams[i] === 'string') {
                checkTextShift(origParams[i], transParams[i], `${path}.parameters[${i}]`, issues);
            }
        }
    }
    // 그 외 키는 원본과 동일해야 함
    for (const key of Object.keys(orig)) {
        if (['code', 'indent', 'parameters'].includes(key))
            continue;
        if (COMMENT_KEY_RE.test(key))
            continue;
        if (key in trans) {
            verifyJsonIntegrity(orig[key], trans[key], `${path}.${key}`, issues, 'deny');
        }
    }
}
function verifyJsonIntegrity(orig, trans, path = '$', issues, stringPolicy = 'deny') {
    if (!issues)
        issues = [];
    if (issues.length >= MAX_ISSUES)
        return issues;
    const origType = getType(orig);
    const transType = getType(trans);
    if (origType === 'null' && transType === 'null')
        return issues;
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
    // ── 문자열: 정책에 따라 판단 ──
    if (origType === 'string') {
        if (orig !== trans) {
            if (stringPolicy === 'deny') {
                issues.push({
                    path,
                    type: 'string_changed',
                    severity: 'error',
                    message: `번역 불가 위치의 문자열 변경: "${truncate(orig)}" → "${truncate(trans)}"`,
                    origValue: orig,
                    transValue: trans
                });
            }
            else if (stringPolicy === 'warn') {
                // warn 정책: 번역이 의도적일 수 있으므로 제어문자만 검사
                checkControlChars(orig, trans, path, issues);
            }
            else {
                // allow: 번역 허용, 제어문자만 검사
                checkControlChars(orig, trans, path, issues);
            }
        }
        return issues;
    }
    // ── 숫자/불리언: 무조건 일치 (ERROR) ──
    if (origType === 'number' || origType === 'boolean') {
        if (orig !== trans) {
            issues.push({
                path,
                type: 'value_changed',
                severity: 'error',
                message: `값 변경: ${JSON.stringify(orig)} → ${JSON.stringify(trans)}`,
                origValue: orig,
                transValue: trans
            });
        }
        return issues;
    }
    // ── 배열 ──
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
            if (issues.length >= MAX_ISSUES)
                break;
            verifyJsonIntegrity(orig[i], trans[i], `${path}[${i}]`, issues, stringPolicy);
        }
        return issues;
    }
    // ── 오브젝트 ──
    if (origType === 'object') {
        const origObj = orig;
        const transObj = trans;
        // 이벤트 커맨드 감지 → 코드별 전용 검증
        if (isEventCommand(orig) && isEventCommand(trans)) {
            verifyEventCommand(origObj, transObj, path, issues);
            return issues;
        }
        const origKeys = Object.keys(origObj).filter(k => !COMMENT_KEY_RE.test(k));
        const transKeys = Object.keys(transObj).filter(k => !COMMENT_KEY_RE.test(k));
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
            if (issues.length >= MAX_ISSUES)
                break;
            if (transSet.has(key)) {
                const specificPolicy = getFieldPolicy(key, origObj);
                const childPolicy = specificPolicy !== null ? specificPolicy : stringPolicy;
                verifyJsonIntegrity(origObj[key], transObj[key], `${path}.${key}`, issues, childPolicy);
            }
        }
        // comment_ 딕셔너리 줄밀림 검사 (MVT 등 번역 툴이 추가한 키)
        const origCommentKeys = Object.keys(origObj).filter(k => COMMENT_KEY_RE.test(k));
        if (origCommentKeys.length > 0) {
            for (const key of origCommentKeys) {
                if (issues.length >= MAX_ISSUES)
                    break;
                if (key in transObj && typeof origObj[key] === 'string' && typeof transObj[key] === 'string') {
                    checkTextShift(origObj[key], transObj[key], `${path}.${key}`, issues);
                }
            }
        }
        return issues;
    }
    return issues;
}
// ═══════════════════════════════════════════
// Repair: 원본 구조 기반으로 번역 문자열만 유지하여 복원
// ═══════════════════════════════════════════
function repairEventCommand(orig, trans) {
    const result = {};
    result.code = orig.code;
    result.indent = orig.indent;
    if (Array.isArray(orig.parameters)) {
        result.parameters = [];
        const code = orig.code;
        const transParams = Array.isArray(trans.parameters) ? trans.parameters : [];
        for (let i = 0; i < orig.parameters.length; i++) {
            if (i < transParams.length) {
                const policy = getParamPolicy(code, i);
                result.parameters.push(repairJson(orig.parameters[i], transParams[i], policy));
            }
            else {
                result.parameters.push(JSON.parse(JSON.stringify(orig.parameters[i])));
            }
        }
    }
    for (const key of Object.keys(orig)) {
        if (['code', 'indent', 'parameters'].includes(key))
            continue;
        result[key] = JSON.parse(JSON.stringify(orig[key]));
    }
    return result;
}
function repairJson(orig, trans, stringPolicy = 'deny') {
    const origType = getType(orig);
    const transType = getType(trans);
    if (origType === 'string' && transType === 'string') {
        return stringPolicy !== 'deny' ? trans : orig;
    }
    if (origType !== transType) {
        return JSON.parse(JSON.stringify(orig));
    }
    if (origType === 'null')
        return null;
    if (origType === 'number' || origType === 'boolean') {
        return orig;
    }
    if (origType === 'array') {
        const result = [];
        for (let i = 0; i < orig.length; i++) {
            if (i < trans.length) {
                result.push(repairJson(orig[i], trans[i], stringPolicy));
            }
            else {
                result.push(JSON.parse(JSON.stringify(orig[i])));
            }
        }
        return result;
    }
    if (origType === 'object') {
        const origObj = orig;
        const transObj = trans;
        if (isEventCommand(orig)) {
            return repairEventCommand(origObj, transObj);
        }
        const result = {};
        for (const key of Object.keys(origObj)) {
            if (key in transObj) {
                const specificPolicy = getFieldPolicy(key, origObj);
                const childPolicy = specificPolicy !== null ? specificPolicy : stringPolicy;
                result[key] = repairJson(origObj[key], transObj[key], childPolicy);
            }
            else {
                result[key] = JSON.parse(JSON.stringify(origObj[key]));
            }
        }
        return result;
    }
    return orig;
}
// ═══════════════════════════════════════════
// JSON Path Navigation
// ═══════════════════════════════════════════
function parsePath(jsonPath) {
    return jsonPath
        .replace(/^\$\.?/, '')
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter(Boolean)
        .map(p => /^\d+$/.test(p) ? Number(p) : p);
}
function getAtPath(obj, jsonPath) {
    const parts = parsePath(jsonPath);
    let current = obj;
    for (const part of parts) {
        if (current == null || typeof current !== 'object')
            return undefined;
        current = current[part];
    }
    return current;
}
exports.getAtPath = getAtPath;
function setAtPath(obj, jsonPath, value) {
    const parts = parsePath(jsonPath);
    if (parts.length === 0)
        return false;
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (current == null || typeof current !== 'object')
            return false;
        current = current[parts[i]];
    }
    if (current == null || typeof current !== 'object')
        return false;
    const lastKey = parts[parts.length - 1];
    current[lastKey] = value;
    return true;
}
exports.setAtPath = setAtPath;
