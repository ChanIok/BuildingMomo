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
import { useI18n } from '@/composables/useI18n'

const props = defineProps<{
  open: boolean
  schemeId: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
const editorStore = useEditorStore()

// 表单数据
const formData = ref({
  name: '',
  filePath: '',
})

// 根据当前 props 同步表单数据
function syncFormFromProps() {
  // 仅在对话框打开时才同步
  if (!props.open) return

  // 必须有有效的 schemeId
  if (!props.schemeId) {
    emit('update:open', false)
    return
  }

  const scheme = editorStore.schemes.find((s) => s.id === props.schemeId)
  if (!scheme) {
    // 如果指定的 schemeId 不存在，关闭对话框
    emit('update:open', false)
    return
  }

  formData.value = {
    name: scheme.name.value,
    filePath: scheme.filePath.value || '',
  }
}

// 当 open 或 schemeId 任一变化时，同步一次；挂载时也同步一次
watch(
  () => [props.open, props.schemeId],
  () => {
    syncFormFromProps()
  },
  { immediate: true }
)

// 确认按钮处理
function handleConfirm() {
  if (!props.schemeId) return

  if (!formData.value.name.trim()) {
    toast.error(t('scheme.toast.nameRequired'))
    return
  }

  editorStore.updateSchemeInfo(props.schemeId, {
    name: formData.value.name.trim(),
    filePath: formData.value.filePath.trim(),
  })

  toast.success(t('scheme.toast.success'))
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
        <DialogTitle>{{ t('scheme.title') }}</DialogTitle>
        <DialogDescription> {{ t('scheme.description') }} </DialogDescription>
      </DialogHeader>

      <div class="grid gap-4 py-4">
        <div class="grid grid-cols-4 items-center gap-4">
          <Label for="name" class="text-right"> {{ t('scheme.nameLabel') }} </Label>
          <Input
            id="name"
            v-model="formData.name"
            class="col-span-3"
            :placeholder="t('scheme.namePlaceholder')"
          />
        </div>
        <div class="grid grid-cols-4 items-center gap-4">
          <Label for="filename" class="text-right"> {{ t('scheme.fileLabel') }} </Label>
          <Input
            id="filename"
            v-model="formData.filePath"
            class="col-span-3"
            :placeholder="t('scheme.filePlaceholder')"
          />
        </div>
        <div class="pl-4 text-xs text-muted-foreground">
          <p>{{ t('scheme.tipsTitle') }}</p>
          <ul class="mt-1 list-disc space-y-1 pl-4">
            <li>{{ t('scheme.tips.name') }}</li>
            <li>{{ t('scheme.tips.file') }}</li>
          </ul>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="handleCancel">{{ t('common.cancel') }}</Button>
        <Button @click="handleConfirm">{{ t('common.save') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
