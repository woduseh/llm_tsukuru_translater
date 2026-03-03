"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initTools = initTools;
const state_1 = require("./state");
function initTools() {
    document.getElementById('eztrans').onclick = async () => {
        if (state_1.state.running) {
            state_1.Swal.fire({
                icon: 'error',
                text: '이미 다른 작업이 시행중입니다!',
            });
            return;
        }
        const dir = document.getElementById('folder_input').value.replaceAll('\\', '/');
        window.api.send('openLLMSettings', { dir: dir, game: 'mv' });
    };
    document.getElementById('llmCompare').onclick = () => {
        const dir = document.getElementById('folder_input').value.replaceAll('\\', '/');
        if (!dir) {
            state_1.Swal.fire({ icon: 'error', text: '프로젝트 폴더를 먼저 선택하세요.' });
            return;
        }
        window.api.send('openLLMCompare', dir);
    };
    document.getElementById('jsonVerify').onclick = () => {
        const dir = document.getElementById('folder_input').value.replaceAll('\\', '/');
        if (!dir) {
            state_1.Swal.fire({ icon: 'error', text: '프로젝트 폴더를 먼저 선택하세요.' });
            return;
        }
        window.api.send('openJsonVerify', dir);
    };
    document.getElementById('toProject').onclick = () => {
        if (state_1.state.running) {
            state_1.Swal.fire({
                icon: 'error',
                text: '이미 다른 작업이 시행중입니다!',
            });
            return;
        }
        state_1.Swal.fire({
            icon: 'warning',
            text: '변환기를 사용하시겠습니까?',
            confirmButtonText: '예',
            showDenyButton: true,
            denyButtonText: `아니오`,
        }).then(async (result) => {
            if (result.isConfirmed) {
                await state_1.Swal.fire({
                    icon: "info",
                    text: "프로젝트를 저장할 위치를 선택해주세요"
                });
                state_1.state.running = true;
                window.api.send('projectConvert', document.getElementById('folder_input').value);
            }
        });
    };
    document.getElementById('versionUp').onclick = async () => {
        if (state_1.state.running) {
            state_1.Swal.fire({
                icon: 'error',
                text: '이미 다른 작업이 시행중입니다!',
            });
            return;
        }
        if (state_1.state.mode !== 0) {
            state_1.Swal.fire({
                icon: 'error',
                text: '추출 모드 상태이여야 합니다!',
            });
            return;
        }
        const { isConfirmed: isConfirmed } = await state_1.Swal.fire({
            title: '버전 업 툴 주의사항',
            icon: 'warning',
            text: "버전 업 툴 사용 시 추출 모드의 설정 및 옵션이 그대로 적용됩니다. 구버전 번역본의 추출된 데이터를 기반으로 이식되며, 추출된 데이터가 많을 수록 더 많은 데이터가 이식됩니다.만약 구버전 번역본을 추출하였을 때랑 다른 설정 및 옵션을 사용할 시, 예기치 못한 문제가 발생할 수 있습니다.",
            showDenyButton: true,
            denyButtonText: `취소`,
        });
        if (!isConfirmed) {
            return;
        }
        const { value: formValues } = await state_1.Swal.fire({
            title: '버전 업 툴',
            html: '<div id="swi1" class="cfolder" placeholder="구버전 번역 data 폴더">구버전 번역본 폴더</div>' +
                '<div id="swi3" class="cfolder" placeholder="구버전 미번역 data 폴더">구버전 미번역 폴더</div>' +
                '<div id="swi2" class="cfolder" placeholder="신버전 미번역 data 폴더">신버전 폴더</div>',
            focusConfirm: false,
            showDenyButton: true,
            denyButtonText: `취소`,
            didOpen: () => {
                document.getElementById('swi1').onclick = () => window.api.send('select_folder', 'swi1');
                document.getElementById('swi3').onclick = () => window.api.send('select_folder', 'swi3');
                document.getElementById('swi2').onclick = () => window.api.send('select_folder', 'swi2');
            },
            preConfirm: () => {
                return [
                    document.getElementById('swi1').innerText,
                    document.getElementById('swi2').innerText,
                    document.getElementById('swi3').innerText
                ];
            }
        });
        if (formValues) {
            if (!(formValues[0] === '' || formValues[1] === '' || formValues[2] === '')) {
                if (formValues[0] === formValues[1] || formValues[1] === formValues[2] || formValues[0] === formValues[2]) {
                    state_1.Swal.fire({ icon: 'error', text: '같은 폴더입니다!' });
                }
                else {
                    const kas = formValues[0];
                    const kas2 = formValues[1];
                    const kas3 = formValues[2];
                    const a = {
                        dir1: { ...{ dir: window.nodeBuffer.toBase64(kas.replace('\\', '/')) }, ...state_1.state.config },
                        dir2: { ...{ dir: window.nodeBuffer.toBase64(kas2.replace('\\', '/')) }, ...state_1.state.config },
                        dir3: { ...{ dir: window.nodeBuffer.toBase64(kas3.replace('\\', '/')) }, ...state_1.state.config },
                        dir1_base: kas,
                        dir2_base: kas2,
                        dir3_base: kas3,
                        config: state_1.state.config
                    };
                    state_1.state.running = true;
                    window.api.send('updateVersion', a);
                }
            }
        }
    };
    document.getElementById('fontConfig').onclick = async () => {
        if (state_1.state.running) {
            state_1.Swal.fire({
                icon: 'error',
                text: '이미 다른 작업이 시행중입니다!',
            });
            return;
        }
        await state_1.Swal.fire({
            title: '주의사항',
            icon: 'warning',
            text: '폰트 변경/크기 변경은 게임 내 폰트를 즉시 변경합니다.'
        });
        let result = await state_1.Swal.fire({
            title: '무엇을 하시겠습니까?',
            icon: 'info',
            showDenyButton: true,
            showCancelButton: true,
            confirmButtonText: '폰트 변경',
            denyButtonText: `폰트 크기 변경`,
            cancelButtonText: '취소'
        });
        if (result.isConfirmed) {
            state_1.state.running = true;
            window.api.send('selFont', document.getElementById('folder_input').value);
        }
        else if (result.isDenied) {
            let { value: result2 } = await state_1.Swal.fire({
                title: '폰트 크기 입력',
                input: 'text',
                inputValue: 24,
                showCancelButton: true,
                inputValidator: (value) => {
                    if (!value) {
                        return '무언가 입력해야 합니다!';
                    }
                    if (isNaN(Number(value))) {
                        return '숫자가 아닙니다!';
                    }
                }
            });
            if (result2) {
                state_1.state.running = true;
                window.api.send('changeFontSize', [document.getElementById('folder_input').value, parseInt(result2)]);
            }
        }
    };
}
