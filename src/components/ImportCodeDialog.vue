<script setup lang="ts">
import { ref, watch } from 'vue'
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
import { useI18n } from '@/composables/useI18n'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: [code: string]
}>()

const { t } = useI18n()

// 表单数据
const code = ref('')
const isLoading = ref(false)

// 重置表单
function resetForm() {
  code.value = ''
  isLoading.value = false
}

// 监听对话框打开/关闭，重置表单
watch(
  () => props.open,
  (newOpen) => {
    if (newOpen) {
      resetForm()
    }
  }
)

// 确认按钮处理
function handleConfirm() {
  const trimmedCode = code.value.trim()
  if (!trimmedCode) {
    return
  }

  emit('confirm', trimmedCode)
}

// 取消按钮处理
function handleCancel() {
  emit('update:open', false)
}

// 暴露 loading 状态供父组件控制
defineExpose({
  setLoading: (loading: boolean) => {
    isLoading.value = loading
  },
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>{{ t('fileOps.importCode.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('fileOps.importCode.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-4 py-4">
        <Input
          id="code"
          v-model="code"
          :placeholder="t('fileOps.importCode.inputPlaceholder')"
          :disabled="isLoading"
          @keydown.enter="handleConfirm"
        />
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="isLoading" @click="handleCancel">
          {{ t('common.cancel') }}
        </Button>
        <Button :disabled="!code.trim() || isLoading" @click="handleConfirm">
          {{ isLoading ? t('fileOps.importCode.importing') : t('common.confirm') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
