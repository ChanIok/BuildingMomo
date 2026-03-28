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
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { useI18n } from '@/composables/useI18n'
import { useClipboard } from '@/composables/useClipboard'
import type { StepRepeatConfig } from '@/types/editor'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()
const { canPreserveSourceIds, advancedPaste } = useClipboard()

const mode = ref<'preserveIds' | 'stepRepeat'>('preserveIds')
const repeatCount = ref(1)
const positionDelta = ref({ x: 0, y: 0, z: 0 })
const rotationDelta = ref({ x: 0, y: 0, z: 0 })
const scaleMultiplier = ref({ x: 1, y: 1, z: 1 })

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return

    mode.value = canPreserveSourceIds.value ? 'preserveIds' : 'stepRepeat'
    repeatCount.value = 1
    positionDelta.value = { x: 0, y: 0, z: 0 }
    rotationDelta.value = { x: 0, y: 0, z: 0 }
    scaleMultiplier.value = { x: 1, y: 1, z: 1 }
  }
)

watch(canPreserveSourceIds, (enabled) => {
  if (!enabled && mode.value === 'preserveIds') {
    mode.value = 'stepRepeat'
  }
})

function clampRepeatCount(value: number) {
  if (!Number.isFinite(value) || value < 1) return 1
  return Math.floor(value)
}

function clampScaleMultiplier(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0
  return value
}

function buildStepRepeatConfig(): StepRepeatConfig {
  return {
    repeatCount: clampRepeatCount(repeatCount.value),
    positionDelta: { ...positionDelta.value },
    rotationDelta: { ...rotationDelta.value },
    scaleMultiplier: {
      x: clampScaleMultiplier(scaleMultiplier.value.x),
      y: clampScaleMultiplier(scaleMultiplier.value.y),
      z: clampScaleMultiplier(scaleMultiplier.value.z),
    },
  }
}

// 各轴向输入处理：相比字符串分发，每个函数直接操作对应 ref，类型更安全
function handlePositionInput(axis: 'x' | 'y' | 'z', event: Event) {
  const raw = Number((event.target as HTMLInputElement).value)
  positionDelta.value = { ...positionDelta.value, [axis]: Number.isFinite(raw) ? raw : 0 }
}

function handleRotationInput(axis: 'x' | 'y' | 'z', event: Event) {
  const raw = Number((event.target as HTMLInputElement).value)
  rotationDelta.value = { ...rotationDelta.value, [axis]: Number.isFinite(raw) ? raw : 0 }
}

function handleScaleInput(axis: 'x' | 'y' | 'z', event: Event) {
  const raw = Number((event.target as HTMLInputElement).value)
  scaleMultiplier.value = { ...scaleMultiplier.value, [axis]: clampScaleMultiplier(raw) }
}

function submit() {
  const options =
    mode.value === 'preserveIds'
      ? ({ mode: 'preserveIds' } as const)
      : ({ mode: 'stepRepeat', stepRepeat: buildStepRepeatConfig() } as const)

  if (advancedPaste(options).length > 0) {
    emit('update:open', false)
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-[640px]">
      <DialogHeader>
        <DialogTitle>{{ t('advancedPaste.title') }}</DialogTitle>
        <DialogDescription v-if="canPreserveSourceIds">
          {{ t('advancedPaste.description') }}
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-5 py-2">
        <RadioGroup v-model="mode" class="grid gap-3">
          <label
            v-if="canPreserveSourceIds"
            class="flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors"
            :class="
              mode === 'preserveIds'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/40'
            "
          >
            <RadioGroupItem value="preserveIds" class="mt-0.5" />
            <div class="grid gap-1">
              <div class="font-medium text-foreground">
                {{ t('advancedPaste.mode.preserveIds.title') }}
              </div>
              <p class="text-sm text-muted-foreground">
                {{ t('advancedPaste.mode.preserveIds.description') }}
              </p>
            </div>
          </label>

          <label
            class="flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors"
            :class="
              mode === 'stepRepeat'
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/40'
            "
          >
            <RadioGroupItem value="stepRepeat" class="mt-0.5" />
            <div class="grid gap-1">
              <div class="font-medium text-foreground">
                {{ t('advancedPaste.mode.stepRepeat.title') }}
              </div>
              <p class="text-sm text-muted-foreground">
                {{ t('advancedPaste.mode.stepRepeat.description') }}
              </p>
            </div>
          </label>
        </RadioGroup>

        <template v-if="mode === 'stepRepeat'">
          <Separator />

          <div class="grid gap-4">
            <div class="grid gap-2">
              <Label for="repeat-count">{{ t('advancedPaste.repeatCount') }}</Label>
              <Input
                id="repeat-count"
                :model-value="repeatCount"
                type="number"
                min="1"
                step="1"
                @blur="
                  (e: Event) =>
                    (repeatCount = clampRepeatCount(Number((e.target as HTMLInputElement).value)))
                "
              />
            </div>

            <div class="grid gap-2">
              <Label>{{ t('advancedPaste.positionDelta') }}</Label>
              <div class="grid grid-cols-3 gap-3">
                <Input
                  :model-value="positionDelta.x"
                  type="number"
                  step="0.1"
                  @blur="(e: Event) => handlePositionInput('x', e)"
                />
                <Input
                  :model-value="positionDelta.y"
                  type="number"
                  step="0.1"
                  @blur="(e: Event) => handlePositionInput('y', e)"
                />
                <Input
                  :model-value="positionDelta.z"
                  type="number"
                  step="0.1"
                  @blur="(e: Event) => handlePositionInput('z', e)"
                />
              </div>
            </div>

            <div class="grid gap-2">
              <Label>{{ t('advancedPaste.rotationDelta') }}</Label>
              <div class="grid grid-cols-3 gap-3">
                <Input
                  :model-value="rotationDelta.x"
                  type="number"
                  step="1"
                  @blur="(e: Event) => handleRotationInput('x', e)"
                />
                <Input
                  :model-value="rotationDelta.y"
                  type="number"
                  step="1"
                  @blur="(e: Event) => handleRotationInput('y', e)"
                />
                <Input
                  :model-value="rotationDelta.z"
                  type="number"
                  step="1"
                  @blur="(e: Event) => handleRotationInput('z', e)"
                />
              </div>
            </div>

            <div class="grid gap-2">
              <Label>{{ t('advancedPaste.scaleMultiplier') }}</Label>
              <div class="grid grid-cols-3 gap-3">
                <Input
                  :model-value="scaleMultiplier.x"
                  type="number"
                  min="0"
                  step="0.01"
                  @blur="(e: Event) => handleScaleInput('x', e)"
                />
                <Input
                  :model-value="scaleMultiplier.y"
                  type="number"
                  min="0"
                  step="0.01"
                  @blur="(e: Event) => handleScaleInput('y', e)"
                />
                <Input
                  :model-value="scaleMultiplier.z"
                  type="number"
                  min="0"
                  step="0.01"
                  @blur="(e: Event) => handleScaleInput('z', e)"
                />
              </div>
            </div>
          </div>
        </template>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">
          {{ t('common.cancel') }}
        </Button>
        <Button @click="submit">{{ t('advancedPaste.confirm') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
