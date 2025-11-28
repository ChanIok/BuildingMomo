<script setup lang="ts">
import { ref, watch } from 'vue'
import { useEditorStore } from '../stores/editorStore'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'vue-sonner'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const editorStore = useEditorStore()

// 表单数据
const formData = ref({
  name: '',
  filePath: '',
})

// 当对话框打开时，填充当前状态
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      if (editorStore.activeScheme) {
        formData.value = {
          name: editorStore.activeScheme.name,
          filePath: editorStore.activeScheme.filePath || '',
        }
      } else {
        // 理论上不应该发生，如果没有激活方案就不应该打开此对话框
        emit('update:open', false)
      }
    }
  }
)

// 确认按钮处理
function handleConfirm() {
  if (!editorStore.activeSchemeId) return

  if (!formData.value.name.trim()) {
    toast.error('标签名称不能为空')
    return
  }

  if (!formData.value.filePath.trim()) {
    toast.error('文件名称不能为空')
    return
  }

  editorStore.updateSchemeInfo(editorStore.activeSchemeId, {
    name: formData.value.name.trim(),
    filePath: formData.value.filePath.trim(),
  })

  toast.success('方案信息已更新')
  emit('update:open', false)
}

// 取消按钮处理
function handleCancel() {
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>方案设置</DialogTitle>
        <DialogDescription> 修改当前方案的标签名称和文件名称。 </DialogDescription>
      </DialogHeader>

      <div class="grid gap-4 py-4">
        <div class="grid grid-cols-4 items-center gap-4">
          <Label for="name" class="text-right"> 标签名称 </Label>
          <Input id="name" v-model="formData.name" class="col-span-3" placeholder="例如：方案 1" />
        </div>
        <div class="grid grid-cols-4 items-center gap-4">
          <Label for="filename" class="text-right"> 文件名称 </Label>
          <Input
            id="filename"
            v-model="formData.filePath"
            class="col-span-3"
            placeholder="例如：BUILD_SAVEDATA_123.json"
          />
        </div>
        <div class="pl-4 text-xs text-gray-500">
          <p>提示：</p>
          <ul class="mt-1 list-disc space-y-1 pl-4">
            <li>标签名称：显示在顶部标签页。</li>
            <li>文件名称：显示在左下角，且作为导出时的默认文件名。</li>
          </ul>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="handleCancel">取消</Button>
        <Button @click="handleConfirm">保存</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
