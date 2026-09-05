import { reactive } from 'vue'
import Swal from 'sweetalert2'
import { api } from './useIpc'
import { activeProject, projectBusy, type ProjectEngine } from './useProjectSession'
import { reviewWorkspace } from './useReviewWorkspace'
import { workspaceDrafts } from './useWorkspaceDrafts'

export const workspaceActivity = reactive({ translating: false, progress: 0, label: '' })

export function workspaceHasPendingChanges() {
  return reviewWorkspace.text.dirty || workspaceDrafts.settingsDirty || workspaceDrafts.translationDirty
}

export function workspaceOperationRunning() {
  return projectBusy.value || workspaceActivity.translating || reviewWorkspace.text.busy
    || reviewWorkspace.structure.busy || workspaceDrafts.translationBusy
}

export async function chooseWorkspaceProject(engine: ProjectEngine): Promise<void> {
  if (workspaceOperationRunning()) {
    await Swal.fire({ icon: 'info', title: '현재 작업이 진행 중이에요', text: '작업을 마치거나 중단한 뒤 프로젝트를 변경하세요.' })
    return
  }
  if (activeProject.path && workspaceHasPendingChanges()) {
    const { isConfirmed } = await Swal.fire({
      icon: 'warning', title: '다른 프로젝트를 열까요?',
      text: '다른 폴더를 선택하면 저장하지 않은 번역 편집·설정·지침 초안이 사라져요. 같은 프로젝트의 탭을 이동하면 내용은 유지돼요.',
      showCancelButton: true, confirmButtonText: '폴더 선택', cancelButtonText: '현재 작업 유지',
    })
    if (!isConfirmed) return
  }
  api.send('select_folder', engine === 'wolf' ? 'wolf_folder_input' : 'folder_input')
}
