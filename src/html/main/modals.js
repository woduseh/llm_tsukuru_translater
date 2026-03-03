"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initModals = initModals;
const state_1 = require("./state");
const tabManager_1 = require("./tabManager");
const guards_1 = require("../../types/guards");
function initModals() {
    window.api.on('check_force', (arg) => {
        if (!(0, guards_1.isRecord)(arg))
            return;
        state_1.Swal.fire({
            icon: 'question',
            text: 'Extract 폴더가 존재합니다. \n덮어씌우겠습니까?',
            confirmButtonText: '예',
            showDenyButton: true,
            denyButtonText: `아니오`,
        }).then((result) => {
            if (result.isConfirmed) {
                arg.force = true;
                window.api.send('extract', arg);
            }
        });
    });
    window.api.on('alert', (tt) => {
        if ((0, guards_1.isString)(tt)) {
            state_1.Swal.fire({
                icon: 'success',
                title: tt,
            });
        }
        else if ((0, guards_1.isRecord)(tt)) {
            state_1.Swal.fire({
                icon: (0, guards_1.getString)(tt, 'icon', 'info'),
                title: (0, guards_1.getString)(tt, 'message'),
            });
        }
    });
    window.api.on('alert_free', (tt) => {
        state_1.Swal.fire(tt);
    });
    window.api.on('alert2', async (tt) => {
        const { isDenied } = await state_1.Swal.fire({
            icon: 'success',
            showDenyButton: true,
            denyButtonText: "폴더 열기",
            title: '완료되었습니다',
        });
        if (isDenied) {
            window.api.send("openFolder", document.getElementById('folder_input').value);
        }
    });
    window.api.on('alertExten', async (arg) => {
        if (!Array.isArray(arg))
            return;
        const { isDenied } = await state_1.Swal.fire({
            icon: 'success',
            showDenyButton: true,
            denyButtonText: "아니요",
            title: String(arg[0]),
        });
        if (!isDenied) {
            window.api.send("getextention", String(arg[1]));
        }
        else {
            window.api.send("getextention", 'none');
        }
    });
    // Option toggles with confirmation dialogs
    document.getElementById('ext_plugin').onclick = () => {
        if (!state_1.state.config.ext_plugin) {
            state_1.Swal.fire({
                icon: 'warning',
                text: '플러그인을 추출하여 번역할 시\n게임 내에서 오류가 날 수 있습니다\n정말로 활성화하시겠습니까?',
                confirmButtonText: '예',
                showDenyButton: true,
                denyButtonText: `아니오`,
            }).then((result) => {
                if (result.isConfirmed) {
                    state_1.Swal.fire({
                        icon: 'success',
                        text: '활성화 되었습니다.\n번역 시 원어만 번역해 주시고,\n추출 모드에서 RUN을 눌러 추출하세요',
                    });
                    state_1.state.config.ext_plugin = true;
                    (0, tabManager_1.reloadUI)();
                }
            });
        }
        else {
            state_1.state.config.ext_plugin = false;
            (0, tabManager_1.reloadUI)();
        }
    };
    document.getElementById('decryptImg').onclick = () => { state_1.state.config.decryptImg = !state_1.state.config.decryptImg; (0, tabManager_1.reloadUI)(); };
    document.getElementById('decryptAudio').onclick = () => { state_1.state.config.decryptAudio = !state_1.state.config.decryptAudio; (0, tabManager_1.reloadUI)(); };
    document.getElementById('exJson').onclick = () => {
        if (!state_1.state.config.exJson) {
            state_1.Swal.fire({
                icon: 'warning',
                text: '비표준 JSON / CSV를 추출하여 번역할 시\n게임 내에서 오류가 날 수 있습니다\n정말로 활성화하시겠습니까?',
                confirmButtonText: '예',
                showDenyButton: true,
                denyButtonText: `아니오`,
            }).then((result) => {
                if (result.isConfirmed) {
                    state_1.Swal.fire({
                        icon: 'success',
                        text: '활성화 되었습니다.\n추출 모드에서 RUN을 눌러 추출하세요',
                    });
                    state_1.state.config.exJson = true;
                    (0, tabManager_1.reloadUI)();
                }
            });
        }
        else {
            state_1.state.config.exJson = false;
            (0, tabManager_1.reloadUI)();
        }
    };
    document.getElementById('ext_src').onclick = () => {
        if (!state_1.state.config.ext_src) {
            state_1.Swal.fire({
                icon: 'warning',
                text: '스크립트를 추출하여 번역할 시\n게임 내에서 오류가 날 수 있습니다\n정말로 활성화하시겠습니까?',
                confirmButtonText: '예',
                showDenyButton: true,
                denyButtonText: `아니오`,
            }).then((result) => {
                if (result.isConfirmed) {
                    state_1.Swal.fire({
                        icon: 'success',
                        text: '활성화 되었습니다.\n번역 시 원어만 번역해 주시고,\n추출 모드에서 RUN을 눌러 추출하세요',
                    });
                    state_1.state.config.ext_src = true;
                    (0, tabManager_1.reloadUI)();
                }
            });
        }
        else {
            state_1.state.config.ext_src = false;
            (0, tabManager_1.reloadUI)();
        }
    };
    document.getElementById('ext_javascript').onclick = () => {
        if (!state_1.state.config.ext_javascript) {
            state_1.Swal.fire({
                icon: 'warning',
                text: '자바스크립트를 추출하여 번역할 시\n게임 내에서 오류가 날 수 있습니다\n정말로 활성화하시겠습니까?',
                confirmButtonText: '예',
                showDenyButton: true,
                denyButtonText: `아니오`,
            }).then((result) => {
                if (result.isConfirmed) {
                    state_1.Swal.fire({
                        icon: 'success',
                        text: '활성화 되었습니다.\n잘못된 곳을 번역하지 않도록 주의하시고,\n추출 모드에서 RUN을 눌러 추출하세요',
                    });
                    state_1.state.config.ext_javascript = true;
                    (0, tabManager_1.reloadUI)();
                }
            });
        }
        else {
            state_1.state.config.ext_javascript = false;
            (0, tabManager_1.reloadUI)();
        }
    };
    document.getElementById('ext_note').onclick = () => {
        if (!state_1.state.config.ext_note) {
            state_1.Swal.fire({
                icon: 'warning',
                text: '노트/메모를 추출하여 번역할 시\n게임 내에서 오류가 날 수 있습니다\n정말로 활성화하시겠습니까?',
                confirmButtonText: '예',
                showDenyButton: true,
                denyButtonText: `아니오`,
            }).then((result) => {
                if (result.isConfirmed) {
                    state_1.Swal.fire({
                        icon: 'success',
                        text: '활성화 되었습니다.\n번역 시 원어만 번역해 주시고,\n추출 모드에서 RUN을 눌러 추출하세요',
                    });
                    state_1.state.config.ext_note = true;
                    (0, tabManager_1.reloadUI)();
                }
            });
        }
        else {
            state_1.state.config.ext_note = false;
            (0, tabManager_1.reloadUI)();
        }
    };
    document.getElementById('autoline').onclick = () => { state_1.state.config.autoline = !state_1.state.config.autoline; (0, tabManager_1.reloadUI)(); };
    document.getElementById('instantapply').onclick = () => { state_1.state.config.instantapply = !state_1.state.config.instantapply; (0, tabManager_1.reloadUI)(); };
    // LLM translation abort
    window.api.on('llmTranslating', (val) => {
        if (!(0, guards_1.isBoolean)(val))
            return;
        state_1.state.llmTranslating = val;
        document.getElementById('abort-llm-btn').style.display = val ? 'block' : 'none';
    });
    document.getElementById('abort-llm-btn').onclick = async () => {
        const result = await state_1.Swal.fire({
            icon: 'warning',
            text: '번역을 중단하시겠습니까?\n현재까지의 진행 상태는 저장됩니다.',
            confirmButtonText: '중단',
            showDenyButton: true,
            denyButtonText: '계속',
        });
        if (result.isConfirmed) {
            window.api.send('abortLLM');
        }
    };
    document.addEventListener('keydown', async (e) => {
        if (e.key === 'Escape' && state_1.state.llmTranslating) {
            const result = await state_1.Swal.fire({
                icon: 'warning',
                text: '번역을 중단하시겠습니까?\n현재까지의 진행 상태는 저장됩니다.',
                confirmButtonText: '중단',
                showDenyButton: true,
                denyButtonText: '계속',
            });
            if (result.isConfirmed) {
                window.api.send('abortLLM');
            }
        }
    });
}
